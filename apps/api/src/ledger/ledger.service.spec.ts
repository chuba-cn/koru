import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { LedgerService } from './ledger.service';

const CHURCH = '11111111-1111-4111-8111-111111111111';
const OTHER_CHURCH = '99999999-9999-4999-8999-999999999999';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const PAYMENT = '66666666-6666-4666-8666-666666666666';

const EVENT_PAYLOAD = {
  type: 'payment_settled' as const,
  paymentId: PAYMENT,
  churchId: CHURCH,
  campaignId: CAMPAIGN,
  memberId: MEMBER,
  amountKobo: 500_000,
};

function fakeTx(opts?: { createManyImpl?: () => Promise<unknown>; campaignBelongs?: boolean }) {
  return {
    campaign: {
      findMany: vi
        .fn()
        .mockResolvedValue(opts?.campaignBelongs === false ? [] : [{ id: CAMPAIGN }]),
    },
    branch: { findMany: vi.fn().mockResolvedValue([]) },
    ledgerTransaction: { create: vi.fn().mockResolvedValue({ id: 'txn-1' }) },
    ledgerEntry: { createMany: vi.fn(opts?.createManyImpl ?? (() => Promise.resolve())) },
  };
}

function fakeOutbox() {
  return { record: vi.fn().mockResolvedValue({ id: 'event-1' }) };
}

function balancedEntries() {
  return [
    {
      account: 'gateway_clearing' as const,
      entryType: 'debit' as const,
      amountKobo: 500_000n,
      dedupeKey: 'payment-1:clearing',
    },
    {
      account: 'campaign_giving' as const,
      entryType: 'credit' as const,
      amountKobo: 500_000n,
      campaignId: CAMPAIGN,
      dedupeKey: 'payment-1:giving',
    },
  ];
}

describe('LedgerService.post', () => {
  it('accepts a balanced posting and records one DomainEvent via the same tx', async () => {
    const tx = fakeTx();
    const outbox = fakeOutbox();
    const service = new LedgerService(outbox as never);

    const result = await service.post(tx as never, {
      churchId: CHURCH,
      reason: 'donation settled',
      entries: balancedEntries(),
      eventPayload: EVENT_PAYLOAD,
    });

    expect(tx.ledgerEntry.createMany).toHaveBeenCalled();
    expect(outbox.record).toHaveBeenCalledWith(tx, {
      churchId: CHURCH,
      payload: EVENT_PAYLOAD,
    });
    expect(result.transaction.id).toBe('txn-1');
    expect(result.event.id).toBe('event-1');
  });

  it('rejects a posting whose debits and credits do not sum to zero', async () => {
    const tx = fakeTx();
    const outbox = fakeOutbox();
    const service = new LedgerService(outbox as never);

    await expect(
      service.post(tx as never, {
        churchId: CHURCH,
        reason: 'unbalanced',
        entries: [
          {
            account: 'gateway_clearing',
            entryType: 'debit',
            amountKobo: 500_000n,
            dedupeKey: 'bad:clearing',
          },
          {
            account: 'campaign_giving',
            entryType: 'credit',
            amountKobo: 400_000n,
            dedupeKey: 'bad:giving',
          },
        ],
        eventPayload: EVENT_PAYLOAD,
      }),
    ).rejects.toThrow(/does not balance/);

    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('rejects a posting with fewer than two entries', async () => {
    const tx = fakeTx();
    const outbox = fakeOutbox();
    const service = new LedgerService(outbox as never);

    await expect(
      service.post(tx as never, {
        churchId: CHURCH,
        reason: 'one-sided',
        entries: [balancedEntries()[0]],
        eventPayload: EVENT_PAYLOAD,
      }),
    ).rejects.toThrow(/at least one debit and one credit/);

    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('rejects a posting with no entries at all, even though it trivially balances to zero', async () => {
    const tx = fakeTx();
    const outbox = fakeOutbox();
    const service = new LedgerService(outbox as never);

    await expect(
      service.post(tx as never, {
        churchId: CHURCH,
        reason: 'empty posting',
        entries: [],
        eventPayload: EVENT_PAYLOAD,
      }),
    ).rejects.toThrow(/at least one debit and one credit/);

    expect(tx.ledgerTransaction.create).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('rejects negative-amount entries that would otherwise balance to zero — the sign flip the balance check alone cannot catch', async () => {
    const tx = fakeTx();
    const outbox = fakeOutbox();
    const service = new LedgerService(outbox as never);

    await expect(
      service.post(tx as never, {
        churchId: CHURCH,
        reason: 'inverted amounts',
        entries: [
          {
            account: 'gateway_clearing',
            entryType: 'debit',
            amountKobo: -500_000n,
            dedupeKey: 'neg:clearing',
          },
          {
            account: 'campaign_giving',
            entryType: 'credit',
            amountKobo: -500_000n,
            dedupeKey: 'neg:giving',
          },
        ],
        eventPayload: EVENT_PAYLOAD,
      }),
    ).rejects.toThrow(/positive integer Kobo/);

    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('rejects a duplicate dedupeKey as a Conflict, not a raw Prisma error', async () => {
    const duplicateError = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
    Object.assign(duplicateError, {
      message: 'Unique constraint failed',
      code: 'P2002',
      clientVersion: 'test',
    });

    const tx = fakeTx({ createManyImpl: () => Promise.reject(duplicateError) });
    const outbox = fakeOutbox();
    const service = new LedgerService(outbox as never);

    await expect(
      service.post(tx as never, {
        churchId: CHURCH,
        reason: 'duplicate',
        entries: balancedEntries(),
        eventPayload: EVENT_PAYLOAD,
      }),
    ).rejects.toThrow(/already recorded/);

    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('rejects a campaignId that does not belong to the posting church', async () => {
    const tx = fakeTx({ campaignBelongs: false });
    const outbox = fakeOutbox();
    const service = new LedgerService(outbox as never);

    await expect(
      service.post(tx as never, {
        churchId: OTHER_CHURCH,
        reason: 'cross-tenant campaign',
        entries: balancedEntries(),
        eventPayload: { ...EVENT_PAYLOAD, churchId: OTHER_CHURCH },
      }),
    ).rejects.toThrow(/do not belong to this church/);

    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('rejects a call where tx is the whole PrismaClient, not a transaction client', async () => {
    const outbox = fakeOutbox();
    const service = new LedgerService(outbox as never);
    const wholeClient = { $connect: async () => {}, ...fakeTx() };

    await expect(
      service.post(wholeClient as never, {
        churchId: CHURCH,
        reason: 'should never run',
        entries: balancedEntries(),
        eventPayload: EVENT_PAYLOAD,
      }),
    ).rejects.toThrow(/must run inside a transaction/);
  });
});
