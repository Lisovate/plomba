/**
 * A small client for the Meta Model API's Responses endpoint
 * (https://dev.meta.ai/docs). Plain `fetch`, no SDK, so the request that goes
 * over the wire is the one written here.
 */

import type { Logger } from 'pino';

export type ResponsesContent =
  | { readonly type: 'input_text'; readonly text: string }
  | { readonly type: 'input_image'; readonly image_url: string };

export interface ResponsesRequest {
  readonly model: string;
  readonly input: readonly {
    readonly type: 'message';
    readonly role: 'user' | 'system' | 'developer';
    readonly content: readonly ResponsesContent[];
  }[];
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
    | { readonly type: string }
  )[];
  readonly usage?: Readonly<Record<string, unknown>>;
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
    const maxRetries = this.#options.maxRetries ?? 2;
    const backoff = this.#options.backoffMs ?? defaultBackoff;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#send(request);
      } catch (error) {
        if (!(error instanceof MetaApiError) || !error.retryable || attempt >= maxRetries) {
          throw error;
        }
        const delay = backoff(attempt + 1);
        this.#options.logger.warn(
          { model: request.model, status: error.status, attempt: attempt + 1, delay },
          'Retrying Meta Model API request',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async #send(request: ResponsesRequest): Promise<ResponsesResponse> {
    const started = performance.now();
    let response: Response;
    try {
      response = await this.#fetch(`${this.#options.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...request, store: false }),
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

    const body = (await response.json()) as ResponsesResponse;
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
