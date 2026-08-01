import { z } from 'zod';

export const ResendWebhookEventSchema = z.object({
  type: z.string(),
  data: z.looseObject({
    email_id: z.string().optional(),
  }),
});

export type ResendWebhookEvent = z.infer<typeof ResendWebhookEventSchema>;
