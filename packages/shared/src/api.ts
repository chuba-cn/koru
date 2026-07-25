import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  statusCode: z.number().int().min(400).max(599),
  error: z.string(),
  message: z.string(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
