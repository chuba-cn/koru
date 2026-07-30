import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TenantStaff } from '../auth/tenant.guard';
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
      count: vi.fn(() => Promise.resolve(1)),
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) =>
        Promise.resolve(where.id === ACCOUNT.id && where.churchId === CHURCH ? ACCOUNT : null),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ACCOUNT, ...data }),
      ),
    },
  };
}

function fakeScopeService(overrides: { branchIds?: string[] } = {}) {
  return {
    coveredRegionIds: vi.fn(() => Promise.resolve([])),
    coveredBranchIds: vi.fn(() => Promise.resolve(overrides.branchIds ?? [])),
  };
}

function callerWith(role: TenantStaff['role'], scopes: TenantStaff['scopes'] = []): TenantStaff {
  return { id: 'caller-1', churchId: CHURCH, role, scopes };
}

describe('SettlementAccountService', () => {
  describe('create', () => {
    it('rejects when the church does not exist', async () => {
      const service = new SettlementAccountService(
        fakePrisma() as never,
        fakeScopeService() as never,
      );

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
      const service = new SettlementAccountService(prisma as never, fakeScopeService() as never);

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
      const service = new SettlementAccountService(prisma as never, fakeScopeService() as never);

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
      const service = new SettlementAccountService(prisma as never, fakeScopeService() as never);

      await service.create(CHURCH, {
        label: 'Main',
        accountNumber: '1234567890',
        bankName: 'GTBank',
      });

      const call = prisma.settlementAccount.create.mock.calls[0]?.[0];
      expect(call?.omit).toEqual({ paystackSubaccountCode: true });
    });
  });

  describe('list', () => {
    const query = { limit: 50, direction: 'forward' as const };

    it('leaves the WHERE clause scoped to just churchId for a super_admin', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(prisma as never, fakeScopeService() as never);

      await service.list(CHURCH, callerWith('super_admin'), query);

      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ churchId: CHURCH }, {}] } }),
      );
    });

    it('scopes a delegated caller to their covered branches plus any church-wide account', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ branchIds: [BRANCH] });
      const service = new SettlementAccountService(prisma as never, scopeService as never);
      const caller = callerWith('finance', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

      await service.list(CHURCH, caller, query);

      expect(scopeService.coveredBranchIds).toHaveBeenCalledWith(CHURCH, caller);
      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { churchId: CHURCH },
              { OR: [{ branchId: { in: [BRANCH] } }, { branchId: null }] },
            ],
          },
        }),
      );
    });

    it('composes the existing branchId filter with the scope filter, narrowing rather than bypassing it', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ branchIds: [BRANCH] });
      const service = new SettlementAccountService(prisma as never, scopeService as never);
      const caller = callerWith('finance', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

      await service.list(CHURCH, caller, { ...query, branchId: BRANCH });

      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { churchId: CHURCH },
              { OR: [{ branchId: { in: [BRANCH] } }, { branchId: null }] },
              { branchId: BRANCH },
            ],
          },
        }),
      );
    });

    it('passes skip:1 and the cursor id through to findMany once the cursor is validated', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.findFirst.mockResolvedValueOnce(ACCOUNT);
      const service = new SettlementAccountService(prisma as never, fakeScopeService() as never);

      await service.list(CHURCH, callerWith('super_admin'), { ...query, cursor: ACCOUNT.id });

      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: ACCOUNT.id }, skip: 1 }),
      );
    });

    it('400s when the cursor lookup comes back empty, instead of silently paging', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.findFirst.mockResolvedValueOnce(null);
      const service = new SettlementAccountService(prisma as never, fakeScopeService() as never);

      await expect(
        service.list(CHURCH, callerWith('super_admin'), {
          ...query,
          cursor: 'someone-elses-account',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.settlementAccount.findMany).not.toHaveBeenCalled();
    });

    it('rejects direction=backward with no cursor rather than silently returning the last page', async () => {
      const service = new SettlementAccountService(
        fakePrisma() as never,
        fakeScopeService() as never,
      );

      await expect(
        service.list(CHURCH, callerWith('super_admin'), { limit: 50, direction: 'backward' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('refuses to find an account belonging to another church', async () => {
      const service = new SettlementAccountService(
        fakePrisma() as never,
        fakeScopeService() as never,
      );

      await expect(service.findById('another-church', ACCOUNT.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('only ever changes the label, never the account number', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(prisma as never, fakeScopeService() as never);

      await service.update(CHURCH, ACCOUNT.id, { label: 'New Label' });

      expect(prisma.settlementAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { label: 'New Label' } }),
      );
    });

    it('404s rather than updating an account that does not exist', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(prisma as never, fakeScopeService() as never);

      await expect(
        service.update(CHURCH, 'no-such-account', { label: 'New Label' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.settlementAccount.update).not.toHaveBeenCalled();
    });
  });
});
