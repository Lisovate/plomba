import { FaceRectSchema, FaceSchema, MarkStatusSchema } from '@plomba/contracts';
import { z } from 'zod';

/** The parts of a sealed record (versions 1 and 2) that the damage history reads. */
export const SealedRecordSchema = z.object({
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
