/**
 * Composition root: reads configuration, builds the adapters and services,
 * and starts the HTTP server. Nothing else in the server reads the
 * environment or constructs its own dependencies.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { pino } from 'pino';
import { MetaClient } from './adapters/meta/client.ts';
import {
  MuseSparkDamageDetector,
  MuseSparkDamageNoteParser,
  MuseSparkFaceViewClassifier,
  MuseSparkMarkingsReader,
} from './adapters/meta/muse-spark.ts';
import { MuseSparkAgent } from './adapters/meta/muse-spark-agent.ts';
import { MuseVoiceTranscriber } from './adapters/meta/muse-voice.ts';
import { Sam3Segmenter } from './adapters/meta/sam.ts';
import { createTransactionRunner, openDatabase } from './adapters/sqlite/database.ts';
import {
  SqliteContainerRepository,
  SqliteHandoverRepository,
  SqliteMarkRepository,
  SqlitePhotoRepository,
} from './adapters/sqlite/repositories.ts';
import { WebhookNotifier } from './adapters/webhooks.ts';
import { ConfigError, loadConfig } from './config.ts';
import { createApp } from './http/app.ts';
import { FileMediaStore } from './media/file-media-store.ts';
import { JsonFileCache } from './media/json-file-cache.ts';
import { SampleClips } from './media/sample-clips.ts';
import { ClaimService } from './services/claims.ts';
import { describeHandoverEvent, EventBus } from './services/events.ts';
import { HandoverService } from './services/handovers.ts';
import { IdentifyService } from './services/identify.ts';
import { SpeechService } from './services/speech.ts';
import { SpokenDamageService } from './services/spoken-damage.ts';
import { VideoService } from './services/video.ts';

function main(): void {
  const config = loadConfig();
  const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;
  const logger = pino({
    level: config.logLevel,
    redact: ['*.authorization', '*.apiKey'],
    ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });

  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, 'plomba.db'));
  const media = new FileMediaStore(join(config.dataDir, 'media'));

  const meta = new MetaClient({
    baseUrl: config.meta.baseUrl,
    apiKey: config.meta.apiKey,
    timeoutMs: config.meta.timeoutMs,
    logger,
  });
  // Reading markings and finding damage can run elsewhere, e.g. Muse Glimmer on-premises.
  const { vision } = config.meta;
  const visionClient = vision.baseUrl
    ? new MetaClient({
        baseUrl: vision.baseUrl,
        apiKey: vision.apiKey ?? '',
        timeoutMs: config.meta.timeoutMs,
        logger,
      })
    : meta;
  const spark = { model: config.meta.visionModel, reasoningEffort: config.meta.reasoningEffort };
  const reader = new MuseSparkMarkingsReader(visionClient, { ...spark, api: vision.apiStyle });
  const detector = new MuseSparkDamageDetector(visionClient, { ...spark, api: vision.apiStyle });
  const classifier = new MuseSparkFaceViewClassifier(visionClient, {
    ...spark,
    api: vision.apiStyle,
    maxImages: vision.maxImages,
  });
  const segmenter = new Sam3Segmenter(meta, { model: config.meta.segmentationModel });
  const transcriber = new MuseVoiceTranscriber(meta, { model: config.meta.speechModel });

  const repositories = {
    containers: new SqliteContainerRepository(db),
    handovers: new SqliteHandoverRepository(db),
    photos: new SqlitePhotoRepository(db),
    marks: new SqliteMarkRepository(db),
  };
  // Handover events for other systems: signed webhooks when configured.
  const events = new EventBus(logger);
  const handovers = new HandoverService({
    ...repositories,
    media,
    segmenter,
    detector,
    transaction: createTransactionRunner(db),
    clock: { now: () => new Date() },
    newId: randomUUID,
    ediSenderId: config.ediSenderId,
    events,
  });
  if (config.webhooks) {
    const webhooks = new WebhookNotifier({
      ...config.webhooks,
      describe: (event, id) =>
        describeHandoverEvent(handovers, event, { id, publicUrl: config.publicUrl }),
      logger,
    });
    events.subscribe((event) => webhooks.deliver(event));
  }
  const speech = new SpeechService(transcriber);
  // Structured output like the vision jobs, so it runs on the same (possibly open-weights) endpoint.
  const noteParser = new MuseSparkDamageNoteParser(visionClient, {
    ...spark,
    api: vision.apiStyle,
  });

  const app = createApp({
    identify: new IdentifyService(reader),
    handovers,
    speech,
    spokenDamage: new SpokenDamageService({ speech, parser: noteParser, handovers }),
    claims: new ClaimService({ ...repositories, media, agent: new MuseSparkAgent(meta, spark) }),
    video: new VideoService({
      segmenter,
      classifier,
      cache: new JsonFileCache(join(config.dataDir, 'tracks')),
    }),
    media,
    logger,
    webDistDir: config.webDistDir,
    accessCode: config.accessCode,
    apiTokens: config.apiTokens,
    publicUrl: config.publicUrl,
    notice: config.notice,
    samples: config.samplesDir ? SampleClips.load(config.samplesDir) : undefined,
  });

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    logger.info(
      {
        metaApi: config.meta.baseUrl,
        visionModel: config.meta.visionModel,
        segmentationModel: config.meta.segmentationModel,
      },
      `Plomba listening on http://${info.address}:${info.port}`,
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  main();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
