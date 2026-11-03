/**
 * Measures container identification on a labelled set of photos, through the
 * same service and Meta models the app uses.
 *
 *   node --env-file=.env apps/server/scripts/eval-identify.ts <dataset dir>
 *     [--limit N] [--concurrency N] [--min-long-side PX]
 *
 * The dataset directory holds an MMOCR text-recognition file (`textrecog.json`,
 * as in TRUDI) whose labels are container numbers. Labels that aren't valid
 * ISO 6346 numbers are skipped. Per-photo results are written next to the
 * dataset; a Markdown summary is printed.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { IdentifyResult } from '@plomba/contracts';
import { parseContainerNumber } from '@plomba/core';
import { pino } from 'pino';
import { MetaClient } from '../src/adapters/meta/client.ts';
import { MuseSparkMarkingsReader } from '../src/adapters/meta/muse-spark.ts';
import { loadConfig } from '../src/config.ts';
import { IdentifyService } from '../src/services/identify.ts';

/** Muse Spark list prices, USD per million tokens (https://dev.meta.ai/docs/pricing-rate-limits). */
const PRICE_PER_MILLION = { input: 1.25, cachedInput: 0.15, output: 4.25 };

interface Sample {
  readonly image: string;
  readonly truth: string;
}

interface Outcome extends Sample {
  readonly result?: IdentifyResult;
  readonly error?: string;
  readonly ms: number;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'min-long-side': { type: 'string' },
  },
});
const datasetDir = positionals[0];
if (!datasetDir) {
  console.error('Usage: eval-identify.ts <dataset dir> [--limit N] [--concurrency N]');
  process.exit(1);
}

const labels = JSON.parse(await readFile(join(datasetDir, 'textrecog.json'), 'utf8')) as {
  data_list: { img_path: string; instances: { text: string }[] }[];
};
const samples: Sample[] = labels.data_list
  .map((item) => ({ image: join(datasetDir, item.img_path), truth: item.instances[0]?.text ?? '' }))
  .filter((s) => parseContainerNumber(s.truth).ok)
  .slice(0, values.limit ? Number(values.limit) : undefined);

const config = loadConfig();
// The same endpoint the app reads markings with: Meta's API, or an
// OpenAI-compatible server such as Muse Spark Open or Muse Glimmer.
const { vision } = config.meta;
const usage = { input: 0, cachedInput: 0, output: 0, calls: 0 };
const client = new MetaClient({
  baseUrl: vision.baseUrl ?? config.meta.baseUrl,
  apiKey: vision.baseUrl ? (vision.apiKey ?? '') : config.meta.apiKey,
  timeoutMs: config.meta.timeoutMs,
  logger: pino({ level: 'warn' }),
  onResponse: ({ usage: u }) => {
    // Responses API and Chat Completions name their token counts differently.
    const input = Number(u?.input_tokens ?? u?.prompt_tokens ?? 0);
    const details = (u?.input_tokens_details ?? u?.prompt_tokens_details) as
      | { cached_tokens?: number }
      | undefined;
    const cached = Number(details?.cached_tokens ?? 0);
    usage.input += input - cached;
    usage.cachedInput += cached;
    usage.output += Number(u?.output_tokens ?? u?.completion_tokens ?? 0);
    usage.calls++;
  },
});
const minLongSide = values['min-long-side'] ? Number(values['min-long-side']) : undefined;
const service = new IdentifyService(
  new MuseSparkMarkingsReader(client, {
    model: config.meta.visionModel,
    reasoningEffort: config.meta.reasoningEffort,
    api: vision.apiStyle,
  }),
  minLongSide === undefined ? {} : { minLongSide },
);

async function run(sample: Sample): Promise<Outcome> {
  const started = performance.now();
  try {
    const result = await service.identify(new Uint8Array(await readFile(sample.image)));
    return { ...sample, result, ms: performance.now() - started };
  } catch (error) {
    return { ...sample, error: (error as Error).message, ms: performance.now() - started };
  }
}

const outcomes: Outcome[] = [];
const queue = [...samples];
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    for (let sample = queue.shift(); sample; sample = queue.shift()) {
      outcomes.push(await run(sample));
      process.stderr.write(`\r${outcomes.length}/${samples.length}`);
    }
  }),
);
process.stderr.write('\n');

const normalise = (s: string | null | undefined) =>
  (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const count = (predicate: (o: Outcome) => boolean) => outcomes.filter(predicate).length;
const n = outcomes.length;
const pct = (k: number) => `${k} (${((100 * k) / n).toFixed(1)}%)`;

const rawExact = count((o) => normalise(o.result?.read.containerNumber) === o.truth);
const byVerdict = (v: IdentifyResult['verdict']) => count((o) => o.result?.verdict === v);
const verifiedRight = count(
  (o) => o.result?.verdict === 'verified' && o.result.containerNumber === o.truth,
);
// The app accepts only verified reads; everything else waits for the checker.
const silentErrors = count(
  (o) => o.result?.verdict === 'verified' && o.result.containerNumber !== o.truth,
);
const firstSuggestionRight = count(
  (o) => o.result?.verdict === 'suggested' && o.result.candidates[0]?.containerNumber === o.truth,
);
const offeredToChecker = count(
  (o) =>
    o.result?.verdict !== 'verified' &&
    (o.result?.candidates.some((c) => c.containerNumber === o.truth) ?? false),
);
const errors = count((o) => o.error !== undefined);
const latencies = outcomes.map((o) => o.ms).sort((a, b) => a - b);
const quantile = (q: number) =>
  ((latencies[Math.floor(q * (latencies.length - 1))] ?? 0) / 1000).toFixed(1);
const cost =
  (usage.input * PRICE_PER_MILLION.input +
    usage.cachedInput * PRICE_PER_MILLION.cachedInput +
    usage.output * PRICE_PER_MILLION.output) /
  1e6;

console.log(`Model: ${config.meta.visionModel} at ${vision.baseUrl ?? config.meta.baseUrl}

| Metric | Value |
|---|---|
| Photos | ${n} |
| Muse Spark's raw read is exactly right | ${pct(rawExact)} |
| Verdict: verified (accepted) | ${pct(byVerdict('verified'))} |
| Verdict: suggested | ${pct(byVerdict('suggested'))} |
| Verdict: ambiguous | ${pct(byVerdict('ambiguous'))} |
| Verdict: unreadable | ${pct(byVerdict('unreadable'))} |
| Requests that failed | ${pct(errors)} |
| **Verified and right** (no input from the checker) | **${pct(verifiedRight)}** |
| **Silent errors** (verified but wrong) | **${pct(silentErrors)}** |
| Suggested, and the first suggestion is right | ${pct(firstSuggestionRight)} |
| Not verified, right number among the choices (one tap) | ${pct(offeredToChecker)} |
| Latency p50 / p90 | ${quantile(0.5)} s / ${quantile(0.9)} s |
| Model calls | ${usage.calls} (${(usage.calls / n).toFixed(2)} per photo) |
| Tokens in / out | ${usage.input + usage.cachedInput} / ${usage.output} |
| Estimated cost | ${vision.baseUrl ? 'not priced (other provider)' : `$${cost.toFixed(3)} ($${(cost / n).toFixed(4)} per photo)`} |`);

const resultsPath = join(
  datasetDir,
  `identify-results-${new Date().toISOString().slice(0, 10)}-${config.meta.visionModel.replace(/\W+/g, '_')}-min${minLongSide ?? 'default'}.json`,
);
await writeFile(resultsPath, JSON.stringify({ usage, outcomes }, null, 2));
console.error(`Per-photo results: ${resultsPath}`);
