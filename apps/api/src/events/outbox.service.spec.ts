import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OutboxService } from './outbox.service';

const CHURCH = '11111111-1111-4111-8111-111111111111';
const OTHER_CHURCH = '99999999-9999-4999-8999-999999999999';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const INTENT = '44444444-4444-4444-8444-444444444444';
const REFUND = '55555555-5555-4555-8555-555555555555';
const PAYMENT = '66666666-6666-4666-8666-666666666666';

describe('OutboxService.record', () => {
  it('writes a DomainEvent row using the given transaction client, not a fresh connection', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'event-1' });
    const tx = { domainEvent: { create } };
    const service = new OutboxService();

    await service.record(tx as never, {
      churchId: CHURCH,
      payload: {
        type: 'donation_intent_created',
        donationIntentId: INTENT,
        churchId: CHURCH,
        campaignId: CAMPAIGN,
        memberId: MEMBER,
        amountKobo: 500_000,
      },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        churchId: CHURCH,
        type: 'donation_intent_created',
        payload: {
          type: 'donation_intent_created',
          donationIntentId: INTENT,
          churchId: CHURCH,
          campaignId: CAMPAIGN,
          memberId: MEMBER,
          amountKobo: 500_000,
        },
      },
    });
  });

  it('derives the type column from payload.type — there is no separate type input to disagree with it', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'event-1' });
    const tx = { domainEvent: { create } };
    const service = new OutboxService();

    await service.record(tx as never, {
      churchId: CHURCH,
      payload: {
        type: 'refund_processed',
        refundRequestId: REFUND,
        churchId: CHURCH,
        paymentId: PAYMENT,
        amountKobo: 100_000,
      },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'refund_processed' }) }),
    );
  });

  it('rejects a payload that fails schema validation as a BadRequestException, not a raw ZodError', async () => {
    const create = vi.fn();
    const tx = { domainEvent: { create } };
    const service = new OutboxService();

    const attempt = service.record(tx as never, {
      churchId: CHURCH,
      payload: {
        type: 'refund_processed',
        refundRequestId: 'not-a-uuid',
        churchId: CHURCH,
        paymentId: PAYMENT,
        amountKobo: 100_000,
      } as never,
    });

    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow(/Invalid DomainEvent payload/);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a payload whose churchId disagrees with the posting church', async () => {
    const create = vi.fn();
    const tx = { domainEvent: { create } };
    const service = new OutboxService();

    await expect(
      service.record(tx as never, {
        churchId: CHURCH,
        payload: {
          type: 'refund_processed',
          refundRequestId: REFUND,
          churchId: OTHER_CHURCH,
          paymentId: PAYMENT,
          amountKobo: 100_000,
        },
      }),
    ).rejects.toThrow(/churchId must match/);

    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a call where tx is the whole PrismaClient, not a transaction client', async () => {
    const service = new OutboxService();
    const wholeClient = { $connect: async () => {}, domainEvent: { create: vi.fn() } };

    await expect(
      service.record(wholeClient as never, {
        churchId: CHURCH,
        payload: {
          type: 'refund_processed',
          refundRequestId: REFUND,
          churchId: CHURCH,
          paymentId: PAYMENT,
          amountKobo: 100_000,
        },
      }),
    ).rejects.toThrow(/must run inside a transaction/);
  });
});
