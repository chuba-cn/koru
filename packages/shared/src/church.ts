import { z } from 'zod';

export const CreateChurchSchema = z.object({
  name: z.string().min(2, 'name must be at least 2 characters').max(120),
  timezone: z.string().min(1).optional(),
});

export const UpdateChurchSchema = CreateChurchSchema.partial();

export type CreateChurchInput = z.infer<typeof CreateChurchSchema>;
export type UpdateChurchInput = z.infer<typeof UpdateChurchSchema>;
