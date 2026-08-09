import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PaymentSettlementService } from './payment-settlement.service';

const CHURCH = 'church-1';
const OTHER_CHURCH = 'church-2';
const CAMPAIGN = 'campaign-1';
const MEMBER = 'member-1';

const ATTEMPT = {
  id: 'attempt-1',
  churchId: CHURCH,
  branchId: 'branch-1',
  amountKobo: 150000n,
  providerReference: 'attempt-1',
  virtualAccountNumber: '1231986612',
  virtualAccountBank: 'Test Bank',
  settlementAccountId: 'sa-1',
  settlementAccount: { id: 'sa-1', providerSubaccountCode: 'ACCT_xyz' },
  donationIntent: {
    id: 'intent-1',
    churchId: CHURCH,
    campaignId: CAMPAIGN,
    memberId: MEMBER,
    pledgeId: null,
    campaign: {
      id: CAMPAIGN,
      churchId: CHURCH,
      settlementAccount: { providerSubaccountCode: 'ACCT_xyz' },
    },
  },
};

const FACTS = {
  provider: 'paystack' as const,
  providerChargeId: '12345',
  reference: 'attempt-1',
  status: 'success' as const,
  amountKobo: 150000,
  feesKobo: 375,
  currency: 'NGN',
  channel: 'bank_transfer',
  paidAt: '2026-08-05T17:00:00.000Z',
  subaccountCode: 'ACCT_xyz',
  metadata: null,
};

function fakePrisma(overrides: { attemptStatus?: string } = {}) {
  return {
    paymentAttempt: {
      findUnique: vi.fn().mockResolvedValue(ATTEMPT),
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    payment: { create: vi.fn() },
    donationIntent: { update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRaw: vi
          .fn()
          .mockResolvedValue([{ id: ATTEMPT.id, status: overrides.attemptStatus ?? 'pending' }]),
        payment: { create: vi.fn() },
        paymentAttempt: { update: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
        donationIntent: { update: vi.fn() },
      }),
    ),
  };
}

function fakeLedger() {
  return {
    post: vi.fn().mockResolvedValue({ transaction: { id: 'txn-1' }, event: { id: 'event-1' } }),
  };
}

describe('PaymentSettlementService.postCharge', () => {
  it('404s when no PaymentAttempt matches the reference', async () => {
    const prisma = fakePrisma();
    prisma.paymentAttempt.findUnique.mockResolvedValueOnce(null);
    const service = new PaymentSettlementService(prisma as never, fakeLedger() as never);

    await expect(service.postCharge(FACTS)).rejects.toThrow(NotFoundException);
  });

  it('throws and posts nothing when the fetched status is not success — the job must retry, never silently succeed', async () => {
    const prisma = fakePrisma();
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await expect(service.postCharge({ ...FACTS, status: 'pending' })).rejects.toThrow(
      ConflictException,
    );
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('rejects and posts nothing when the fetched amount disagrees with the attempt', async () => {
    const prisma = fakePrisma();
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await expect(service.postCharge({ ...FACTS, amountKobo: 999999 })).rejects.toThrow(
      ConflictException,
    );
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('rejects and posts nothing when the charge settled into a subaccount this attempt never asked for', async () => {
    const prisma = fakePrisma();
    prisma.paymentAttempt.findUnique.mockResolvedValueOnce({
      ...ATTEMPT,
      settlementAccount: { id: 'sa-1', providerSubaccountCode: 'ACCT_someone_else' },
    });
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await expect(service.postCharge(FACTS)).rejects.toThrow(ConflictException);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('still settles when the campaign was repointed after the charge was minted', async () => {
    const prisma = fakePrisma();
    prisma.paymentAttempt.findUnique.mockResolvedValueOnce({
      ...ATTEMPT,
      donationIntent: {
        ...ATTEMPT.donationIntent,
        campaign: {
          ...ATTEMPT.donationIntent.campaign,
          settlementAccount: { providerSubaccountCode: 'ACCT_new' },
        },
      },
    });
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await service.postCharge(FACTS);

    expect(ledger.post).toHaveBeenCalledTimes(1);
  });

  it('rejects when the attempt has no settlement account recorded at all', async () => {
    const prisma = fakePrisma();
    prisma.paymentAttempt.findUnique.mockResolvedValueOnce({
      ...ATTEMPT,
      settlementAccountId: null,
      settlementAccount: null,
    });
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await expect(service.postCharge(FACTS)).rejects.toThrow(ConflictException);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('rejects and posts nothing when the fetched charge has NO subaccountCode at all — the split-silently-failed case, not a pass', async () => {
    const prisma = fakePrisma();
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await expect(service.postCharge({ ...FACTS, subaccountCode: null })).rejects.toThrow(
      ConflictException,
    );
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('rejects a non-NGN currency', async () => {
    const prisma = fakePrisma();
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await expect(service.postCharge({ ...FACTS, currency: 'USD' })).rejects.toThrow(
      ConflictException,
    );
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('posts two balanced entries carrying provider: paystack, and the dedupe keys are exact', async () => {
    const prisma = fakePrisma();
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await service.postCharge(FACTS);

    const call = ledger.post.mock.calls[0]?.[1];
    expect(call.entries).toEqual([
      expect.objectContaining({
        account: 'gateway_clearing',
        entryType: 'debit',
        provider: 'paystack',
        dedupeKey: 'paystack:charge:12345:gateway_clearing',
      }),
      expect.objectContaining({
        account: 'campaign_giving',
        entryType: 'credit',
        provider: 'paystack',
        dedupeKey: 'paystack:charge:12345:campaign_giving',
      }),
    ]);
    expect(call.eventPayload).toMatchObject({ type: 'payment_settled', memberId: MEMBER });
  });

  it('is a no-op when the attempt is already succeeded — an idempotent re-delivery', async () => {
    const prisma = fakePrisma({ attemptStatus: 'succeeded' });
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await service.postCharge(FACTS);

    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('still settles an attempt whose virtual account had already expired — the late-transfer case', async () => {
    const prisma = fakePrisma({ attemptStatus: 'expired' });
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await service.postCharge(FACTS);

    expect(ledger.post).toHaveBeenCalled();
  });

  it('throws rather than settling an attempt already marked failed', async () => {
    const prisma = fakePrisma({ attemptStatus: 'failed' });
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await expect(service.postCharge(FACTS)).rejects.toThrow(ConflictException);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('throws on a tenant mismatch between the attempt and its intent/campaign, before posting anything', async () => {
    const prisma = fakePrisma();
    prisma.paymentAttempt.findUnique.mockResolvedValueOnce({
      ...ATTEMPT,
      churchId: OTHER_CHURCH,
    });
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await expect(service.postCharge(FACTS)).rejects.toThrow(ConflictException);
    expect(ledger.post).not.toHaveBeenCalled();
  });
});

describe('PaymentSettlementService.recordTransferRejection', () => {
  it('404s when no PaymentAttempt matches the reference', async () => {
    const prisma = fakePrisma();
    prisma.paymentAttempt.findUnique.mockResolvedValueOnce(null);
    const service = new PaymentSettlementService(prisma as never, fakeLedger() as never);

    await expect(service.recordTransferRejection('missing-ref', 'wrong amount')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('posts no ledger entry — a rejection means no money ever reached the gateway', async () => {
    const prisma = fakePrisma();
    const ledger = fakeLedger();
    const service = new PaymentSettlementService(prisma as never, ledger as never);

    await service.recordTransferRejection('attempt-1', 'wrong amount');

    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('does nothing but log when the rejection arrives for an already-settled attempt', async () => {
    const prisma = fakePrisma({ attemptStatus: 'succeeded' });
    const service = new PaymentSettlementService(prisma as never, fakeLedger() as never);

    await expect(
      service.recordTransferRejection('attempt-1', 'wrong amount'),
    ).resolves.not.toThrow();
  });
});
