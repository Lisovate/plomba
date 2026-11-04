import { FaceRectSchema, FaceSchema, MarkStatusSchema, VideoSchema } from '@plomba/contracts';
import { z } from 'zod';

/** The parts of a sealed record (versions 1, 2 and 3) that the damage history reads. */
export const SealedRecordSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  /** Version 3: video bytes are covered by the same chain as the photos. */
  videos: z
    .array(VideoSchema.pick({ id: true, sha256: true, size: true, contentType: true }))
    .optional(),
  /** Version 2: CEDEX cells with no photo, by face. */
  notInspected: z.partialRecord(FaceSchema, z.array(z.string())).optional(),
  handover: z.object({ id: z.string() }),
  marks: z.array(
    z.object({
      id: z.string(),
      face: FaceSchema,
      rect: FaceRectSchema,
      locationCode: z.string(),
      damageCode: z.string().nullable(),
      status: MarkStatusSchema,
      previousMarkId: z.string().nullable(),
    }),
  ),
});
