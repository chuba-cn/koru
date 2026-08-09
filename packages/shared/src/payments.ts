import { z } from 'zod';

/**
 * Info: Each of these must list exactly the values of the matching Prisma enum in
 * apps/api/prisma/schema.prisma, if you change anything there make sure you change it in this file
 */
export const PAYMENT_PROVIDERS = ['paystack'] as const;

/** Info: Paystack transaction IDs are uint64, that is string everywhere
 * and never a JS number
 */
const ProviderChargeIdSchema = z.string().min(1);

export const ChargeStatusSchema = z.enum(['pending', 'success', 'failed', 'abandoned', 'reversed']);

export const ChargeFactsSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  providerChargeId: ProviderChargeIdSchema,
  reference: z.string().min(1),
  status: ChargeStatusSchema,
  amountKobo: z.number().int().nonnegative(),
  feesKobo: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3),
  channel: z.string(),
  paidAt: z.iso.datetime().nullable(),
  subaccountCode: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const TransferChargeResultSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  reference: z.string().min(1),
  providerChargeId: ProviderChargeIdSchema.nullable(),
  accountNumber: z.string().regex(/^\d{10}$/),
  accountName: z.string().nullable(),
  bankName: z.string().min(1),
  bankSlug: z.string().nullable(),
  accountExpiresAt: z.iso.datetime(),
  amountKobo: z.number().int().nonnegative(),
});

const WebhookSignalBase = {
  provider: z.enum(PAYMENT_PROVIDERS),
  eventType: z.string().min(1),
  providerEventKey: z.string().min(1),
};

export const WebhookSignalSchema = z.discriminatedUnion('kind', [
  z.object({
    ...WebhookSignalBase,
    kind: z.literal('charge_succeeded'),
    reference: z.string().min(1),
    providerChargeId: ProviderChargeIdSchema,
  }),
  z.object({
    ...WebhookSignalBase,
    kind: z.literal('transfer_rejected'),
    reference: z.string().min(1),
    reason: z.string().nullable(),
  }),
  z.object({ ...WebhookSignalBase, kind: z.literal('ignored') }),
]);

export const RefundFactsSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  providerRefundId: z.string().min(1),
  reference: z.string().min(1),
  status: z.enum(['pending', 'processing', 'processed', 'failed', 'needs-attention']),
  amountKobo: z.number().int().nonnegative(),
  processedAt: z.iso.datetime().nullable(),
});

export const BankSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  code: z.string().min(1),
  currency: z.string().length(3),
  active: z.boolean(),
});

export const ResolvedAccountSchema = z.object({
  accountNumber: z.string().regex(/^\d{10}$/),
  accountName: z.string().min(1),
});

export const SubaccountFactsSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  subaccountCode: z.string().min(1),
  accountNumberMasked: z.string().min(1),
  bankCode: z.string().min(1),
  isVerified: z.boolean().nullable(),
});

export type ChargeFacts = z.infer<typeof ChargeFactsSchema>;
export type TransferChargeResult = z.infer<typeof TransferChargeResultSchema>;
export type WebhookSignal = z.infer<typeof WebhookSignalSchema>;
export type RefundFacts = z.infer<typeof RefundFactsSchema>;
export type Bank = z.infer<typeof BankSchema>;
export type ResolvedAccount = z.infer<typeof ResolvedAccountSchema>;
export type SubaccountFacts = z.infer<typeof SubaccountFactsSchema>;
