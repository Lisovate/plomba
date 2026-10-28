import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';

const EnvSchema = z
  .object({
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Where the database and media live. Mount this as a volume. */
    DATA_DIR: z.string().default('./data'),
    /** The built web app to serve; leave unset when the web app is served separately. */
    WEB_DIST_DIR: z.string().optional(),

    /** Any endpoint that speaks the Meta Model API's Responses API. */
    META_API_BASE_URL: z.url().default('https://api.meta.ai/v1'),
    META_API_KEY: z.string().min(1).optional(),
    /** A file holding the key, e.g. a Docker or Kubernetes secret. Preferred over META_API_KEY. */
    META_API_KEY_FILE: z.string().min(1).optional(),
    META_VISION_MODEL: z.string().default('muse-spark-1.3'),
    META_SEGMENTATION_MODEL: z.string().default('sam-3.1'),
    META_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),
    META_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    /** This installation's ID in EDIFACT messages (UNB sender, NAD+MS), as agreed with partners. */
    EDI_SENDER_ID: z.string().min(1).max(35).default('PLOMBA'),
  })
  .refine((env) => env.META_API_KEY || env.META_API_KEY_FILE, {
    message: 'Set META_API_KEY_FILE (preferred) or META_API_KEY',
    path: ['META_API_KEY_FILE'],
  });

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly dataDir: string;
  readonly webDistDir: string | undefined;
  readonly ediSenderId: string;
  readonly meta: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly visionModel: string;
    readonly segmentationModel: string;
    readonly reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
    readonly timeoutMs: number;
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path;
}

/** Reads and validates configuration from environment variables. Throws `ConfigError` with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;

  let apiKey = e.META_API_KEY;
  if (e.META_API_KEY_FILE) {
    const path = resolve(expandHome(e.META_API_KEY_FILE));
    try {
      apiKey = readFileSync(path, 'utf8').trim();
    } catch (cause) {
      throw new ConfigError(`Cannot read META_API_KEY_FILE at ${path}`, { cause });
    }
  }
  if (!apiKey) throw new ConfigError('The Meta Model API key is empty');

  return {
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    dataDir: resolve(expandHome(e.DATA_DIR)),
    webDistDir: e.WEB_DIST_DIR ? resolve(expandHome(e.WEB_DIST_DIR)) : undefined,
    ediSenderId: e.EDI_SENDER_ID,
    meta: {
      baseUrl: e.META_API_BASE_URL.replace(/\/+$/, ''),
      apiKey,
      visionModel: e.META_VISION_MODEL,
      segmentationModel: e.META_SEGMENTATION_MODEL,
      reasoningEffort: e.META_REASONING_EFFORT,
      timeoutMs: e.META_TIMEOUT_MS,
    },
  };
}
