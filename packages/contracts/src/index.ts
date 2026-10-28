/**
 * The HTTP API between the Plomba server and its clients. Every request body
 * is validated against these schemas on the server, and the web app parses
 * responses with them, so both sides fail loudly on a mismatch.
 */

import { FACES, isComponentCode, isDamageCode } from '@plomba/core';
import { z } from 'zod';

const isoDateTime = z.iso.datetime({ offset: true });

export const FaceSchema = z.enum(FACES);

export const PointSchema = z.object({ x: z.number(), y: z.number() });

export const QuadSchema = z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]);

export const FaceRectSchema = z
  .object({ u0: z.number(), v0: z.number(), u1: z.number(), v1: z.number() })
  .refine((r) => r.u0 <= r.u1 && r.v0 <= r.v1, 'u0 ≤ u1 and v0 ≤ v1');

export const DimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const damageCode = z.string().refine(isDamageCode, 'Unknown CEDEX damage code');
const componentCode = z.string().refine(isComponentCode, 'Unknown CEDEX component code');

// Identification ---------------------------------------------------------

/** What the vision model read from the photo, before any checking. */
export const MarkingsReadSchema = z.object({
  containerNumber: z.string().nullable(),
  sizeTypeCode: z.string().nullable(),
  sealNumbers: z.array(z.string()),
  hazardClasses: z.array(z.string()),
  notes: z.string(),
});

export const NumberCandidateSchema = z.object({
  containerNumber: z.string(),
  changedPositions: z.array(z.number().int().min(0).max(10)),
});

/**
 * - `verified`: the read passed the ISO 6346 check digit as it was;
 * - `corrected`: it failed, and exactly one look-alike repair passed (or the model chose one);
 * - `ambiguous`: several repairs pass, the checker must choose;
 * - `unreadable`: no number, or nothing close to a valid one.
 */
export const NumberVerdictSchema = z.enum(['verified', 'corrected', 'ambiguous', 'unreadable']);

export const IdentifyResultSchema = z.object({
  read: MarkingsReadSchema,
  verdict: NumberVerdictSchema,
  containerNumber: z.string().nullable(),
  candidates: z.array(NumberCandidateSchema),
  explanation: z.string(),
});

// Containers and handovers -----------------------------------------------

export const ContainerSchema = z.object({
  number: z.string(),
  sizeTypeCode: z.string().nullable(),
  dimensions: DimensionsSchema,
  createdAt: isoDateTime,
});

export const RegisterContainerSchema = z.object({
  number: z.string().min(11).max(20),
  sizeTypeCode: z.string().max(4).nullable().optional(),
});

export const DirectionSchema = z.enum(['in', 'out']);

export const HandoverStatusSchema = z.enum(['open', 'closed']);

export const StartHandoverSchema = z.object({
  containerNumber: z.string(),
  direction: DirectionSchema,
  place: z.string().trim().min(1).max(200),
  checker: z.string().trim().min(1).max(200),
  handedOverBy: z.string().trim().max(200).optional(),
  receivedBy: z.string().trim().max(200).optional(),
  sealNumbers: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

export const HandoverSchema = z.object({
  id: z.uuid(),
  containerNumber: z.string(),
  direction: DirectionSchema,
  place: z.string(),
  checker: z.string(),
  handedOverBy: z.string().nullable(),
  receivedBy: z.string().nullable(),
  sealNumbers: z.array(z.string()),
  status: HandoverStatusSchema,
  startedAt: isoDateTime,
  closedAt: isoDateTime.nullable(),
  previousHandoverId: z.uuid().nullable(),
  /** Set when the handover is closed and sealed into the container's history. */
  seal: z
    .object({ sequence: z.number().int(), previousHash: z.string(), hash: z.string() })
    .nullable(),
});

export const PhotoSchema = z.object({
  id: z.uuid(),
  handoverId: z.uuid(),
  face: FaceSchema,
  url: z.string(),
  sha256: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  /** The face's corners in the photo, once registered. */
  corners: QuadSchema.nullable(),
  cornersSource: z.enum(['detected', 'adjusted']).nullable(),
  redactedRegions: z.number().int(),
  capturedAt: isoDateTime,
});

export const UpdateCornersSchema = z.object({ corners: QuadSchema });

export const MarkStatusSchema = z.enum(['new', 'still-there', 'changed', 'repaired']);

export const MarkSourceSchema = z.enum(['proposed', 'confirmed', 'rejected']);

export const MarkSchema = z.object({
  id: z.uuid(),
  handoverId: z.uuid(),
  face: FaceSchema,
  rect: FaceRectSchema,
  locationCode: z.string(),
  damageCode: damageCode.nullable(),
  componentCode: componentCode.nullable(),
  status: MarkStatusSchema,
  source: MarkSourceSchema,
  previousMarkId: z.uuid().nullable(),
  photoId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTime,
});

export const CreateMarkSchema = z.object({
  face: FaceSchema,
  rect: FaceRectSchema,
  damageCode: damageCode.nullable().default(null),
  componentCode: componentCode.nullable().default(null),
  status: MarkStatusSchema.default('new'),
  source: MarkSourceSchema.default('confirmed'),
  previousMarkId: z.uuid().nullable().default(null),
  photoId: z.uuid().nullable().default(null),
  note: z.string().max(2000).nullable().default(null),
});

export const UpdateMarkSchema = z
  .object({
    rect: FaceRectSchema,
    damageCode: damageCode.nullable(),
    componentCode: componentCode.nullable(),
    status: MarkStatusSchema,
    source: MarkSourceSchema,
    note: z.string().max(2000).nullable(),
  })
  .partial();

export const HandoverDetailSchema = z.object({
  handover: HandoverSchema,
  container: ContainerSchema,
  photos: z.array(PhotoSchema),
  marks: z.array(MarkSchema),
  /** Marks recorded at the previous handover of this container, to be confirmed again. */
  previousMarks: z.array(MarkSchema),
});

export const ChainStatusSchema = z.object({
  ok: z.boolean(),
  length: z.number().int(),
  brokenAt: z.number().int().nullable(),
});

export const ContainerHistorySchema = z.object({
  container: ContainerSchema,
  handovers: z.array(HandoverSchema),
  chain: ChainStatusSchema,
});

// Errors -------------------------------------------------------------------

/** RFC 9457 problem details. */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type Face = z.infer<typeof FaceSchema>;
export type MarkingsRead = z.infer<typeof MarkingsReadSchema>;
export type NumberCandidate = z.infer<typeof NumberCandidateSchema>;
export type NumberVerdict = z.infer<typeof NumberVerdictSchema>;
export type IdentifyResult = z.infer<typeof IdentifyResultSchema>;
export type Container = z.infer<typeof ContainerSchema>;
export type RegisterContainer = z.infer<typeof RegisterContainerSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type StartHandover = z.infer<typeof StartHandoverSchema>;
export type Handover = z.infer<typeof HandoverSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type MarkStatus = z.infer<typeof MarkStatusSchema>;
export type MarkSource = z.infer<typeof MarkSourceSchema>;
export type Mark = z.infer<typeof MarkSchema>;
export type CreateMark = z.infer<typeof CreateMarkSchema>;
export type UpdateMark = z.infer<typeof UpdateMarkSchema>;
export type HandoverDetail = z.infer<typeof HandoverDetailSchema>;
export type ChainStatus = z.infer<typeof ChainStatusSchema>;
export type ContainerHistory = z.infer<typeof ContainerHistorySchema>;
export type Problem = z.infer<typeof ProblemSchema>;
