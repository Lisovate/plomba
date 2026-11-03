/**
 * A small client for the Plomba API, written the way another company's
 * system would use it:
 * - the installation's address, and an API token sent as
 *   `Authorization: Bearer <token>`;
 * - every response parsed with the zod schemas from @plomba/contracts, the
 *   same schemas the server validates with, so the contracts double as a
 *   typed client and a change on the server fails here, loudly, instead of
 *   as an undefined field three functions later;
 * - errors read from the server's RFC 9457 problem details and thrown as
 *   PlombaApiError, with the HTTP status to branch on (409: the container
 *   already has an open handover).
 */

import {
  type CloseHandoverInput,
  type Container,
  type ContainerHistory,
  ContainerHistorySchema,
  ContainerListSchema,
  ContainerSchema,
  type ContainerSummary,
  type CreateMarkInput,
  type Face,
  type Handover,
  type HandoverDetail,
  HandoverDetailSchema,
  HandoverListSchema,
  HandoverSchema,
  type HandoverSummary,
  type Mark,
  MarkSchema,
  type Photo,
  PhotoSchema,
  type Problem,
  ProblemSchema,
  type RegisterContainer,
  type StartHandoverInput,
  type UpdateMark,
} from '@plomba/contracts';
import type { Quad } from '@plomba/core';
import type { z } from 'zod';

/** The server answered with an error status. */
export class PlombaApiError extends Error {
  override name = 'PlombaApiError';
  /** The HTTP status: 400 invalid input, 401 no or wrong token, 404 not found, 409 conflict. */
  readonly status: number;
  /** The problem details the server sent, if it sent any. */
  readonly problem: Problem | undefined;
  readonly method: string;
  readonly path: string;

  constructor(request: { method: string; path: string }, status: number, problem?: Problem) {
    const issues = problem?.issues?.map((i) => `${i.path || 'body'}: ${i.message}`) ?? [];
    super(
      `${request.method} ${request.path} answered ${status}: ${problem?.title ?? 'no details'}` +
        (issues.length > 0 ? ` (${issues.join('; ')})` : ''),
    );
    this.status = status;
    this.problem = problem;
    this.method = request.method;
    this.path = request.path;
  }
}

/** The server couldn't be reached, or took too long. */
export class PlombaUnreachableError extends Error {
  override name = 'PlombaUnreachableError';
}

/** The server answered 2xx with something the contracts don't describe: client and server disagree. */
export class PlombaContractError extends Error {
  override name = 'PlombaContractError';
}

export interface PlombaClientOptions {
  /** The installation's address, e.g. https://plomba.example.com (without /api). */
  readonly baseUrl: string;
  /** One of the installation's API tokens (PLOMBA_API_TOKENS_FILE). */
  readonly token?: string | undefined;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

interface RequestOptions {
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly json?: unknown;
  readonly form?: FormData;
}

export class PlombaClient {
  /** The installation's address, without a trailing slash; links are built from it. */
  readonly baseUrl: string;
  readonly #token: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: PlombaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#token = options.token?.trim() || undefined;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#fetch = options.fetch ?? fetch;
  }

  // Containers ---------------------------------------------------------------

  /** Containers whose number starts with `owner` (e.g. PLBU), most recently handed over first. */
  listContainers(options: { owner?: string; limit?: number } = {}): Promise<ContainerSummary[]> {
    return this.request('GET', '/containers', ContainerListSchema, {
      query: { owner: options.owner, limit: options.limit },
    });
  }

  /** Registers a container; registering one that exists returns it (and updates its size/type). */
  registerContainer(input: RegisterContainer): Promise<Container> {
    return this.request('POST', '/containers', ContainerSchema, { json: input });
  }

  /** Every handover of a container, whether its hash chain verifies, and its damage passport. */
  containerHistory(number: string): Promise<ContainerHistory> {
    return this.request('GET', `/containers/${encodeURIComponent(number)}`, ContainerHistorySchema);
  }

  // Handovers ----------------------------------------------------------------

  /** The 30 most recent handovers of the installation, open ones first. */
  recentHandovers(): Promise<HandoverSummary[]> {
    return this.request('GET', '/handovers', HandoverListSchema);
  }

  startHandover(input: StartHandoverInput): Promise<Handover> {
    return this.request('POST', '/handovers', HandoverSchema, { json: input });
  }

  /** A handover with its photos and marks. */
  handover(id: string): Promise<HandoverDetail> {
    return this.request('GET', `/handovers/${encodeURIComponent(id)}`, HandoverDetailSchema);
  }

  /** The EDIFACT CODECO gate message of a sealed handover. */
  codeco(id: string, recipient: string): Promise<string> {
    return this.text('GET', `/handovers/${encodeURIComponent(id)}/codeco`, {
      query: { recipient },
    });
  }

  // Recording a handover (what the app does; also open to camera portals) ---

  addPhoto(handoverId: string, face: Face, jpeg: Uint8Array): Promise<Photo> {
    const form = new FormData();
    form.set('face', face);
    form.set('image', new File([jpeg as Uint8Array<ArrayBuffer>], `${face}.jpg`));
    return this.request(
      'POST',
      `/handovers/${encodeURIComponent(handoverId)}/photos`,
      PhotoSchema,
      {
        form,
      },
    );
  }

  /** Sets where the face's corners are in the photo: top-left, top-right, bottom-right, bottom-left. */
  setPhotoCorners(handoverId: string, photoId: string, corners: Quad): Promise<Photo> {
    const path = `/handovers/${encodeURIComponent(handoverId)}/photos/${encodeURIComponent(photoId)}/corners`;
    return this.request('PUT', path, PhotoSchema, { json: { corners } });
  }

  addMark(handoverId: string, mark: CreateMarkInput): Promise<Mark> {
    return this.request('POST', `/handovers/${encodeURIComponent(handoverId)}/marks`, MarkSchema, {
      json: mark,
    });
  }

  updateMark(handoverId: string, markId: string, patch: UpdateMark): Promise<Mark> {
    const path = `/handovers/${encodeURIComponent(handoverId)}/marks/${encodeURIComponent(markId)}`;
    return this.request('PATCH', path, MarkSchema, { json: patch });
  }

  /** Seals the handover into the container's hash chain. */
  closeHandover(id: string, options: CloseHandoverInput = {}): Promise<Handover> {
    return this.request('POST', `/handovers/${encodeURIComponent(id)}/close`, HandoverSchema, {
      json: options,
    });
  }

  // Transport ----------------------------------------------------------------

  /** Any JSON call, its answer parsed with `schema`. */
  async request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    options: RequestOptions = {},
  ): Promise<z.output<S>> {
    const response = await this.#send(method, path, options);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PlombaContractError(`${method} ${path} answered ${response.status} without JSON`);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      );
      throw new PlombaContractError(
        `${method} ${path} answered with an unexpected shape: ${issues.slice(0, 5).join('; ')}`,
      );
    }
    return parsed.data;
  }

  /** Any call answered with text, e.g. an EDIFACT message. */
  async text(method: string, path: string, options: RequestOptions = {}): Promise<string> {
    return (await this.#send(method, path, options)).text();
  }

  async #send(method: string, path: string, options: RequestOptions): Promise<Response> {
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ accept: 'application/json' });
    if (this.#token) headers.set('authorization', `Bearer ${this.#token}`);
    let body: string | FormData | undefined;
    if (options.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? (error.cause ?? error).toString() : String(error);
      throw new PlombaUnreachableError(`Can't reach Plomba at ${this.baseUrl}: ${reason}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new PlombaApiError({ method, path }, response.status, await readProblem(response));
    }
    return response;
  }
}

async function readProblem(response: Response): Promise<Problem | undefined> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = ProblemSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON: a proxy in front of Plomba, perhaps. Keep the start of what it said.
  }
  const title = text.trim().slice(0, 200);
  return title ? { type: 'about:blank', title, status: response.status } : undefined;
}
