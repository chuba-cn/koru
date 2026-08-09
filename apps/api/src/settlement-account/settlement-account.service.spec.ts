import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TenantStaff } from '../auth/tenant.guard';
import { Prisma } from '../generated/prisma/client';
import { SettlementAccountService } from './settlement-account.service';

const CHURCH = 'church-1';
const BRANCH = 'branch-1';
const BANKS = [
  { name: 'GTBank', slug: 'gtbank', code: '058', currency: 'NGN', active: true },
  { name: 'Zenith Bank', slug: 'zenith-bank', code: '057', currency: 'NGN', active: true },
];
const RESOLVED = { accountNumber: '1234567890', accountName: 'Resolved Real Name' };
const SUBACCOUNT = {
  provider: 'paystack' as const,
  subaccountCode: 'ACCT_abc123',
  accountNumberMasked: '******7890',
  bankCode: '058',
  isVerified: false,
};
const ACCOUNT = {
  id: 'account-1',
  churchId: CHURCH,
  branchId: null,
  label: 'Main Account',
  bankName: 'GTBank',
  bankCode: '058',
  accountName: 'Resolved Real Name',
  accountNumberMasked: '******7890',
};

function fakePrisma() {
  return {
    church: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === CHURCH ? { id: CHURCH, name: 'Grace Chapel' } : null),
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
      findFirst: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          where.id === ACCOUNT.id && where.churchId === CHURCH
            ? (ACCOUNT as Record<string, unknown>)
            : null,
        ),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ACCOUNT, ...data }),
      ),
    },
  };
}

function p2002On(target: string[]) {
  const error = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
  Object.assign(error, {
    message: 'Unique constraint failed',
    code: 'P2002',
    clientVersion: 'test',
    meta: { modelName: 'SettlementAccount', target },
  });
  return error;
}

function fakeScopeService(overrides: { branchIds?: string[] } = {}) {
  return {
    coveredRegionIds: vi.fn(() => Promise.resolve([])),
    coveredBranchIds: vi.fn(() => Promise.resolve(overrides.branchIds ?? [])),
  };
}

function fakeGateway() {
  return {
    listBanks: vi.fn(() => Promise.resolve(BANKS)),
    resolveAccountNumber: vi.fn(() => Promise.resolve(RESOLVED)),
    createSubaccount: vi.fn(() => Promise.resolve(SUBACCOUNT)),
  };
}

function callerWith(role: TenantStaff['role'], scopes: TenantStaff['scopes'] = []): TenantStaff {
  return { id: 'caller-1', churchId: CHURCH, role, scopes };
}

const CREATE_INPUT = { label: 'Main', accountNumber: '1234567890', bankCode: '058' };

describe('SettlementAccountService', () => {
  describe('create', () => {
    it('rejects when the church does not exist', async () => {
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(service.create('no-such-church', CREATE_INPUT)).rejects.toThrow(
        NotFoundException,
      );
      expect(gateway.listBanks).not.toHaveBeenCalled();
    });

    it('rejects a branchId that belongs to a different church', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(
        service.create(CHURCH, { ...CREATE_INPUT, branchId: 'someone-elses-branch' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.settlementAccount.create).not.toHaveBeenCalled();
      expect(gateway.listBanks).not.toHaveBeenCalled();
    });

    it('rejects an unknown bankCode and calls neither resolveAccountNumber nor createSubaccount', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(service.create(CHURCH, { ...CREATE_INPUT, bankCode: '999999' })).rejects.toThrow(
        BadRequestException,
      );
      expect(gateway.resolveAccountNumber).not.toHaveBeenCalled();
      expect(gateway.createSubaccount).not.toHaveBeenCalled();
      expect(prisma.settlementAccount.create).not.toHaveBeenCalled();
    });

    it('refuses a bank account already registered for this church, before touching the gateway', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.findFirst.mockResolvedValueOnce({ label: 'Building Fund' });
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(service.create(CHURCH, CREATE_INPUT)).rejects.toThrow(ConflictException);
      expect(gateway.createSubaccount).not.toHaveBeenCalled();
      expect(prisma.settlementAccount.create).not.toHaveBeenCalled();
    });

    it('names the existing account so an admin knows what they already have', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.findFirst.mockResolvedValueOnce({ label: 'Building Fund' });
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await expect(service.create(CHURCH, CREATE_INPUT)).rejects.toThrow(/Building Fund/);
    });

    it('looks the duplicate up by hash, never by the plaintext account number', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.create(CHURCH, CREATE_INPUT);

      const where = prisma.settlementAccount.findFirst.mock.calls[0]?.[0]?.where;
      expect(where.accountNumberHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(where)).not.toContain(CREATE_INPUT.accountNumber);
    });

    it('maps the account-number unique-constraint race to a 409, not a raw 500', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.create.mockRejectedValueOnce(
        p2002On(['churchId', 'bankCode', 'accountNumberHash']),
      );
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await expect(service.create(CHURCH, CREATE_INPUT)).rejects.toThrow(ConflictException);
    });

    it('does not disguise a different unique violation as a duplicate bank account', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.create.mockRejectedValueOnce(p2002On(['providerSubaccountCode']));
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await expect(service.create(CHURCH, CREATE_INPUT)).rejects.not.toBeInstanceOf(
        ConflictException,
      );
    });

    it('derives bankName from the provider directory, never from the request', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await service.create(CHURCH, CREATE_INPUT);

      expect(prisma.settlementAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ bankName: 'GTBank', bankCode: '058' }),
        }),
      );
    });

    it('derives accountName from name-enquiry, never from the request', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await service.create(CHURCH, CREATE_INPUT);

      expect(prisma.settlementAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountName: 'Resolved Real Name' }),
        }),
      );
    });

    it('aborts before createSubaccount when resolveAccountNumber throws, and writes nothing', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      gateway.resolveAccountNumber.mockRejectedValueOnce(new BadRequestException('bad account'));
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(service.create(CHURCH, CREATE_INPUT)).rejects.toThrow(BadRequestException);
      expect(gateway.createSubaccount).not.toHaveBeenCalled();
      expect(prisma.settlementAccount.create).not.toHaveBeenCalled();
    });

    it('writes nothing when createSubaccount throws', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      gateway.createSubaccount.mockRejectedValueOnce(new Error('paystack down'));
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(service.create(CHURCH, CREATE_INPUT)).rejects.toThrow('paystack down');
      expect(prisma.settlementAccount.create).not.toHaveBeenCalled();
    });

    it('calls createSubaccount with percentageCharge 0 and the new row id in metadata', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await service.create(CHURCH, CREATE_INPUT);

      expect(gateway.createSubaccount).toHaveBeenCalledWith(
        expect.objectContaining({
          percentageCharge: 0,
          bankCode: '058',
          accountNumber: '1234567890',
          metadata: expect.objectContaining({ churchId: CHURCH }),
        }),
      );
    });

    it("persists the adapter's masked account number, never the plaintext", async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await service.create(CHURCH, CREATE_INPUT);

      const call = prisma.settlementAccount.create.mock.calls[0]?.[0];
      expect(call?.data.accountNumberMasked).toBe('******7890');
      expect(JSON.stringify(call)).not.toContain('1234567890');
    });

    it('never returns the subaccount code or the account-number hash', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await service.create(CHURCH, CREATE_INPUT);

      const call = prisma.settlementAccount.create.mock.calls[0]?.[0];
      expect(call?.omit).toEqual({ providerSubaccountCode: true, accountNumberHash: true });
    });

    it('logs the orphaned subaccount code and rethrows when the row fails to persist after Paystack succeeds', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.create.mockRejectedValueOnce(new Error('db unreachable'));
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(service.create(CHURCH, CREATE_INPUT)).rejects.toThrow('db unreachable');
    });
  });

  describe('list', () => {
    const query = { limit: 50, direction: 'forward' as const };

    it('leaves the WHERE clause scoped to just churchId for a super_admin', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.list(CHURCH, callerWith('super_admin'), query);

      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ churchId: CHURCH }, {}] } }),
      );
    });

    it('scopes a delegated caller to their covered branches plus any church-wide account', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ branchIds: [BRANCH] });
      const service = new SettlementAccountService(
        prisma as never,
        scopeService as never,
        fakeGateway() as never,
      );
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
      const service = new SettlementAccountService(
        prisma as never,
        scopeService as never,
        fakeGateway() as never,
      );
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
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.list(CHURCH, callerWith('super_admin'), { ...query, cursor: ACCOUNT.id });

      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: ACCOUNT.id }, skip: 1 }),
      );
    });

    it('400s when the cursor lookup comes back empty, instead of silently paging', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.findFirst.mockResolvedValueOnce(null);
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

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
        fakeGateway() as never,
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
        fakeGateway() as never,
      );

      await expect(service.findById('another-church', ACCOUNT.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('only ever changes the label, never the account number', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.update(CHURCH, ACCOUNT.id, { label: 'New Label' });

      expect(prisma.settlementAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { label: 'New Label' } }),
      );
    });

    it('404s rather than updating an account that does not exist', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await expect(
        service.update(CHURCH, 'no-such-account', { label: 'New Label' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.settlementAccount.update).not.toHaveBeenCalled();
    });
  });
});
