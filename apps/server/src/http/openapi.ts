/**
 * The OpenAPI 3.1 description of the API, served at /api/openapi.json for
 * other systems to integrate with. It's generated from the same zod
 * contracts the server validates with, so it can't drift from the API; a
 * test checks that every operation listed here is a real route.
 */

import {
  ClaimResultSchema,
  CloseHandoverSchema,
  ContainerHistorySchema,
  ContainerListSchema,
  ContainerSchema,
  CreateMarkSchema,
  DraftClaimSchema,
  FaceViewsSchema,
  FrameRegistrationSchema,
  HandoverDetailSchema,
  HandoverListSchema,
  HandoverSchema,
  HandoverSearchSchema,
  IdentifyResultSchema,
  InstanceSchema,
  LoginSchema,
  MarkSchema,
  PhotoSchema,
  ProblemSchema,
  ProposalsSchema,
  RegisterContainerSchema,
  SamplesSchema,
  SessionSchema,
  SpokenDamageResultSchema,
  StartHandoverSchema,
  TranscriptionSchema,
  UpdateCornersSchema,
  UpdateMarkSchema,
  VideoSchema,
  VideoTrackingSchema,
  VideoViewsSchema,
  WebhookEventSchema,
} from '@plomba/contracts';
import { z } from 'zod';

type Method = 'get' | 'post' | 'put' | 'patch';

/** A multipart upload: its fields, and which of them are files. */
interface Multipart {
  readonly fields: Readonly<Record<string, 'file' | 'files' | 'string'>>;
  readonly required: readonly string[];
  readonly jsonFields?: Readonly<Record<string, z.ZodType>>;
}

export interface Operation {
  readonly method: Method;
  /** OpenAPI style: /handovers/{id}. */
  readonly path: string;
  readonly summary: string;
  readonly tag: 'Containers' | 'Handovers' | 'Marks' | 'Video' | 'Models' | 'Session';
  readonly query?: Readonly<Record<string, string>>;
  readonly querySchema?: z.ZodObject;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly body?: z.ZodType | Multipart;
  /** The 2xx response: a schema, or a content type for non-JSON answers. */
  readonly response: z.ZodType | { readonly contentType: string | readonly string[] };
  readonly status?: 200 | 201 | 204;
}

export const OPERATIONS: readonly Operation[] = [
  {
    method: 'get',
    path: '/session',
    summary: 'Whether this installation asks for an access code, and whether you have a session',
    tag: 'Session',
    response: SessionSchema,
  },
  {
    method: 'post',
    path: '/session',
    summary: 'Exchange the access code for a session cookie',
    tag: 'Session',
    body: LoginSchema,
    response: { contentType: 'none' },
    status: 204,
  },
  {
    method: 'get',
    path: '/instance',
    summary: "This installation's notice and capabilities",
    tag: 'Session',
    response: InstanceSchema,
  },
  {
    method: 'post',
    path: '/identify',
    summary:
      'Read and verify the container number from a photo of the doors (Muse Spark + ISO 6346 check digit)',
    tag: 'Models',
    body: { fields: { image: 'file' }, required: ['image'] },
    response: IdentifyResultSchema,
  },
  {
    method: 'post',
    path: '/transcribe',
    summary:
      'Transcribe a spoken note (WAV, mono, 16-bit, 16 or 24 kHz) with Muse Voice Transcribe',
    tag: 'Models',
    body: { fields: { audio: 'file' }, required: ['audio'] },
    response: TranscriptionSchema,
  },
  {
    method: 'get',
    path: '/containers',
    summary: 'List containers, optionally by owner code, most recently handed over first',
    tag: 'Containers',
    query: {
      owner: 'Owner code, e.g. PLBU or PLB',
      limit: 'At most this many (1–500, default 100)',
    },
    response: ContainerListSchema,
  },
  {
    method: 'post',
    path: '/containers',
    summary: 'Register a container by its ISO 6346 number and size/type code',
    tag: 'Containers',
    body: RegisterContainerSchema,
    response: ContainerSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/containers/{number}',
    summary: "A container's handovers, hash-chain status and damage passport",
    tag: 'Containers',
    response: ContainerHistorySchema,
  },
  {
    method: 'get',
    path: '/handovers',
    summary: 'Search handovers, newest first; bare requests keep open handovers first',
    tag: 'Handovers',
    query: {
      vehicle: 'Truck plate or wagon number; spaces, hyphens and case are ignored',
      container: 'ISO 6346 container number; normalised and check-digit validated',
      status: 'open or closed',
      direction: 'in or out',
      place: 'Exact place name (case-sensitive)',
      limit: 'Page size (1–100, default 30)',
      cursor: 'Opaque cursor from the next-page Link header; invalid cursors return 400',
    },
    querySchema: HandoverSearchSchema,
    responseHeaders: {
      Link: 'When more results exist: <relative URL with cursor and the same filters>; rel="next" (RFC 8288). Absent on the last page.',
    },
    response: HandoverListSchema,
  },
  {
    method: 'post',
    path: '/handovers',
    summary: 'Start a handover (gate in or out) of a registered container',
    tag: 'Handovers',
    body: StartHandoverSchema,
    response: HandoverSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/handovers/{id}',
    summary: 'A handover with its photos, videos, marks and the previous handover’s marks',
    tag: 'Handovers',
    response: HandoverDetailSchema,
  },
  {
    method: 'post',
    path: '/handovers/{id}/close',
    summary: 'Seal the handover into the container’s hash chain',
    tag: 'Handovers',
    body: CloseHandoverSchema,
    response: HandoverSchema,
  },
  {
    method: 'get',
    path: '/handovers/{id}/codeco',
    summary: 'The EDIFACT CODECO D.95B gate message of a sealed handover',
    tag: 'Handovers',
    query: { recipient: 'The recipient’s EDI ID (UNB)' },
    response: { contentType: 'text/plain' },
  },
  {
    method: 'post',
    path: '/handovers/{id}/claim',
    summary: 'Draft a claim for new damage, verified against the sealed records (Muse Spark agent)',
    tag: 'Handovers',
    body: DraftClaimSchema,
    response: ClaimResultSchema,
  },
  {
    method: 'post',
    path: '/handovers/{id}/photos',
    summary:
      'Add a photo of a face; it is registered (SAM 3.1) and faces and number plates are blurred',
    tag: 'Handovers',
    body: {
      fields: { face: 'string', image: 'file', capturedAt: 'string' },
      required: ['face', 'image'],
    },
    response: PhotoSchema,
    status: 201,
  },
  {
    method: 'post',
    path: '/handovers/{id}/videos',
    summary:
      'Blur people and number plates and keep a silent MP4 as evidence (MP4/MOV/WebM input, 150 MB body limit, at most 3 clips); retries reuse the attachment; 503 without video redaction',
    tag: 'Video',
    body: {
      fields: { video: 'file', views: 'string' },
      required: ['video'],
      jsonFields: { views: VideoViewsSchema },
    },
    response: VideoSchema,
    status: 201,
  },
  {
    method: 'get',
    path: '/handovers/{id}/videos/{videoId}/tracking',
    summary: 'Cached tracking for a stored clip; 404 when tracking is unavailable',
    tag: 'Video',
    response: VideoTrackingSchema,
  },
  {
    method: 'put',
    path: '/handovers/{id}/photos/{photoId}/corners',
    summary: 'Set a photo’s face corners by hand',
    tag: 'Handovers',
    body: UpdateCornersSchema,
    response: PhotoSchema,
  },
  {
    method: 'post',
    path: '/handovers/{id}/photos/{photoId}/proposals',
    summary: 'Find and outline damage on a photo (Muse Spark + SAM 3.1), as proposals to confirm',
    tag: 'Marks',
    response: ProposalsSchema,
    status: 201,
  },
  {
    method: 'post',
    path: '/handovers/{id}/frames',
    summary: 'Find the face in a live camera frame; nothing is stored',
    tag: 'Handovers',
    body: { fields: { image: 'file' }, required: ['image'] },
    response: FrameRegistrationSchema,
  },
  {
    method: 'post',
    path: '/handovers/{id}/marks',
    summary: 'Record a damage mark on a face, in metres; the CEDEX location code is computed',
    tag: 'Marks',
    body: CreateMarkSchema,
    response: MarkSchema,
    status: 201,
  },
  {
    method: 'patch',
    path: '/handovers/{id}/marks/{markId}',
    summary: 'Confirm, reject or edit a mark',
    tag: 'Marks',
    body: UpdateMarkSchema,
    response: MarkSchema,
  },
  {
    method: 'post',
    path: '/handovers/{id}/spoken-damage',
    summary: 'Damage said aloud, coded to CEDEX and placed on the sections named, as proposals',
    tag: 'Marks',
    body: { fields: { face: 'string', audio: 'file' }, required: ['face', 'audio'] },
    response: SpokenDamageResultSchema,
  },
  {
    method: 'post',
    path: '/videos/track',
    summary: 'Track the container through a walk-around clip (SAM 3.1); the clip is not stored',
    tag: 'Video',
    body: { fields: { video: 'file' }, required: ['video'] },
    response: VideoTrackingSchema,
  },
  {
    method: 'post',
    path: '/videos/faces',
    summary:
      'Name each face (Muse Spark); optional source JSON: tracked clip sha256 and ordered frames',
    tag: 'Video',
    body: { fields: { frame: 'files', source: 'string' }, required: ['frame'] },
    response: FaceViewsSchema,
  },
  {
    method: 'get',
    path: '/samples',
    summary: 'Sample clips and photos, with credits, photo roles and optional container links',
    tag: 'Video',
    response: SamplesSchema,
  },
  {
    method: 'get',
    path: '/samples/{file}',
    summary: 'Download a listed sample clip or JPEG photo',
    tag: 'Video',
    response: { contentType: ['video/mp4', 'video/quicktime', 'image/jpeg'] },
  },
];

const json = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { io, unrepresentable: 'any' });

function requestBody(body: z.ZodType | Multipart) {
  if (body instanceof z.ZodType) {
    return { required: true, content: { 'application/json': { schema: json(body, 'input') } } };
  }
  const properties = Object.fromEntries(
    Object.entries(body.fields).map(([name, kind]) => [
      name,
      kind === 'string'
        ? {
            type: 'string',
            ...(body.jsonFields?.[name]
              ? {
                  contentMediaType: 'application/json',
                  contentSchema: json(body.jsonFields[name], 'input'),
                }
              : {}),
          }
        : kind === 'file'
          ? { type: 'string', format: 'binary' }
          : { type: 'array', items: { type: 'string', format: 'binary' } },
    ]),
  );
  return {
    required: true,
    content: {
      'multipart/form-data': {
        schema: { type: 'object', properties, required: [...body.required] },
      },
    },
  };
}

function responseContent(response: Operation['response']) {
  if (response instanceof z.ZodType) {
    return { 'application/json': { schema: json(response, 'output') } };
  }
  return response.contentType === 'none'
    ? undefined
    : Object.fromEntries(
        (typeof response.contentType === 'string'
          ? [response.contentType]
          : response.contentType
        ).map((type) => [
          type,
          {
            schema: {
              type: 'string',
              ...(/^(image|video)\//.test(type) ? { format: 'binary' } : {}),
            },
          },
        ]),
      );
}

const problem = {
  description: 'Problem details (RFC 9457)',
  content: { 'application/problem+json': { schema: json(ProblemSchema, 'output') } },
};

/** The version of this API description; bumped when the API changes. */
export const API_VERSION = '1.2.0';

export function openApiDocument(options: { readonly serverUrl: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const parameters = [
      ...[...op.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      ...Object.entries(op.query ?? {}).map(([name, description]) => ({
        name,
        in: 'query',
        required: false,
        description,
        schema: op.querySchema?.shape[name]
          ? json(op.querySchema.shape[name], 'input')
          : { type: 'string' },
      })),
    ];
    const content = responseContent(op.response);
    paths[op.path] = paths[op.path] ?? {};
    (paths[op.path] as Record<string, unknown>)[op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(op.body ? { requestBody: requestBody(op.body) } : {}),
      responses: {
        [op.status ?? 200]: {
          description: 'OK',
          ...(content ? { content } : {}),
          ...(op.responseHeaders
            ? {
                headers: Object.fromEntries(
                  Object.entries(op.responseHeaders).map(([name, description]) => [
                    name,
                    { description, schema: { type: 'string' } },
                  ]),
                ),
              }
            : {}),
        },
        '4XX': problem,
        '5XX': problem,
      },
    };
  }
  const webhook = (summary: string) => ({
    post: {
      summary,
      parameters: [
        {
          name: 'Plomba-Signature',
          in: 'header',
          required: true,
          description:
            't=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with your webhook secret>',
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        content: { 'application/json': { schema: json(WebhookEventSchema, 'output') } },
      },
      responses: { '2XX': { description: 'Received; anything else is retried with backoff' } },
    },
  });
  return {
    openapi: '3.1.0',
    info: {
      title: 'Plomba API',
      version: API_VERSION,
      description:
        'Record and verify a shipping container’s condition at every handover. Authenticate with a session cookie (POST /session with the access code) or, for other systems, `Authorization: Bearer <API token>`.',
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
    },
    servers: [{ url: `${options.serverUrl.replace(/\/+$/, '')}/api` }],
    security: [{ apiToken: [] }, { session: [] }],
    components: {
      securitySchemes: {
        apiToken: { type: 'http', scheme: 'bearer', description: 'From PLOMBA_API_TOKENS_FILE' },
        session: { type: 'apiKey', in: 'cookie', name: 'plomba_session' },
      },
    },
    paths,
    webhooks: {
      'handover.started': webhook('A handover was started'),
      'handover.sealed': webhook(
        'A handover was sealed: its marks, the history of each damage, and links to the EIR and CODECO',
      ),
    },
  };
}
