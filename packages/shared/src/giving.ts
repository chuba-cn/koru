import { z } from 'zod';

/**
 * Info: Each of these must list exactly the values of the matching Prisma enum in
 * apps/api/prisma/schema.prisma, if you change anything there make sure you change it in this file
 */
export const PLEDGE_CADENCES = ['none', 'weekly', 'monthly', 'payday', 'custom'] as const;
export const PLEDGE_STATUSES = ['active', 'fulfilled', 'cancelled'] as const;
export const PLEDGE_SOURCES = ['self', 'admin', 'imported'] as const;
export const PAYMENT_CHANNELS = ['paystack_transfer', 'cash', 'pos', 'imported'] as const;
export const PAYMENT_STATUSES = ['pending', 'success', 'failed', 'reversed'] as const;

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
  status: z.enum(PAYMENT_STATUSES),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type PledgeHistoryItem = z.infer<typeof PledgeHistoryItemSchema>;
export type PaymentHistoryItem = z.infer<typeof PaymentHistoryItemSchema>;
