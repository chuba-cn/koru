import { z } from 'zod';

export const BootstrapChurchSchema = z.object({
  churchName: z.string().min(2).max(120),
  timezone: z.string().min(1).optional(),
  fullName: z.string().min(2).max(120),
});

export type BootstrapChurchInput = z.infer<typeof BootstrapChurchSchema>;
