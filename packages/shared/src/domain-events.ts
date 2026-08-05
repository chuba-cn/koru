import { z } from 'zod';

const DonationIntentCreatedPayloadSchema = z.object({
  type: z.literal('donation_intent_created'),
  donationIntentId: z.uuid(),
  churchId: z.uuid(),
  campaignId: z.uuid(),
  memberId: z.uuid(),
  amountKobo: z.number().int().nonnegative(),
});

const PaymentAttemptSucceededPayloadSchema = z.object({
  type: z.literal('payment_attempt_succeeded'),
  paymentAttemptId: z.uuid(),
  churchId: z.uuid(),
  donationIntentId: z.uuid(),
  amountKobo: z.number().int().nonnegative(),
});

const PaymentSettledPayloadSchema = z.object({
  type: z.literal('payment_settled'),
  paymentId: z.uuid(),
  churchId: z.uuid(),
  campaignId: z.uuid(),
  memberId: z.uuid().nullable(),
  amountKobo: z.number().int().nonnegative(),
});

const RefundRequestedPayloadSchema = z.object({
  type: z.literal('refund_requested'),
  refundRequestId: z.uuid(),
  churchId: z.uuid(),
  paymentId: z.uuid(),
  amountKobo: z.number().int().nonnegative(),
});

const RefundProcessedPayloadSchema = z.object({
  type: z.literal('refund_processed'),
  refundRequestId: z.uuid(),
  churchId: z.uuid(),
  paymentId: z.uuid(),
  amountKobo: z.number().int().nonnegative(),
});

export const DomainEventPayloadSchema = z.discriminatedUnion('type', [
  DonationIntentCreatedPayloadSchema,
  PaymentAttemptSucceededPayloadSchema,
  PaymentSettledPayloadSchema,
  RefundProcessedPayloadSchema,
  RefundRequestedPayloadSchema,
]);

export type DomainEventPayload = z.infer<typeof DomainEventPayloadSchema>;
