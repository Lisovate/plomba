/**
 * The Plomba HTTP API. Every response is parsed with the same schemas the
 * server validates against, so a mismatch fails here, loudly, not three
 * components later.
 */

import {
  ClaimResultSchema,
  type CloseHandoverInput,
  type ContainerHistory,
  ContainerHistorySchema,
  ContainerSchema,
  type CreateMarkInput,
  type Face,
  FrameRegistrationSchema,
  HandoverDetailSchema,
  HandoverListSchema,
  HandoverSchema,
  IdentifyResultSchema,
  MarkSchema,
  PhotoSchema,
  type Problem,
  ProblemSchema,
  ProposalsSchema,
  type RegisterContainer,
  SessionSchema,
  type StartHandoverInput,
  TranscriptionSchema,
  type UpdateMark,
} from '@plomba/contracts';
import type { Quad } from '@plomba/core';
import type { z } from 'zod';

export class ApiError extends Error {
  override name = 'ApiError';
  readonly status: number;
  readonly problem: Problem | undefined;

  constructor(message: string, status: number, problem?: Problem) {
    super(message);
    this.status = status;
    this.problem = problem;
  }
}

async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const problem = ProblemSchema.safeParse(body);
    throw new ApiError(
      problem.success ? problem.data.title : response.statusText,
      response.status,
      problem.success ? problem.data : undefined,
    );
  }
  return schema.parse(await response.json());
}

function json(method: 'POST' | 'PUT' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function upload(fields: Record<string, string | Blob>): RequestInit {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value instanceof Blob) form.set(name, value, `${name}.jpg`);
    else form.set(name, value);
  }
  return { method: 'POST', body: form };
}

const path = (strings: TemplateStringsArray, ...params: string[]) =>
  strings.reduce(
    (out, s, i) => out + s + (i < params.length ? encodeURIComponent(params[i] as string) : ''),
    '',
  );

export const api = {
  session: () => request('/api/session', {}, SessionSchema),

  login: async (code: string) => {
    const response = await fetch('/api/session', json('POST', { code }));
    if (!response.ok) {
      const problem = ProblemSchema.safeParse(await response.json().catch(() => undefined));
      throw new ApiError(
        problem.success ? problem.data.title : response.statusText,
        response.status,
        problem.success ? problem.data : undefined,
      );
    }
  },

  identify: (image: Blob) => request('/api/identify', upload({ image }), IdentifyResultSchema),

  transcribe: (audio: Blob) => {
    const form = new FormData();
    form.set('audio', audio, 'note.wav');
    return request('/api/transcribe', { method: 'POST', body: form }, TranscriptionSchema);
  },

  registerContainer: (body: RegisterContainer) =>
    request('/api/containers', json('POST', body), ContainerSchema),

  containerHistory: (number: string): Promise<ContainerHistory> =>
    request(path`/api/containers/${number}`, {}, ContainerHistorySchema),

  recentHandovers: () => request('/api/handovers', {}, HandoverListSchema),

  startHandover: (body: StartHandoverInput) =>
    request('/api/handovers', json('POST', body), HandoverSchema),

  handover: (id: string) => request(path`/api/handovers/${id}`, {}, HandoverDetailSchema),

  uploadPhoto: (id: string, face: Face, image: Blob) =>
    request(
      path`/api/handovers/${id}/photos`,
      upload({ face, image, capturedAt: new Date().toISOString() }),
      PhotoSchema,
    ),

  registerFrame: (id: string, frame: Blob) =>
    request(path`/api/handovers/${id}/frames`, upload({ image: frame }), FrameRegistrationSchema),

  updateCorners: (id: string, photoId: string, corners: Quad) =>
    request(
      path`/api/handovers/${id}/photos/${photoId}/corners`,
      json('PUT', { corners }),
      PhotoSchema,
    ),

  proposeDamage: (id: string, photoId: string) =>
    request(
      path`/api/handovers/${id}/photos/${photoId}/proposals`,
      { method: 'POST' },
      ProposalsSchema,
    ),

  addMark: (id: string, body: CreateMarkInput) =>
    request(path`/api/handovers/${id}/marks`, json('POST', body), MarkSchema),

  updateMark: (id: string, markId: string, patch: UpdateMark) =>
    request(path`/api/handovers/${id}/marks/${markId}`, json('PATCH', patch), MarkSchema),

  draftClaim: (id: string, language: 'en' | 'pl') =>
    request(path`/api/handovers/${id}/claim`, json('POST', { language }), ClaimResultSchema),

  closeHandover: (id: string, options: CloseHandoverInput = {}) =>
    request(path`/api/handovers/${id}/close`, json('POST', options), HandoverSchema),
};

export const queryKeys = {
  session: ['session'] as const,
  recent: ['handovers'] as const,
  handover: (id: string) => ['handovers', id] as const,
  container: (number: string) => ['containers', number] as const,
};
