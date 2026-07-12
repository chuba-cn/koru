import { z } from 'zod';

export const CreateRegionSchema = z.object({
  name: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
});

export const UpdateRegionSchema = CreateRegionSchema.partial();

export type CreateRegionInput = z.infer<typeof CreateRegionSchema>;
export type UpdateRegionInput = z.infer<typeof UpdateRegionSchema>;
