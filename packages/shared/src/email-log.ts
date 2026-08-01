import { z } from 'zod';
import { paginatedResponseSchema } from './pagination.js';

export const EmailLogItemSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  recipientEmail: z.email(),
  recipientStaffId: z.uuid().nullable(),
  recipientMemberId: z.uuid().nullable(),
  subject: z.string(),
  status: z.string(),
  failureReason: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const EmailLogPageSchema = paginatedResponseSchema(EmailLogItemSchema);

export type EmailLogItem = z.infer<typeof EmailLogItemSchema>;
