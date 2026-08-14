import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';
import { ScopeLevelSchema, ScopeRefSchema, ScopeRefShape } from './scope.js';

/**
 * Info: This must list exactly the values of the Prisma enum CampaignStatus in
 * apps/api/prisma/schema.prisma, if you change the enum make sure it is changed here as well.
 */
export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'] as const;

export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUSES);

export const CreateCampaignSchema = ScopeRefSchema.extend({
  title: z.string().min(2).max(160),
  description: z.string().max(2000).nullable().optional(),
  settlementAccountId: z.uuid(),
  targetAmountKobo: z.number().int().positive(),
  startDate: z.iso.datetime().nullable().optional(),
  endDate: z.iso.datetime().nullable().optional(),
  status: CampaignStatusSchema.optional(),
}).refine(
  (input) =>
    !input.startDate || !input.endDate || Date.parse(input.endDate) >= Date.parse(input.startDate),
  { message: 'endDate must not be before startDate' },
);

export const UpdateCampaignSchema = z
  .object({
    title: z.string().min(2).max(160).optional(),
    description: z.string().max(2000).nullable().optional(),
    settlementAccountId: z.uuid().optional(),
    targetAmountKobo: z.number().int().positive().optional(),
    startDate: z.iso.datetime().nullable().optional(),
    endDate: z.iso.datetime().nullable().optional(),
    status: CampaignStatusSchema.optional(),
    scopeType: ScopeLevelSchema.optional(),
    scopeRefId: z.uuid().nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Send at least one field to update',
  })
  .refine((input) => (input.scopeType === undefined) === (input.scopeRefId === undefined), {
    message:
      'Send scopeType and scopeRefId together, scopeRefId must be null for a church scope, and a uuid for a region or branch',
  })
  .refine(
    (input) =>
      input.scopeType === undefined ||
      (input.scopeType === 'church') === (input.scopeRefId == null),
    {
      message: 'scopeRefId must be null for a church scope, and a uuid for a region or branch',
    },
  );

export const ListCampaignsQuerySchema = PaginationQuerySchema.extend({
  status: CampaignStatusSchema.optional(),
  scopeType: ScopeLevelSchema.optional(),
  scopeRefId: z.uuid().optional(),
  settlementAccountId: z.uuid().optional(),
});

export const CampaignSchema = ScopeRefShape.extend({
  id: z.uuid(),
  churchId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  scopeRefId: z.uuid().nullable(),
  settlementAccountId: z.uuid(),
  targetAmountKobo: z.number().int().nonnegative(),
  currency: z.string(),
  startDate: z.iso.datetime().nullable(),
  endDate: z.iso.datetime().nullable(),
  status: CampaignStatusSchema,
  createdById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;
export type ListCampaignsQuery = z.infer<typeof ListCampaignsQuerySchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
