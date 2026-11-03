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
    META_SPEECH_MODEL: z.string().default('muse-voice-transcribe-1.0'),
    /**
     * A separate endpoint for reading markings and finding damage, e.g. Muse
     * Glimmer on your own hardware. SAM 3.1 and speech stay on META_API_BASE_URL.
     */
    META_VISION_BASE_URL: z.url().optional(),
    META_VISION_API_STYLE: z.enum(['responses', 'chat-completions']).default('responses'),
    /**
     * Images the vision endpoint accepts in one request. A walk-around's frames
     * go in one call when they fit, so the model sees the whole walk; Muse
     * Spark Open on Baseten takes 8.
     */
    META_VISION_MAX_IMAGES: z.coerce.number().int().min(1).max(64).default(16),
    /** The vision endpoint's own key, if it needs one. The Meta key is never sent there. */
    META_VISION_API_KEY_FILE: z.string().min(1).optional(),
    META_VISION_API_KEY: z.string().min(1).optional(),
    META_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),
    META_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    /**
     * When set, the app asks for this code once per device and every API and
     * media request needs the resulting session cookie. Leave unset behind a
     * single-sign-on proxy.
     */
    PLOMBA_ACCESS_CODE: z.string().min(8).optional(),
    /** This installation's ID in EDIFACT messages (UNB sender, NAD+MS), as agreed with partners. */
    EDI_SENDER_ID: z.string().min(1).max(35).default('PLOMBA'),
    /** A line shown at the foot of every screen, e.g. "Demo data" or credits for the photos. */
    PLOMBA_NOTICE: z.string().trim().min(1).max(500).optional(),
    /**
     * A file of API tokens for other systems, one per line: a name, a space,
     * and a token of at least 24 characters. Lines starting with # are ignored.
     */
    PLOMBA_API_TOKENS_FILE: z.string().min(1).optional(),
    /** Endpoints that receive signed handover events, comma-separated (https in production). */
    PLOMBA_WEBHOOK_URLS: z.string().min(1).optional(),
    /** The secret webhooks are signed with, from a file (or PLOMBA_WEBHOOK_SECRET). */
    PLOMBA_WEBHOOK_SECRET_FILE: z.string().min(1).optional(),
    PLOMBA_WEBHOOK_SECRET: z.string().min(16).optional(),
    /** Where people reach this installation, for links in webhooks (e.g. https://plomba.example.com). */
    PLOMBA_PUBLIC_URL: z.url().optional(),
    /** A folder of sample walk-around clips with a samples.json, offered to try the app. */
    PLOMBA_SAMPLES_DIR: z.string().min(1).optional(),
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
  readonly accessCode: string | undefined;
  /** A line shown at the foot of every screen. */
  readonly notice: string | undefined;
  /** Tokens other systems use to call the API. */
  readonly apiTokens: readonly { readonly name: string; readonly token: string }[];
  /** Where signed handover events are sent, if anywhere. */
  readonly webhooks: { readonly urls: readonly string[]; readonly secret: string } | undefined;
  /** This installation's address, for links sent to other systems. */
  readonly publicUrl: string;
  /** A folder of sample walk-around clips (see media/sample-clips.ts). */
  readonly samplesDir: string | undefined;
  readonly meta: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly visionModel: string;
    readonly segmentationModel: string;
    readonly speechModel: string;
    readonly vision: {
      /** Unset: the vision model runs on `baseUrl` with `apiKey`. */
      readonly baseUrl: string | undefined;
      readonly apiKey: string | undefined;
      readonly apiStyle: 'responses' | 'chat-completions';
      readonly maxImages: number;
    };
    readonly reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
    readonly timeoutMs: number;
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function readKey(file: string | undefined, variable: string): string | undefined {
  if (!file) return undefined;
  const path = resolve(expandHome(file));
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (cause) {
    throw new ConfigError(`Cannot read ${variable} at ${path}`, { cause });
  }
}

/** Parses the API tokens file: `<name> <token>` per line. */
export function parseApiTokens(text: string): { name: string; token: string }[] {
  const tokens = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, i) => {
      const [name, token, ...rest] = line.split(/\s+/);
      if (!name || !token || rest.length > 0 || token.length < 24) {
        throw new ConfigError(
          `API tokens file, line ${i + 1}: expected "<name> <token>" with a token of 24+ characters`,
        );
      }
      return { name, token };
    });
  if (new Set(tokens.map((t) => t.name)).size !== tokens.length) {
    throw new ConfigError('API tokens file: each name may appear once');
  }
  return tokens;
}

function readWebhooks(e: {
  PLOMBA_WEBHOOK_URLS?: string | undefined;
  PLOMBA_WEBHOOK_SECRET_FILE?: string | undefined;
  PLOMBA_WEBHOOK_SECRET?: string | undefined;
}): { urls: string[]; secret: string } | undefined {
  if (!e.PLOMBA_WEBHOOK_URLS) return undefined;
  const urls = e.PLOMBA_WEBHOOK_URLS.split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  for (const url of urls) {
    if (!z.url({ protocol: /^https?$/ }).safeParse(url).success) {
      throw new ConfigError(`PLOMBA_WEBHOOK_URLS: ${url} is not an http(s) URL`);
    }
  }
  const secret =
    readKey(e.PLOMBA_WEBHOOK_SECRET_FILE, 'PLOMBA_WEBHOOK_SECRET_FILE') ?? e.PLOMBA_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) {
    throw new ConfigError(
      'Webhooks need a signing secret of 16+ characters (PLOMBA_WEBHOOK_SECRET_FILE)',
    );
  }
  return { urls, secret };
}

function readApiTokens(file: string | undefined): { name: string; token: string }[] {
  const text = readKey(file, 'PLOMBA_API_TOKENS_FILE');
  return text ? parseApiTokens(text) : [];
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path;
}

/** Reads and validates configuration from environment variables. Throws `ConfigError` with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Compose and many platforms pass unset variables as empty strings.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;

  const apiKey = readKey(e.META_API_KEY_FILE, 'META_API_KEY_FILE') ?? e.META_API_KEY;
  if (!apiKey) throw new ConfigError('The Meta Model API key is empty');
  const visionKey =
    readKey(e.META_VISION_API_KEY_FILE, 'META_VISION_API_KEY_FILE') ?? e.META_VISION_API_KEY;

  return {
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    dataDir: resolve(expandHome(e.DATA_DIR)),
    webDistDir: e.WEB_DIST_DIR ? resolve(expandHome(e.WEB_DIST_DIR)) : undefined,
    ediSenderId: e.EDI_SENDER_ID,
    accessCode: e.PLOMBA_ACCESS_CODE,
    notice: e.PLOMBA_NOTICE,
    apiTokens: readApiTokens(e.PLOMBA_API_TOKENS_FILE),
    webhooks: readWebhooks(e),
    publicUrl: (e.PLOMBA_PUBLIC_URL ?? `http://localhost:${e.PORT}`).replace(/\/+$/, ''),
    samplesDir: e.PLOMBA_SAMPLES_DIR ? resolve(expandHome(e.PLOMBA_SAMPLES_DIR)) : undefined,
    meta: {
      baseUrl: e.META_API_BASE_URL.replace(/\/+$/, ''),
      apiKey,
      visionModel: e.META_VISION_MODEL,
      segmentationModel: e.META_SEGMENTATION_MODEL,
      speechModel: e.META_SPEECH_MODEL,
      vision: {
        baseUrl: e.META_VISION_BASE_URL?.replace(/\/+$/, ''),
        apiKey: visionKey,
        apiStyle: e.META_VISION_API_STYLE,
        maxImages: e.META_VISION_MAX_IMAGES,
      },
      reasoningEffort: e.META_REASONING_EFFORT,
      timeoutMs: e.META_TIMEOUT_MS,
    },
  };
}
