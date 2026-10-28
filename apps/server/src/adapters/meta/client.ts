/**
 * A small client for the Meta Model API's Responses endpoint
 * (https://dev.meta.ai/docs). Plain `fetch`, no SDK, so the request that goes
 * over the wire is the one written here.
 */

import type { Logger } from 'pino';

export type ResponsesContent =
  | { readonly type: 'input_text'; readonly text: string }
  | { readonly type: 'input_image'; readonly image_url: string };

export interface ResponsesMessage {
  readonly type: 'message';
  readonly role: 'user' | 'system' | 'developer';
  readonly content: readonly ResponsesContent[];
}

export interface FunctionCallOutput {
  readonly type: 'function_call_output';
  readonly call_id: string;
  readonly output: string;
}

/**
 * Input items: messages, tool results, and output items of earlier responses
 * replayed as they came (requests aren't stored, so the history travels with
 * every request).
 */
export type ResponsesInputItem =
  | ResponsesMessage
  | FunctionCallOutput
  | ResponsesResponse['output'][number];

export interface FunctionTool {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ResponsesRequest {
  readonly model: string;
  readonly input: readonly ResponsesInputItem[];
  readonly tools?: readonly FunctionTool[];
  readonly parallel_tool_calls?: boolean;
  readonly instructions?: string;
  readonly reasoning?: { readonly effort: 'minimal' | 'low' | 'medium' | 'high' };
  readonly text?: {
    readonly format: {
      readonly type: 'json_schema';
      readonly name: string;
      readonly schema: Record<string, unknown>;
      readonly strict: boolean;
    };
  };
  readonly metadata?: Readonly<Record<string, string>>;
  readonly max_output_tokens?: number;
}

export interface ResponsesResponse {
  readonly id: string;
  readonly status: 'completed' | 'incomplete' | 'failed' | 'in_progress' | string;
  readonly error: { readonly message: string; readonly code?: string | null } | null;
  readonly incomplete_details: { readonly reason?: string | null } | null;
  readonly output: readonly (
    | {
        readonly type: 'message';
        readonly content: readonly { readonly type: string; readonly text?: string }[];
      }
    | {
        readonly type: 'function_call';
        readonly call_id: string;
        readonly name: string;
        readonly arguments: string;
      }
    | { readonly type: string }
  )[];
  readonly usage?: Readonly<Record<string, unknown>>;
}

export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly {
    readonly role: 'system' | 'user';
    readonly content:
      | string
      | readonly (
          | { readonly type: 'text'; readonly text: string }
          | { readonly type: 'image_url'; readonly image_url: { readonly url: string } }
        )[];
  }[];
  readonly response_format?: {
    readonly type: 'json_schema';
    readonly json_schema: {
      readonly name: string;
      readonly schema: Record<string, unknown>;
      readonly strict: boolean;
    };
  };
  readonly reasoning_effort?: string;
}

export interface ChatCompletionResponse {
  readonly choices: readonly { readonly message: { readonly content: string | null } }[];
  readonly usage?: Readonly<Record<string, unknown>>;
}

export interface TranscriptionResponse {
  readonly sessionId?: string;
  readonly transcript: string;
  readonly audioDurationMs: number;
  readonly turns?: readonly {
    readonly startMs: number;
    readonly endMs: number;
    readonly transcript: string;
    readonly speaker?: string;
  }[];
}

export class MetaApiError extends Error {
  override name = 'MetaApiError';
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

export interface MetaClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly logger: Logger;
  readonly maxRetries?: number;
  readonly fetch?: typeof fetch;
  /** Delay before retry `attempt` (1-based). Overridable so tests don't sleep. */
  readonly backoffMs?: (attempt: number) => number;
  /** Called after every successful response, e.g. to total usage for a cost estimate. */
  readonly onResponse?: (info: {
    readonly model: string;
    readonly ms: number;
    readonly usage: ResponsesResponse['usage'];
  }) => void;
}

const defaultBackoff = (attempt: number) => 2 ** (attempt - 1) * 500 + Math.random() * 250;

export class MetaClient {
  readonly #options: MetaClientOptions;
  readonly #fetch: typeof fetch;

  constructor(options: MetaClientOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  /**
   * Creates a response. Requests are never stored by the API (`store: false`):
   * inspection photos can show people and vehicles.
   */
  async createResponse(request: ResponsesRequest): Promise<ResponsesResponse> {
    const started = performance.now();
    const body = (await this.#post(request.model, '/responses', () => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, store: false }),
    }))) as ResponsesResponse;
    const ms = Math.round(performance.now() - started);
    this.#options.logger.info(
      { model: request.model, responseId: body.id, status: body.status, ms, usage: body.usage },
      'Meta Model API response',
    );
    this.#options.onResponse?.({ model: request.model, ms, usage: body.usage });
    if (body.status === 'failed' || body.error) {
      throw new MetaApiError(`Model response failed: ${body.error?.message ?? 'unknown error'}`, {
        retryable: false,
      });
    }
    return body;
  }

  /**
   * Chat Completions, the API that self-hosted open-weights servers (Ollama,
   * llama.cpp, vLLM) also speak, e.g. for Muse Glimmer on-premises.
   */
  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const started = performance.now();
    const body = (await this.#post(request.model, '/chat/completions', () => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, store: false }),
    }))) as ChatCompletionResponse;
    const ms = Math.round(performance.now() - started);
    this.#options.logger.info({ model: request.model, ms, usage: body.usage }, 'Chat completion');
    this.#options.onResponse?.({ model: request.model, ms, usage: body.usage });
    return body;
  }

  /**
   * Edits an image from a text instruction (Muse Image). Used only to make
   * labelled synthetic test cases, never in the inspection workflow.
   */
  async editImage(request: {
    readonly model: string;
    readonly prompt: string;
    readonly images: readonly { readonly image_url: string }[];
    readonly output_format?: 'jpeg' | 'png' | 'webp';
  }): Promise<{ readonly data: readonly { readonly b64_json?: string }[] }> {
    return (await this.#post(request.model, '/images/edits', () => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }))) as { data: { b64_json?: string }[] };
  }

  /** Transcribes a WAV file (mono PCM16, 16 or 24 kHz) with Muse Voice Transcribe. */
  async transcribe(
    audio: Uint8Array,
    settings: Readonly<Record<string, unknown>> & { readonly model: string },
  ): Promise<TranscriptionResponse> {
    const started = performance.now();
    const body = (await this.#post(settings.model, '/asr/transcribe', () => {
      const form = new FormData();
      form.set('request', new Blob([JSON.stringify(settings)], { type: 'application/json' }));
      form.set(
        'audio',
        new Blob([audio as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
        'audio.wav',
      );
      return { body: form };
    })) as TranscriptionResponse;
    const ms = Math.round(performance.now() - started);
    this.#options.logger.info(
      { model: settings.model, audioMs: body.audioDurationMs, ms },
      'Meta Model API transcription',
    );
    this.#options.onResponse?.({ model: settings.model, ms, usage: undefined });
    return body;
  }

  /** POSTs with authentication, a timeout and retries; returns the parsed JSON body. */
  async #post(
    model: string,
    path: string,
    build: () => { headers?: Record<string, string>; body: NonNullable<RequestInit['body']> },
  ): Promise<unknown> {
    const maxRetries = this.#options.maxRetries ?? 2;
    const backoff = this.#options.backoffMs ?? defaultBackoff;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#send(path, build());
      } catch (error) {
        if (!(error instanceof MetaApiError) || !error.retryable || attempt >= maxRetries) {
          throw error;
        }
        const delay = backoff(attempt + 1);
        this.#options.logger.warn(
          { model, status: error.status, attempt: attempt + 1, delay },
          'Retrying Meta Model API request',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async #send(
    path: string,
    { headers, body }: { headers?: Record<string, string>; body: NonNullable<RequestInit['body']> },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#options.baseUrl}${path}`, {
        method: 'POST',
        // A self-hosted endpoint may take no key; never send one it wasn't given.
        headers: {
          ...(this.#options.apiKey ? { authorization: `Bearer ${this.#options.apiKey}` } : {}),
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(this.#options.timeoutMs),
      });
    } catch (cause) {
      throw new MetaApiError(`Meta Model API request failed: ${(cause as Error).message}`, {
        retryable: true,
        cause,
      });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new MetaApiError(
        `Meta Model API returned ${response.status}: ${detail.slice(0, 500)}`,
        {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
        },
      );
    }
    return response.json();
  }
}

/** The concatenated output text of a response (reasoning items are skipped). */
export function outputText(response: ResponsesResponse): string {
  let text = '';
  for (const item of response.output) {
    if (item.type !== 'message' || !('content' in item)) continue;
    for (const part of item.content) {
      if (part.type === 'output_text' && part.text) text += part.text;
    }
  }
  return text;
}

export function toDataUrl(image: { data: Uint8Array; mimeType: string }): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`;
}
