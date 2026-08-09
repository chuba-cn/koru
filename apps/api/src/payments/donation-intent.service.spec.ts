import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { DonationIntentService } from './donation-intent.service';

const CHURCH = 'church-1';
const CAMPAIGN = 'campaign-1';
const MEMBER = 'member-1';

const ACTIVE_CAMPAIGN = {
  id: CAMPAIGN,
  churchId: CHURCH,
  status: 'active',
  currency: 'NGN',
  settlementAccount: { providerSubaccountCode: 'ACCT_xyz' },
};

const MEMBER_ROW = { id: MEMBER, email: null, homeBranchId: 'branch-1' };

const CHARGE_RESULT = {
  provider: 'paystack' as const,
  reference: 'attempt-1',
  providerChargeId: null,
  accountNumber: '1231986612',
  accountName: null,
  bankName: 'Test Bank',
  bankSlug: null,
  accountExpiresAt: '2026-08-05T17:30:00.000Z',
  amountKobo: 150000,
};

function fakePrisma() {
  const attempt = { id: 'attempt-generated', amountKobo: 150000n };
  const intent = { id: 'intent-1', campaignId: CAMPAIGN, memberId: MEMBER, pledgeId: null };

  return {
    donationIntent: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ ...intent, status: 'processing' }),
    },
    campaign: { findFirst: vi.fn().mockResolvedValue(ACTIVE_CAMPAIGN) },
    member: { findFirst: vi.fn().mockResolvedValue(MEMBER_ROW) },
    pledge: { findFirst: vi.fn().mockResolvedValue({ id: 'pledge-1' }) },
    paymentAttempt: {
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({
        ...attempt,
        virtualAccountNumber: CHARGE_RESULT.accountNumber,
        virtualAccountBank: CHARGE_RESULT.bankName,
        expiresAt: new Date(CHARGE_RESULT.accountExpiresAt),
      }),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return arg({
          donationIntent: { create: vi.fn().mockResolvedValue(intent) },
          paymentAttempt: { create: vi.fn().mockResolvedValue(attempt) },
        });
      }
      // The array form used by the two post-charge updates.
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
}

function fakeOutbox() {
  return { record: vi.fn().mockResolvedValue({ id: 'event-1' }) };
}

function fakeGateway() {
  return { createTransferCharge: vi.fn().mockResolvedValue(CHARGE_RESULT) };
}

const INPUT = {
  churchId: CHURCH,
  campaignId: CAMPAIGN,
  memberId: MEMBER,
  amountKobo: 150000,
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
};

describe('DonationIntentService.createIntentWithTransferAttempt', () => {
  it('replays an existing intent for the same member without minting a second charge', async () => {
    const prisma = fakePrisma();
    const existing = {
      id: 'intent-existing',
      memberId: MEMBER,
      status: 'pending',
      campaignId: CAMPAIGN,
      pledgeId: null,
      amountKobo: 150000n,
      attempts: [{ id: 'attempt-existing' }],
    };
    prisma.donationIntent.findFirst.mockResolvedValueOnce(existing);
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    const result = await service.createIntentWithTransferAttempt(INPUT);

    expect(result.replayed).toBe(true);
    expect(result.intent).toBe(existing);
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('scopes the replay lookup to the caller, so another member’s key can never be returned', async () => {
    const prisma = fakePrisma();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      fakeGateway() as never,
    );

    await service.createIntentWithTransferAttempt(INPUT);

    expect(prisma.donationIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { churchId: CHURCH, memberId: MEMBER, idempotencyKey: INPUT.idempotencyKey },
      }),
    );
  });

  it('refuses to replay a key that was used for a different campaign', async () => {
    const prisma = fakePrisma();
    prisma.donationIntent.findFirst.mockResolvedValueOnce({
      id: 'intent-other-campaign',
      memberId: MEMBER,
      status: 'pending',
      campaignId: 'campaign-somewhere-else',
      pledgeId: null,
      amountKobo: 150000n,
      attempts: [{ id: 'attempt-1' }],
    });
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(ConflictException);
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('refuses to replay a key that was used for a different amount', async () => {
    const prisma = fakePrisma();
    prisma.donationIntent.findFirst.mockResolvedValueOnce({
      id: 'intent-other-amount',
      memberId: MEMBER,
      status: 'pending',
      campaignId: CAMPAIGN,
      pledgeId: null,
      amountKobo: 5_000_000n,
      attempts: [{ id: 'attempt-1' }],
    });
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(ConflictException);
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('refuses to replay a failed intent, so a dead key cannot return a null instruction forever', async () => {
    const prisma = fakePrisma();
    prisma.donationIntent.findFirst.mockResolvedValueOnce({
      id: 'intent-dead',
      memberId: MEMBER,
      status: 'failed',
      campaignId: CAMPAIGN,
      pledgeId: null,
      amountKobo: 150000n,
      attempts: [],
    });
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(ConflictException);
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('still replays a succeeded intent, which is what idempotency is for', async () => {
    const prisma = fakePrisma();
    const settled = {
      id: 'intent-settled',
      memberId: MEMBER,
      status: 'succeeded',
      campaignId: CAMPAIGN,
      pledgeId: null,
      amountKobo: 150000n,
      attempts: [{ id: 'attempt-settled' }],
    };
    prisma.donationIntent.findFirst.mockResolvedValueOnce(settled);
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    const result = await service.createIntentWithTransferAttempt(INPUT);

    expect(result.replayed).toBe(true);
    expect(result.intent).toBe(settled);
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('resolves a P2002 race (two concurrent double-taps) as a replay, not an unhandled 500', async () => {
    const prisma = fakePrisma();
    const winningIntent = {
      id: 'intent-winner',
      memberId: MEMBER,
      status: 'pending',
      campaignId: CAMPAIGN,
      pledgeId: null,
      amountKobo: 150000n,
      attempts: [{ id: 'attempt-winner' }],
    };
    // First check (before the transaction) misses — this request lost the
    // race and is about to try creating a row that already exists.
    prisma.donationIntent.findFirst.mockResolvedValueOnce(null);
    // The re-check inside the catch block finds the winner's row.
    prisma.donationIntent.findFirst.mockResolvedValueOnce(winningIntent);

    const duplicateError = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
    Object.assign(duplicateError, {
      message: 'Unique constraint failed',
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.$transaction.mockImplementationOnce(() => Promise.reject(duplicateError));

    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    const result = await service.createIntentWithTransferAttempt(INPUT);

    expect(result.replayed).toBe(true);
    expect(result.intent).toBe(winningIntent);
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('rejects a new donation once the member already has too many attempts in flight', async () => {
    const prisma = fakePrisma();
    prisma.paymentAttempt.count.mockResolvedValueOnce(5);
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(ConflictException);
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('rejects giving to an inactive campaign, without ever calling Paystack', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findFirst.mockResolvedValueOnce({ ...ACTIVE_CAMPAIGN, status: 'paused' });
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(
      BadRequestException,
    );
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('rejects a non-NGN campaign', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findFirst.mockResolvedValueOnce({ ...ACTIVE_CAMPAIGN, currency: 'USD' });
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      fakeGateway() as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when the settlement account has no Paystack subaccount code, without calling Paystack', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findFirst.mockResolvedValueOnce({
      ...ACTIVE_CAMPAIGN,
      settlementAccount: { providerSubaccountCode: null },
    });
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(
      BadRequestException,
    );
    expect(gateway.createTransferCharge).not.toHaveBeenCalled();
  });

  it('404s for a campaignId that does not belong to this church', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findFirst.mockResolvedValueOnce(null);
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      fakeGateway() as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(NotFoundException);
  });

  it('404s for a memberId that does not belong to this church', async () => {
    const prisma = fakePrisma();
    prisma.member.findFirst.mockResolvedValueOnce(null);
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      fakeGateway() as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow(NotFoundException);
  });

  it('rejects a pledgeId that does not belong to this campaign', async () => {
    const prisma = fakePrisma();
    prisma.pledge.findFirst.mockResolvedValueOnce(null);
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      fakeGateway() as never,
    );

    await expect(
      service.createIntentWithTransferAttempt({ ...INPUT, pledgeId: 'pledge-elsewhere' }),
    ).rejects.toThrow(BadRequestException);
  });

  it("takes expiresAt from the provider's response, not the requested TTL", async () => {
    const prisma = fakePrisma();
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await service.createIntentWithTransferAttempt(INPUT);

    const call = gateway.createTransferCharge.mock.calls[0]?.[0];
    expect(call.requestedExpiresAt).toBeInstanceOf(Date);
    // The result the service persists comes from CHARGE_RESULT.accountExpiresAt,
    // not from call.requestedExpiresAt — proven via the attempt.update call below.
    expect(prisma.paymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ expiresAt: new Date(CHARGE_RESULT.accountExpiresAt) }),
      }),
    );
  });

  it('marks the attempt and intent failed, and rethrows, when the gateway call fails', async () => {
    const prisma = fakePrisma();
    const gateway = { createTransferCharge: vi.fn().mockRejectedValue(new Error('paystack down')) };
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await expect(service.createIntentWithTransferAttempt(INPUT)).rejects.toThrow('paystack down');

    const failCall = prisma.$transaction.mock.calls.find((c) => Array.isArray(c[0]));
    expect(failCall).toBeDefined();
  });

  it('uses a placeholder email for a member with none on file', async () => {
    const prisma = fakePrisma();
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await service.createIntentWithTransferAttempt(INPUT);

    const call = gateway.createTransferCharge.mock.calls[0]?.[0];
    expect(call.email).toMatch(/^member\..+@giving\.koru\.ng$/);
  });
});

describe('DonationIntentService.createForUser', () => {
  it('404s when the session has no Member row in this church', async () => {
    const prisma = fakePrisma();
    prisma.member.findFirst.mockResolvedValueOnce(null);
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      fakeGateway() as never,
    );

    await expect(
      service.createForUser('user-1', CHURCH, {
        campaignId: CAMPAIGN,
        amountKobo: 150000,
        idempotencyKey: INPUT.idempotencyKey,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('resolves userId to memberId before delegating', async () => {
    const prisma = fakePrisma();
    prisma.member.findFirst.mockResolvedValue({ id: MEMBER });
    const gateway = fakeGateway();
    const service = new DonationIntentService(
      prisma as never,
      fakeOutbox() as never,
      gateway as never,
    );

    await service.createForUser('user-1', CHURCH, {
      campaignId: CAMPAIGN,
      amountKobo: 150000,
      idempotencyKey: INPUT.idempotencyKey,
    });

    expect(gateway.createTransferCharge).toHaveBeenCalled();
  });
});
