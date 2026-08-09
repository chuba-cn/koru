import { z } from 'zod';

/**
 * Info: Each of these must list exactly the values of the matching Prisma enum in
 * apps/api/prisma/schema.prisma, if you change anything there make sure you change it in this file
 */
export const PLEDGE_CADENCES = ['none', 'weekly', 'monthly', 'payday', 'custom'] as const;
export const PLEDGE_STATUSES = ['active', 'fulfilled', 'cancelled'] as const;
export const PLEDGE_SOURCES = ['self', 'admin', 'imported'] as const;
export const PAYMENT_CHANNELS = ['paystack_transfer', 'cash', 'pos', 'imported'] as const;
export const PAYMENT_STATES = ['settled', 'refunded', 'reversed'] as const;
export const DONATION_INTENT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'expired',
  'cancelled',
] as const;

/** Paystack's own bank_transfer minimum limits */
export const MIN_DONATION_KOBO = 10_000;
export const MAX_DONATION_KOBO = 1_000_000_000;

const CampaignRefSchema = z.object({
  id: z.uuid(),
  title: z.string(),
});

export const PledgeHistoryItemSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  campaign: CampaignRefSchema,
  pledgeAmountKobo: z.number().int().nonnegative(),
  cadence: z.enum(PLEDGE_CADENCES),
  status: z.enum(PLEDGE_STATUSES),
  source: z.enum(PLEDGE_SOURCES),
  createdAt: z.iso.datetime(),
});

export const PaymentHistoryItemSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  campaign: CampaignRefSchema,
  pledgeId: z.uuid().nullable(),
  amountKobo: z.number().int().nonnegative(),
  channel: z.enum(PAYMENT_CHANNELS),
  state: z.enum(PAYMENT_STATES),
  paidAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const CreateDonationSchema = z.object({
  campaignId: z.uuid(),
  pledgeId: z.uuid().optional(),
  amountKobo: z.number().int().min(MIN_DONATION_KOBO).max(MAX_DONATION_KOBO),
  idempotencyKey: z.uuid(),
});

export const DonationPaymentInstructionSchema = z.object({
  reference: z.string().min(1),
  accountNumber: z.string().regex(/^\d{10}$/),
  bankName: z.string().min(1),
  accountName: z.string().nullable(),
  amountKobo: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime(),
});

export const DonationSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  pledgeId: z.uuid().nullable(),
  amountKobo: z.number().int().nonnegative(),
  status: z.enum(DONATION_INTENT_STATUSES),
  createdAt: z.iso.datetime(),
  transferInstruction: DonationPaymentInstructionSchema.nullable(),
});

export type PledgeHistoryItem = z.infer<typeof PledgeHistoryItemSchema>;
export type PaymentHistoryItem = z.infer<typeof PaymentHistoryItemSchema>;
export type CreateDonationInput = z.infer<typeof CreateDonationSchema>;
export type DonationPaymentInstruction = z.infer<typeof DonationPaymentInstructionSchema>;
export type Donation = z.infer<typeof DonationSchema>;
