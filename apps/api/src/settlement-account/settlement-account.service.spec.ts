import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SettlementAccountService } from './settlement-account.service';

const CHURCH = 'church-1';
const BRANCH = 'branch-1';
const ACCOUNT = {
  id: 'account-1',
  churchId: CHURCH,
  branchId: null,
  label: 'Main Account',
  bankName: 'GTBank',
  accountNumberMasked: '******7890',
};

function fakePrisma() {
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
    settlementAccount: {
      create: vi.fn((_args: { data: Record<string, unknown>; omit: Record<string, boolean> }) =>
        Promise.resolve(ACCOUNT),
      ),
      findMany: vi.fn(() => Promise.resolve([ACCOUNT])),
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) =>
        Promise.resolve(where.id === ACCOUNT.id && where.churchId === CHURCH ? ACCOUNT : null),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ACCOUNT, ...data }),
      ),
    },
  };
}

describe('SettlementAccountService', () => {
  describe('create', () => {
    it('rejects when the church does not exist', async () => {
      const service = new SettlementAccountService(fakePrisma() as never);

      await expect(
        service.create('no-such-church', {
          label: 'Main',
          accountNumber: '1234567890',
          bankName: 'GTBank',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a branchId that belongs to a different church', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(prisma as never);

      await expect(
        service.create(CHURCH, {
          label: 'Main',
          accountNumber: '1234567890',
          bankName: 'GTBank',
          branchId: 'someone-elses-branch',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.settlementAccount.create).not.toHaveBeenCalled();
    });

    it('masks the account number before it ever reaches the database', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(prisma as never);

      await service.create(CHURCH, {
        label: 'Main',
        accountNumber: '1234567890',
        bankName: 'GTBank',
      });

      expect(prisma.settlementAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountNumberMasked: '******7890' }),
        }),
      );
      const call = prisma.settlementAccount.create.mock.calls[0]?.[0];
      expect(JSON.stringify(call)).not.toContain('1234567890');
    });

    it('never returns the raw Paystack subaccount code', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(prisma as never);

      await service.create(CHURCH, {
        label: 'Main',
        accountNumber: '1234567890',
        bankName: 'GTBank',
      });

      const call = prisma.settlementAccount.create.mock.calls[0]?.[0];
      expect(call?.omit).toEqual({ paystackSubaccountCode: true });
    });
  });

  describe('findById', () => {
    it('refuses to find an account belonging to another church', async () => {
      const service = new SettlementAccountService(fakePrisma() as never);

      await expect(service.findById('another-church', ACCOUNT.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('only ever changes the label, never the account number', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(prisma as never);

      await service.update(CHURCH, ACCOUNT.id, { label: 'New Label' });

      expect(prisma.settlementAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { label: 'New Label' } }),
      );
    });

    it('404s rather than updating an account that does not exist', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(prisma as never);

      await expect(
        service.update(CHURCH, 'no-such-account', { label: 'New Label' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.settlementAccount.update).not.toHaveBeenCalled();
    });
  });
});
