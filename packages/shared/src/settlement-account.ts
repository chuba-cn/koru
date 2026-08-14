import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';
import { ScopeLevelSchema, ScopeRefSchema, ScopeRefShape } from './scope.js';

const NubanSchema = z.string().regex(/^\d{10}$/, 'account number must be exactly 10 digits');

export const CreateSettlementAccountSchema = ScopeRefSchema.extend({
  label: z.string().min(2).max(120),
  accountNumber: NubanSchema,
  bankCode: z.string().min(1).max(20),
});

export const UpdateSettlementAccountSchema = z
  .object({
    label: z.string().min(2).max(120).optional(),
    scopeType: ScopeLevelSchema.optional(),
    scopeRefId: z.uuid().nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Send at least one field to update',
  })
  .refine((input) => (input.scopeType === undefined) === (input.scopeRefId === undefined), {
    message:
      'Send scopeType and scopeRefId together. scopeRefId must be null for a church scope, and a uuid for a region or branch',
  })
  .refine(
    (input) =>
      input.scopeType === undefined ||
      (input.scopeType === 'church') === (input.scopeRefId == null),
    { message: 'scopeRefId must be null for a church scope, and a uuid for a region or branch' },
  );

export const ListSettlementAccountsQuerySchema = PaginationQuerySchema.extend({
  scopeType: ScopeLevelSchema.optional(),
  scopeRefId: z.uuid().optional(),
});

export const SettlementAccountSchema = ScopeRefShape.extend({
  id: z.uuid(),
  churchId: z.uuid(),
  scopeRefId: z.uuid().nullable(),
  label: z.string(),
  bankName: z.string().nullable(),
  bankCode: z.string().nullable(),
  accountNumberMasked: z.string().nullable(),
  accountName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type CreateSettlementAccountInput = z.infer<typeof CreateSettlementAccountSchema>;
export type UpdateSettlementAccountInput = z.infer<typeof UpdateSettlementAccountSchema>;
export type ListSettlementAccountsQuery = z.infer<typeof ListSettlementAccountsQuerySchema>;
export type SettlementAccount = z.infer<typeof SettlementAccountSchema>;
