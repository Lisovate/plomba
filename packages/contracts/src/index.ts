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
 * - `verified`: the read passed the ISO 6346 check digit as it was. The only
 *   verdict that comes with a `containerNumber`;
 * - `suggested`: it failed; the first candidate is the only look-alike repair
 *   that passes, or the one the model picked. The checker must confirm it;
 * - `ambiguous`: several repairs pass equally; the checker must choose;
 * - `unreadable`: no number, or nothing close to a valid one.
 */
export const NumberVerdictSchema = z.enum(['verified', 'suggested', 'ambiguous', 'unreadable']);

export const IdentifyResultSchema = z.object({
  read: MarkingsReadSchema,
  verdict: NumberVerdictSchema,
  /** Set only when `verdict` is `verified`. */
  containerNumber: z.string().nullable(),
  candidates: z.array(NumberCandidateSchema),
  /** In English, for logs and API users; the app builds its own in the checker's language. */
  explanation: z.string(),
  /** Muse Spark's reason when it picked between candidates (in English). */
  modelNote: z.string().nullable(),
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

/** How the container arrived or left: by truck or by rail wagon. */
export const TransportModeSchema = z.enum(['road', 'rail']);

export const StartHandoverSchema = z.object({
  containerNumber: z.string(),
  direction: DirectionSchema,
  place: z.string().trim().min(1).max(200),
  checker: z.string().trim().min(1).max(200),
  handedOverBy: z.string().trim().max(200).optional(),
  receivedBy: z.string().trim().max(200).optional(),
  sealNumbers: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  transportMode: TransportModeSchema.optional(),
  /** The truck's registration, or the wagon's UIC number (checked) for rail. */
  vehicleId: z.string().trim().min(1).max(40).optional(),
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
  transportMode: TransportModeSchema.nullable(),
  vehicleId: z.string().nullable(),
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

/** The container's face, frame by frame, in a recorded video (SAM 3.1 video tracking). */
export const VideoTrackingSchema = z.object({
  /** The highest tracked frame index plus one; with the clip's duration, its frame rate. */
  frameCount: z.number().int(),
  frames: z.array(z.object({ frame: z.number().int(), corners: QuadSchema })),
  /** True when the same clip was tracked before and the result came from the cache. */
  cached: z.boolean(),
});

/** Which face of the container one frame of a walk-around shows, as judged by the vision model. */
export const FaceViewSchema = z.object({
  /** The face seen square-on, or null when no single face is (a corner, the ground, a close-up). */
  face: FaceSchema.nullable(),
  /** True when the whole face is in view, roughly square-on. */
  squareOn: z.boolean(),
  /** The model's own confidence in `face`, 0–1. */
  confidence: z.number().min(0).max(1),
  /** A few words on what is in view, from the model. */
  note: z.string(),
});

/** The faces in a walk-around's chosen frames, in the order they were sent. */
export const FaceViewsSchema = z.object({ views: z.array(FaceViewSchema) });

/** Where the face is in a live camera frame. Frames are never stored. */
export const FrameRegistrationSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  corners: QuadSchema.nullable(),
});

export const MarkStatusSchema = z.enum(['new', 'still-there', 'changed', 'repaired']);

export const MarkSourceSchema = z.enum(['proposed', 'confirmed', 'rejected']);

export const MarkSchema = z.object({
  id: z.uuid(),
  handoverId: z.uuid(),
  face: FaceSchema,
  rect: FaceRectSchema,
  /** The damage's outline on the face in metres, when a model traced it. */
  outline: z.array(PointSchema).max(64).nullable(),
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
  outline: z.array(PointSchema).max(64).nullable().default(null),
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

/** Damage the models proposed on one photo, stored as marks with source `proposed`. */
export const ProposalsSchema = z.array(MarkSchema);

/** What a spoken damage note became, as proposals for the checker to confirm. */
export const SpokenDamageResultSchema = z.object({
  /** What Muse Voice Transcribe heard. */
  transcript: z.string(),
  /** One proposed mark per damage placed on the container. */
  marks: z.array(MarkSchema),
  /** Damage described without a place the container has, in the checker's words. */
  unplaced: z.array(z.string()),
});

export const HandoverDetailSchema = z.object({
  handover: HandoverSchema,
  container: ContainerSchema,
  photos: z.array(PhotoSchema),
  marks: z.array(MarkSchema),
  /** Marks recorded at the previous handover of this container, to be confirmed again. */
  previousMarks: z.array(MarkSchema),
});

export const HandoverSummarySchema = HandoverSchema.extend({
  markCount: z.number().int(),
  photoCount: z.number().int(),
});

export const HandoverListSchema = z.array(HandoverSummarySchema);

export const CloseHandoverSchema = z.object({
  /**
   * Seal even though some CEDEX sections have no photo. The sealed record then
   * lists them as not inspected.
   */
  acceptGaps: z.boolean().default(false),
});

export const ChainStatusSchema = z.object({
  ok: z.boolean(),
  length: z.number().int(),
  brokenAt: z.number().int().nullable(),
});

/**
 * One damage followed through the sealed handovers: first recorded at one,
 * not there at the latest earlier one that inspected the spot. It happened
 * in between.
 */
export const DamageHistorySchema = z.object({
  /** The id of the mark that first recorded it. */
  id: z.string(),
  face: FaceSchema,
  rect: FaceRectSchema,
  locationCode: z.string(),
  damageCode: z.string().nullable(),
  status: MarkStatusSchema,
  firstRecorded: z.string(),
  /** The latest earlier handover that photographed the spot and recorded nothing; null if none did. */
  lastClear: z.string().nullable(),
  /** Handovers after `lastClear` that didn't photograph the spot. */
  notInspectedAt: z.array(z.string()),
  trail: z.array(z.object({ handoverId: z.string(), status: MarkStatusSchema })),
});

export const ContainerHistorySchema = z.object({
  container: ContainerSchema,
  handovers: z.array(HandoverSchema),
  chain: ChainStatusSchema,
  /** The container's damage across handovers, from the sealed records only. */
  damage: z.array(DamageHistorySchema),
});

// Claims -------------------------------------------------------------------

export const DraftClaimSchema = z.object({
  language: z.enum(['en', 'pl']).default('en'),
});

export const ClaimItemSchema = z.object({
  markId: z.string(),
  locationCode: z.string(),
  damageCode: z.string(),
  description: z.string(),
  photoSha256: z.string().nullable(),
});

export const ClaimSchema = z.object({
  addressee: z.string(),
  subject: z.string(),
  summary: z.string(),
  items: z.array(ClaimItemSchema),
  letter: z.string(),
});

export const ClaimCheckSchema = z.enum([
  'items-are-new-damage',
  'codes-and-photos-match',
  'letter-cites-records',
]);

export const ClaimResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('no-new-damage'), explanation: z.string() }),
  z.object({
    status: z.literal('drafted'),
    claim: ClaimSchema,
    verification: z.object({
      /** Drafts the agent wrote before one passed every check. */
      attempts: z.number().int(),
      toolCalls: z.array(z.string()),
      /** The checks the draft passed. */
      checks: z.array(ClaimCheckSchema),
    }),
  }),
]);

// Speech -------------------------------------------------------------------

export const TranscriptionSchema = z.object({
  text: z.string(),
  durationMs: z.number().int(),
});

// Access ---------------------------------------------------------------------

export const SessionSchema = z.object({
  /** Whether this installation asks for an access code. */
  required: z.boolean(),
  authenticated: z.boolean(),
});

export const LoginSchema = z.object({ code: z.string().min(1).max(200) });

/** What the operator says about this installation, shown to everyone (no session needed). */
export const InstanceSchema = z.object({
  /** One line for the foot of every screen, e.g. "Demo data" or photo credits. */
  notice: z.string().nullable(),
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
export type TransportMode = z.infer<typeof TransportModeSchema>;
export type StartHandover = z.infer<typeof StartHandoverSchema>;
export type Handover = z.infer<typeof HandoverSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type MarkStatus = z.infer<typeof MarkStatusSchema>;
export type MarkSource = z.infer<typeof MarkSourceSchema>;
export type Mark = z.infer<typeof MarkSchema>;
export type CreateMark = z.infer<typeof CreateMarkSchema>;
export type UpdateMark = z.infer<typeof UpdateMarkSchema>;
export type HandoverDetail = z.infer<typeof HandoverDetailSchema>;
export type HandoverSummary = z.infer<typeof HandoverSummarySchema>;
export type ChainStatus = z.infer<typeof ChainStatusSchema>;
export type ContainerHistory = z.infer<typeof ContainerHistorySchema>;
export type DamageHistory = z.infer<typeof DamageHistorySchema>;
export type Problem = z.infer<typeof ProblemSchema>;
export type Transcription = z.infer<typeof TranscriptionSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ClaimResult = z.infer<typeof ClaimResultSchema>;
export type ClaimCheck = z.infer<typeof ClaimCheckSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type FrameRegistration = z.infer<typeof FrameRegistrationSchema>;
export type VideoTracking = z.infer<typeof VideoTrackingSchema>;
export type SpokenDamageResult = z.infer<typeof SpokenDamageResultSchema>;
export type Instance = z.infer<typeof InstanceSchema>;
export type FaceView = z.infer<typeof FaceViewSchema>;
export type FaceViews = z.infer<typeof FaceViewsSchema>;

/** Request bodies as clients write them, before defaults are applied. */
export type StartHandoverInput = z.input<typeof StartHandoverSchema>;
export type CreateMarkInput = z.input<typeof CreateMarkSchema>;
export type CloseHandoverInput = z.input<typeof CloseHandoverSchema>;
