import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { MemberService } from './member.service';

const CHURCH = 'church-1';
const BRANCH = 'branch-1';
const CALLER = 'user-caller';
const PHONE = '+2348012345600';
const INPUT = { fullName: 'Ada Lovelace' };

function fakePrisma() {
  const rows = new Map<
    string,
    { id: string; churchId: string; phone: string; userId: string | null }
  >();

  const pledgeRows: Array<{ userId: string; churchId: string; [key: string]: unknown }> = [];
  const paymentRows: Array<{ userId: string; churchId: string; [key: string]: unknown }> = [];

  return {
    church: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === CHURCH ? { id: CHURCH } : null),
      ),
    },
    branch: {
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) =>
        Promise.resolve(where.id === BRANCH && where.churchId === CHURCH ? { id: BRANCH } : null),
      ),
    },
    member: {
      findUnique: vi.fn(
        ({ where }: { where: { churchId_phone: { churchId: string; phone: string } } }) => {
          const row = [...rows.values()].find(
            (r) =>
              r.churchId === where.churchId_phone.churchId &&
              r.phone === where.churchId_phone.phone,
          );
          return Promise.resolve(row ?? null);
        },
      ),
      findMany: vi.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve([...rows.values()].filter((r) => r.userId === where.userId)),
      ),
      create: vi.fn(({ data }: { data: { churchId: string; phone: string; userId: string } }) => {
        const row = { id: `member-${rows.size + 1}`, ...data };
        rows.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: { userId: string } }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    pledge: {
      findMany: vi.fn(({ where }: { where: { member: { userId: string; churchId: string } } }) => {
        const matches = pledgeRows.filter(
          (r) => r.userId === where.member.userId && r.churchId === where.member.churchId,
        );
        return Promise.resolve(matches.map(({ userId: _u, churchId: _c, ...rest }) => rest));
      }),
    },
    payment: {
      findMany: vi.fn(({ where }: { where: { member: { userId: string; churchId: string } } }) => {
        const matches = paymentRows.filter(
          (r) => r.userId === where.member.userId && r.churchId === where.member.churchId,
        );
        return Promise.resolve(matches.map(({ userId: _u, churchId: _c, ...rest }) => rest));
      }),
    },
    seed: (row: { id: string; churchId: string; phone: string; userId: string | null }) =>
      rows.set(row.id, row),
    seedPledge: (row: { userId: string; churchId: string; [key: string]: unknown }) =>
      pledgeRows.push(row),
    seedPayment: (row: { userId: string; churchId: string; [key: string]: unknown }) =>
      paymentRows.push(row),
  };
}

describe('MemberService', () => {
  describe('listBranches', () => {
    it('rejects when the church does not exist', async () => {
      const service = new MemberService(fakePrisma() as never);
      await expect(service.listBranches('no-such-church')).rejects.toThrow(NotFoundException);
    });
  });

  describe('myProfile', () => {
    it('returns only the memberships belonging to this login', async () => {
      const prisma = fakePrisma();
      prisma.seed({ id: 'member-1', churchId: CHURCH, phone: PHONE, userId: CALLER });
      prisma.seed({
        id: 'member-2',
        churchId: 'other-church',
        phone: '+2348011111111',
        userId: 'someone-else',
      });
      const service = new MemberService(prisma as never);

      const profile = await service.myProfile(CALLER, 'Ada', PHONE);

      expect(profile.memberships).toHaveLength(1);
      expect(profile.memberships[0]?.id).toBe('member-1');
    });
  });

  describe('join', () => {
    it('rejects when the church does not exist', async () => {
      const service = new MemberService(fakePrisma() as never);
      await expect(service.join('no-such-church', CALLER, PHONE, INPUT)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a homeBranchId that belongs to a different church', async () => {
      const service = new MemberService(fakePrisma() as never);
      await expect(
        service.join(CHURCH, CALLER, PHONE, { ...INPUT, homeBranchId: 'someone-elses-branch' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a new Member linked to the caller when none exists yet', async () => {
      const prisma = fakePrisma();
      const service = new MemberService(prisma as never);

      const { member, created } = await service.join(CHURCH, CALLER, PHONE, INPUT);

      expect(created).toBe(true);
      expect(member.phone).toBe(PHONE);
      expect(prisma.member.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: CALLER }) }),
      );
    });

    it('links an existing unclaimed Member (userId null) to the caller', async () => {
      const prisma = fakePrisma();
      prisma.seed({ id: 'member-1', churchId: CHURCH, phone: PHONE, userId: null });
      const service = new MemberService(prisma as never);

      const { member, created } = await service.join(CHURCH, CALLER, PHONE, INPUT);

      expect(created).toBe(false);
      expect(prisma.member.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'member-1' },
          data: expect.objectContaining({ userId: CALLER }),
        }),
      );
      expect(member).toBeDefined();
    });

    it('is idempotent when the caller already owns this Member', async () => {
      const prisma = fakePrisma();
      prisma.seed({ id: 'member-1', churchId: CHURCH, phone: PHONE, userId: CALLER });
      const service = new MemberService(prisma as never);

      const { created } = await service.join(CHURCH, CALLER, PHONE, {
        fullName: 'Ada, Countess of Lovelace',
      });

      expect(created).toBe(false);
      expect(prisma.member.create).not.toHaveBeenCalled();
    });

    /**
     * The SIM-recycling guard: a phone can be reassigned, but a Member row
     * already linked to someone else must never be silently reattributed.
     */
    it('409s when the phone is already linked to a different login', async () => {
      const prisma = fakePrisma();
      prisma.seed({ id: 'member-1', churchId: CHURCH, phone: PHONE, userId: 'someone-else' });
      const service = new MemberService(prisma as never);

      await expect(service.join(CHURCH, CALLER, PHONE, INPUT)).rejects.toThrow(ConflictException);
      expect(prisma.member.update).not.toHaveBeenCalled();
    });

    it('retries as an update when a concurrent join wins the create race', async () => {
      const prisma = fakePrisma();
      prisma.member.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '7',
        }),
      );
      // Simulate the concurrent winner's row appearing between our failed create and our retry.
      prisma.member.findUnique.mockImplementationOnce(() => Promise.resolve(null));
      prisma.seed({ id: 'member-1', churchId: CHURCH, phone: PHONE, userId: CALLER });
      const service = new MemberService(prisma as never);

      const { created } = await service.join(CHURCH, CALLER, PHONE, INPUT);

      expect(created).toBe(false);
      expect(prisma.member.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('myPledges', () => {
    it('scopes the query to the caller and the church, which is the isolation mechanism', async () => {
      const prisma = fakePrisma();
      const service = new MemberService(prisma as never);

      await service.myPledges(CALLER, CHURCH);

      expect(prisma.pledge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { member: { userId: CALLER, churchId: CHURCH } } }),
      );
    });

    it('converts the BigInt pledgeAmountKobo to a plain number', async () => {
      const prisma = fakePrisma();
      prisma.seedPledge({
        userId: CALLER,
        churchId: CHURCH,
        id: 'pledge-1',
        campaignId: 'campaign-1',
        pledgeAmountKobo: 50_000_00n,
        cadence: 'monthly',
        status: 'active',
        source: 'self',
        createdAt: new Date(),
        campaign: { id: 'campaign-1', title: 'Building Fund' },
      });
      const service = new MemberService(prisma as never);

      const [pledge] = await service.myPledges(CALLER, CHURCH);

      expect(pledge?.pledgeAmountKobo).toBe(5_000_000);
      expect(typeof pledge?.pledgeAmountKobo).toBe('number');
    });

    /**
     * The guard bigintToKobo exists for: a corrupted amount must never reach a
     * client silently. A too-large pledge fails the request rather than
     * rounding.
     */
    it('propagates a RangeError rather than a corrupted amount, above the safe integer range', async () => {
      const prisma = fakePrisma();
      prisma.seedPledge({
        userId: CALLER,
        churchId: CHURCH,
        id: 'pledge-1',
        campaignId: 'campaign-1',
        pledgeAmountKobo: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        cadence: 'monthly',
        status: 'active',
        source: 'self',
        createdAt: new Date(),
        campaign: { id: 'campaign-1', title: 'Building Fund' },
      });
      const service = new MemberService(prisma as never);

      await expect(service.myPledges(CALLER, CHURCH)).rejects.toThrow(RangeError);
    });
  });

  describe('myPayments', () => {
    it('scopes the query to the caller and the church, which is the isolation mechanism', async () => {
      const prisma = fakePrisma();
      const service = new MemberService(prisma as never);

      await service.myPayments(CALLER, CHURCH);

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { member: { userId: CALLER, churchId: CHURCH } } }),
      );
    });

    it('converts the BigInt amountKobo to a plain number', async () => {
      const prisma = fakePrisma();
      prisma.seedPayment({
        userId: CALLER,
        churchId: CHURCH,
        id: 'payment-1',
        campaignId: 'campaign-1',
        pledgeId: null,
        amountKobo: 20_000_00n,
        channel: 'paystack_transfer',
        status: 'success',
        paidAt: new Date(),
        createdAt: new Date(),
        campaign: { id: 'campaign-1', title: 'Building Fund' },
      });
      const service = new MemberService(prisma as never);

      const [payment] = await service.myPayments(CALLER, CHURCH);

      expect(payment?.amountKobo).toBe(2_000_000);
      expect(typeof payment?.amountKobo).toBe('number');
    });
  });
});
