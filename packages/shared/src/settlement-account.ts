import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

const NubanSchema = z.string().regex(/^\d{10}$/, 'account number must be exactly 10 digits');

export const CreateSettlementAccountSchema = z.object({
  label: z.string().min(2).max(120),
  accountNumber: NubanSchema,
  bankName: z.string().min(2).max(120),
  branchId: z.uuid().optional(),
});

export const UpdateSettlementAccountSchema = z.object({
  label: z.string().min(2).max(120),
});

export const ListSettlementAccountsQuerySchema = PaginationQuerySchema.extend({
  branchId: z.uuid().optional(),
});

export const SettlementAccountSchema = z.object({
  id: z.uuid(),
  churchId: z.uuid(),
  branchId: z.uuid().nullable(),
  label: z.string(),
  bankName: z.string().nullable(),
  accountNumberMasked: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type CreateSettlementAccountInput = z.infer<typeof CreateSettlementAccountSchema>;
export type UpdateSettlementAccountInput = z.infer<typeof UpdateSettlementAccountSchema>;
export type ListSettlementAccountsQuery = z.infer<typeof ListSettlementAccountsQuerySchema>;
export type SettlementAccount = z.infer<typeof SettlementAccountSchema>;
