import { z } from 'zod';

/** Kept because UpdateChurchSchema derives from it; churches are created via onboarding. */
export const CreateChurchSchema = z.object({
  name: z.string().min(2, 'name must be at least 2 characters').max(120),
  timezone: z.string().min(1).optional(),
});

export const UpdateChurchSchema = CreateChurchSchema.partial();

export type UpdateChurchInput = z.infer<typeof UpdateChurchSchema>;

export const ChurchSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  paystackBusinessRef: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type Church = z.infer<typeof ChurchSchema>;
