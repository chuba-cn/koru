import { describe, expect, it } from 'vitest';
import { PaymentHistoryItemSchema, PledgeHistoryItemSchema } from './giving.js';

const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';

const validPledge = {
  id: ROW,
  campaignId: CAMPAIGN,
  campaign: { id: CAMPAIGN, title: 'Building Fund' },
  pledgeAmountKobo: 5_000_000,
  cadence: 'monthly',
  status: 'active',
  source: 'self',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const validPayment = {
  id: ROW,
  campaignId: CAMPAIGN,
  campaign: { id: CAMPAIGN, title: 'Building Fund' },
  pledgeId: null,
  amountKobo: 2_000_000,
  channel: 'paystack_transfer',
  state: 'settled',
  paidAt: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('PledgeHistoryItemSchema', () => {
  it('accepts a full pledge history row', () => {
    expect(PledgeHistoryItemSchema.safeParse(validPledge).success).toBe(true);
  });

  it('rejects a cadence outside the enum', () => {
    expect(PledgeHistoryItemSchema.safeParse({ ...validPledge, cadence: 'yearly' }).success).toBe(
      false,
    );
  });

  it('rejects a fractional amount, which can never be valid kobo', () => {
    expect(
      PledgeHistoryItemSchema.safeParse({ ...validPledge, pledgeAmountKobo: 12.5 }).success,
    ).toBe(false);
  });
});

describe('PaymentHistoryItemSchema', () => {
  it('accepts a payment with no pledge, since a spontaneous gift has no pledge', () => {
    expect(PaymentHistoryItemSchema.safeParse(validPayment).success).toBe(true);
  });

  it('accepts a payment tied to a pledge', () => {
    const result = PaymentHistoryItemSchema.safeParse({ ...validPayment, pledgeId: CAMPAIGN });
    expect(result.success).toBe(true);
  });

  it('rejects a null paidAt — a Payment row only ever exists once settled', () => {
    expect(PaymentHistoryItemSchema.safeParse({ ...validPayment, paidAt: null }).success).toBe(
      false,
    );
  });

  it('rejects a state outside the enum', () => {
    expect(PaymentHistoryItemSchema.safeParse({ ...validPayment, state: 'pending' }).success).toBe(
      false,
    );
  });
});
