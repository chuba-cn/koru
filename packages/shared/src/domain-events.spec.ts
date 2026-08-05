import { describe, expect, it } from 'vitest';
import { DomainEventPayloadSchema } from './domain-events.js';

const CHURCH = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const INTENT = '44444444-4444-4444-8444-444444444444';

describe('DomainEventPayloadSchema', () => {
  it('accepts a donation_intent_created payload', () => {
    const result = DomainEventPayloadSchema.safeParse({
      type: 'donation_intent_created',
      donationIntentId: INTENT,
      churchId: CHURCH,
      campaignId: CAMPAIGN,
      memberId: MEMBER,
      amountKobo: 500_000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a payment_settled payload with a null memberId, for anonymous giving', () => {
    const result = DomainEventPayloadSchema.safeParse({
      type: 'payment_settled',
      paymentId: INTENT,
      churchId: CHURCH,
      campaignId: CAMPAIGN,
      memberId: null,
      amountKobo: 500_000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload whose fields belong to a different type than its discriminant', () => {
    const result = DomainEventPayloadSchema.safeParse({
      type: 'donation_intent_created',
      paymentId: INTENT,
      churchId: CHURCH,
      campaignId: CAMPAIGN,
      memberId: MEMBER,
      amountKobo: 500_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized type', () => {
    const result = DomainEventPayloadSchema.safeParse({
      type: 'something_else',
      churchId: CHURCH,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a fractional amountKobo, which can never be valid kobo', () => {
    const result = DomainEventPayloadSchema.safeParse({
      type: 'donation_intent_created',
      donationIntentId: INTENT,
      churchId: CHURCH,
      campaignId: CAMPAIGN,
      memberId: MEMBER,
      amountKobo: 12.5,
    });
    expect(result.success).toBe(false);
  });
});
