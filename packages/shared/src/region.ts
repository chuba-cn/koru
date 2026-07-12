import { z } from 'zod';

export const CreateRegionSchema = z.object({
  name: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
});

export const UpdateRegionSchema = CreateRegionSchema.partial();

export type CreateRegionInput = z.infer<typeof CreateRegionSchema>;
export type UpdateRegionInput = z.infer<typeof UpdateRegionSchema>;

export const RegionSchema = z.object({
  id: z.uuid(),
  churchId: z.uuid(),
  name: z.string(),
  state: z.string(),
  createdAt: z.iso.datetime(),
});

export type Region = z.infer<typeof RegionSchema>;
