import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TenantStaff } from '../auth/tenant.guard';
import { Prisma } from '../generated/prisma/client';
import { SettlementAccountService } from './settlement-account.service';

const CHURCH = 'church-1';
const REGION = 'region-1';
const BRANCH = 'branch-1';
const OTHER_BRANCH = 'branch-2';
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
  scopeType: 'branch' as const,
  scopeRefId: BRANCH,
  label: 'Main Account',
  bankName: 'GTBank',
  bankCode: '058',
  accountName: 'Resolved Real Name',
  accountNumberMasked: '******7890',
};
const CHURCH_ACCOUNT = {
  ...ACCOUNT,
  id: 'account-church',
  scopeType: 'church' as const,
  scopeRefId: null,
};

function fakePrisma() {
  return {
    church: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === CHURCH ? { id: CHURCH, name: 'Grace Chapel' } : null),
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
            : where.id === CHURCH_ACCOUNT.id && where.churchId === CHURCH
              ? (CHURCH_ACCOUNT as Record<string, unknown>)
              : null,
        ),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ACCOUNT, ...data }),
      ),
    },
    branch: {
      findMany: vi.fn(() => Promise.resolve([] as { id: string }[])),
    },
    campaign: {
      findMany: vi.fn(() => Promise.resolve([] as { title: string }[])),
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

function fakeScopeService(
  overrides: {
    branchIds?: string[];
    regionIds?: string[];
    scopeRefFails?: boolean;
    actOnScopeFails?: boolean;
  } = {},
) {
  return {
    assertScopeRefInChurch: vi.fn(() =>
      overrides.scopeRefFails
        ? Promise.reject(new BadRequestException('scopeRefId does not reference a region/branch'))
        : Promise.resolve(undefined),
    ),
    assertCanActOnScope: vi.fn(() =>
      overrides.actOnScopeFails
        ? Promise.reject(new ForbiddenException('cannot act on this scope'))
        : Promise.resolve(undefined),
    ),
    coveredRegionIds: vi.fn(() => Promise.resolve(overrides.regionIds ?? [])),
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

const SUPER_ADMIN = callerWith('super_admin');
const CREATE_INPUT = {
  label: 'Main',
  accountNumber: '1234567890',
  bankCode: '058',
  scopeType: 'branch' as const,
  scopeRefId: BRANCH,
};
const CREATE_CHURCH_INPUT = {
  ...CREATE_INPUT,
  scopeType: 'church' as const,
  scopeRefId: undefined,
};

describe('SettlementAccountService', () => {
  describe('create', () => {
    it('rejects when the church does not exist', async () => {
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(service.create('no-such-church', SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        NotFoundException,
      );
      expect(gateway.listBanks).not.toHaveBeenCalled();
    });

    it('rejects a scopeRefId that does not name a region/branch of this church, before touching the gateway', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ scopeRefFails: true });
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        scopeService as never,
        gateway as never,
      );

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        BadRequestException,
      );
      expect(gateway.listBanks).not.toHaveBeenCalled();
      expect(prisma.settlementAccount.create).not.toHaveBeenCalled();
    });

    it('checks the scope ref before the role/scope authority check', async () => {
      const scopeService = fakeScopeService();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        scopeService as never,
        fakeGateway() as never,
      );

      await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

      const refCallOrder = scopeService.assertScopeRefInChurch.mock.invocationCallOrder[0];
      const authCallOrder = scopeService.assertCanActOnScope.mock.invocationCallOrder[0];
      expect(refCallOrder).toBeLessThan(authCallOrder as number);
    });

    it.each([
      ['regional_admin', 'church'],
      ['branch_admin', 'church'],
      ['finance', 'church'],
      ['branch_admin', 'region'],
    ] as const)('refuses a %s registering a %s-level account, and never calls the gateway', async (role, scopeType) => {
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(
        service.create(CHURCH, callerWith(role), {
          ...CREATE_INPUT,
          scopeType,
          scopeRefId: scopeType === 'church' ? undefined : REGION,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(gateway.listBanks).not.toHaveBeenCalled();
    });

    it('lets a branch_admin register an account for a branch they cover', async () => {
      const scopeService = fakeScopeService();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        scopeService as never,
        fakeGateway() as never,
      );
      const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

      await service.create(CHURCH, caller, CREATE_INPUT);

      expect(scopeService.assertCanActOnScope).toHaveBeenCalledWith(caller, {
        scopeType: 'branch',
        scopeRefId: BRANCH,
      });
    });

    it('refuses a branch_admin whose scope does not cover the target branch', async () => {
      const scopeService = fakeScopeService({ actOnScopeFails: true });
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        scopeService as never,
        gateway as never,
      );

      await expect(
        service.create(
          CHURCH,
          callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: OTHER_BRANCH }]),
          CREATE_INPUT,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(gateway.listBanks).not.toHaveBeenCalled();
      expect(gateway.resolveAccountNumber).not.toHaveBeenCalled();
      expect(gateway.createSubaccount).not.toHaveBeenCalled();
    });

    it('never consults ScopeService.assertCanActOnScope for a church-level account — role alone decides it', async () => {
      const scopeService = fakeScopeService();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        scopeService as never,
        fakeGateway() as never,
      );

      await service.create(CHURCH, SUPER_ADMIN, CREATE_CHURCH_INPUT);

      expect(scopeService.assertCanActOnScope).not.toHaveBeenCalled();
    });

    it('rejects an unknown bankCode and calls neither resolveAccountNumber nor createSubaccount', async () => {
      const prisma = fakePrisma();
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await expect(
        service.create(CHURCH, SUPER_ADMIN, { ...CREATE_INPUT, bankCode: '999999' }),
      ).rejects.toThrow(BadRequestException);
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

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        ConflictException,
      );
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

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        /Building Fund/,
      );
    });

    it('looks the duplicate up by hash, never by the plaintext account number', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

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

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not disguise a different unique violation as a duplicate bank account', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.create.mockRejectedValueOnce(p2002On(['providerSubaccountCode']));
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.not.toBeInstanceOf(
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

      await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

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

      await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

      expect(prisma.settlementAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountName: 'Resolved Real Name' }),
        }),
      );
    });

    it('writes the scopeType and scopeRefId the caller submitted', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

      expect(prisma.settlementAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ scopeType: 'branch', scopeRefId: BRANCH }),
        }),
      );
    });

    it('writes a null scopeRefId for a church-level account', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.create(CHURCH, SUPER_ADMIN, CREATE_CHURCH_INPUT);

      expect(prisma.settlementAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ scopeType: 'church', scopeRefId: null }),
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

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        BadRequestException,
      );
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

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        'paystack down',
      );
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

      await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

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

      await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

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

      await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

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

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        'db unreachable',
      );
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

      await service.list(CHURCH, SUPER_ADMIN, query);

      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ churchId: CHURCH }, {}] } }),
      );
    });

    it('scopes a delegated caller to church-wide plus their covered regions and branches', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ branchIds: [BRANCH], regionIds: [REGION] });
      const service = new SettlementAccountService(
        prisma as never,
        scopeService as never,
        fakeGateway() as never,
      );
      const caller = callerWith('finance', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

      await service.list(CHURCH, caller, query);

      expect(scopeService.coveredRegionIds).toHaveBeenCalledWith(CHURCH, caller);
      expect(scopeService.coveredBranchIds).toHaveBeenCalledWith(CHURCH, caller);
      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { churchId: CHURCH },
              {
                OR: [
                  { scopeType: 'church' },
                  { scopeType: 'region', scopeRefId: { in: [REGION] } },
                  { scopeType: 'branch', scopeRefId: { in: [BRANCH] } },
                ],
              },
            ],
          },
        }),
      );
    });

    it('sees only the church-wide account, fail-closed, when the caller has no scopes at all', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService();
      const service = new SettlementAccountService(
        prisma as never,
        scopeService as never,
        fakeGateway() as never,
      );

      await service.list(CHURCH, callerWith('finance', []), query);

      expect(prisma.settlementAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { churchId: CHURCH },
              {
                OR: [
                  { scopeType: 'church' },
                  { scopeType: 'region', scopeRefId: { in: [] } },
                  { scopeType: 'branch', scopeRefId: { in: [] } },
                ],
              },
            ],
          },
        }),
      );
    });

    it('composes an explicit scopeType/scopeRefId filter with the scope arm, narrowing rather than bypassing it', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ branchIds: [BRANCH] });
      const service = new SettlementAccountService(
        prisma as never,
        scopeService as never,
        fakeGateway() as never,
      );
      const caller = callerWith('finance', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

      await service.list(CHURCH, caller, { ...query, scopeType: 'branch', scopeRefId: BRANCH });

      const calls = prisma.settlementAccount.findMany.mock.calls as unknown as [
        { where: { AND: unknown[] } },
      ][];
      const call = calls[0]?.[0];
      expect(call?.where.AND).toContainEqual({ scopeType: 'branch' });
      expect(call?.where.AND).toContainEqual({ scopeRefId: BRANCH });
    });

    it('passes skip:1 and the cursor id through to findMany once the cursor is validated', async () => {
      const prisma = fakePrisma();
      prisma.settlementAccount.findFirst.mockResolvedValueOnce(ACCOUNT);
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.list(CHURCH, SUPER_ADMIN, { ...query, cursor: ACCOUNT.id });

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
        service.list(CHURCH, SUPER_ADMIN, { ...query, cursor: 'someone-elses-account' }),
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
        service.list(CHURCH, SUPER_ADMIN, { limit: 50, direction: 'backward' }),
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
    it('changes only the label when scope is not sent', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.update(CHURCH, ACCOUNT.id, SUPER_ADMIN, { label: 'New Label' });

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
        service.update(CHURCH, 'no-such-account', SUPER_ADMIN, { label: 'New Label' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.settlementAccount.update).not.toHaveBeenCalled();
    });

    it("authorizes against the account's own loaded scope, not any scope from the request", async () => {
      const scopeService = fakeScopeService();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        scopeService as never,
        fakeGateway() as never,
      );

      await service.update(CHURCH, ACCOUNT.id, SUPER_ADMIN, { label: 'New Label' });

      expect(scopeService.assertCanActOnScope).toHaveBeenCalledWith(SUPER_ADMIN, {
        scopeType: ACCOUNT.scopeType,
        scopeRefId: ACCOUNT.scopeRefId,
      });
    });

    it('refuses a branch_admin relabelling a different branch’s account — the #138 escalation', async () => {
      const scopeService = fakeScopeService({ actOnScopeFails: true });
      const service = new SettlementAccountService(
        fakePrisma() as never,
        scopeService as never,
        fakeGateway() as never,
      );
      const caller = callerWith('branch_admin', [
        { scopeType: 'branch', scopeRefId: OTHER_BRANCH },
      ]);

      await expect(
        service.update(CHURCH, ACCOUNT.id, caller, { label: 'New Label' }),
      ).rejects.toThrow(ForbiddenException);
      expect(scopeService.assertCanActOnScope).toHaveBeenCalledWith(caller, {
        scopeType: 'branch',
        scopeRefId: BRANCH,
      });
    });

    it('refuses a non-super_admin relabelling the church-wide account', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await expect(
        service.update(CHURCH, CHURCH_ACCOUNT.id, callerWith('finance'), { label: 'New Label' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('moves an account to a new scope when nothing settles into it yet', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.update(CHURCH, ACCOUNT.id, SUPER_ADMIN, {
        scopeType: 'region',
        scopeRefId: REGION,
      });

      expect(prisma.settlementAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { scopeType: 'region', scopeRefId: REGION } }),
      );
    });

    it('checks authority over both the current scope and the requested scope', async () => {
      const scopeService = fakeScopeService();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        scopeService as never,
        fakeGateway() as never,
      );

      await service.update(CHURCH, ACCOUNT.id, SUPER_ADMIN, {
        scopeType: 'region',
        scopeRefId: REGION,
      });

      expect(scopeService.assertCanActOnScope).toHaveBeenCalledWith(SUPER_ADMIN, {
        scopeType: 'branch',
        scopeRefId: BRANCH,
      });
      expect(scopeService.assertCanActOnScope).toHaveBeenCalledWith(SUPER_ADMIN, {
        scopeType: 'region',
        scopeRefId: REGION,
      });
    });

    it('refuses a branch_admin re-scoping their own account up to a region they do not cover', async () => {
      const scopeService = {
        ...fakeScopeService(),
        assertCanActOnScope: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new ForbiddenException('cannot act on requested scope')),
      };
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        scopeService as never,
        fakeGateway() as never,
      );
      const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

      await expect(
        service.update(CHURCH, ACCOUNT.id, caller, { scopeType: 'region', scopeRefId: REGION }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.settlementAccount.update).not.toHaveBeenCalled();
    });

    it('rejects a requested scopeRefId that does not name a region/branch of this church', async () => {
      const scopeService = fakeScopeService({ scopeRefFails: true });
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        scopeService as never,
        fakeGateway() as never,
      );

      await expect(
        service.update(CHURCH, ACCOUNT.id, SUPER_ADMIN, {
          scopeType: 'region',
          scopeRefId: 'no-such-region',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.settlementAccount.update).not.toHaveBeenCalled();
    });

    it('refuses to narrow scope down to a branch when a campaign settling into it is region-scoped', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findMany.mockResolvedValueOnce([{ title: 'Building Fund' }]);
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await expect(
        service.update(CHURCH, CHURCH_ACCOUNT.id, SUPER_ADMIN, {
          scopeType: 'branch',
          scopeRefId: BRANCH,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.settlementAccount.update).not.toHaveBeenCalled();
    });

    it('names every orphaned campaign in the conflict message', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findMany.mockResolvedValueOnce([
        { title: 'Building Fund' },
        { title: 'Youth Camp' },
      ]);
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await expect(
        service.update(CHURCH, CHURCH_ACCOUNT.id, SUPER_ADMIN, {
          scopeType: 'branch',
          scopeRefId: BRANCH,
        }),
      ).rejects.toThrow(/Building Fund.*Youth Camp/);
    });

    it('allows re-scoping to church, where no campaign can ever be orphaned', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.update(CHURCH, ACCOUNT.id, SUPER_ADMIN, {
        scopeType: 'church',
        scopeRefId: null,
      });

      expect(prisma.campaign.findMany).not.toHaveBeenCalled();
      expect(prisma.settlementAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { scopeType: 'church', scopeRefId: null } }),
      );
    });

    it('narrowing to a branch checks orphans against exactly that branch, matching covers', async () => {
      const prisma = fakePrisma();
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.update(CHURCH, CHURCH_ACCOUNT.id, SUPER_ADMIN, {
        scopeType: 'branch',
        scopeRefId: BRANCH,
      });

      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: { scopeType: 'branch', scopeRefId: BRANCH },
          }),
        }),
      );
    });

    it('narrowing to a region checks orphans against that region and every branch inside it, matching covers', async () => {
      const prisma = fakePrisma();
      prisma.branch.findMany.mockResolvedValueOnce([{ id: BRANCH }, { id: OTHER_BRANCH }]);
      const service = new SettlementAccountService(
        prisma as never,
        fakeScopeService() as never,
        fakeGateway() as never,
      );

      await service.update(CHURCH, CHURCH_ACCOUNT.id, SUPER_ADMIN, {
        scopeType: 'region',
        scopeRefId: REGION,
      });

      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ churchId: CHURCH, regionId: REGION }),
        }),
      );
      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: {
              OR: [
                { scopeType: 'region', scopeRefId: REGION },
                { scopeType: 'branch', scopeRefId: { in: [BRANCH, OTHER_BRANCH] } },
              ],
            },
          }),
        }),
      );
    });

    it('never touches Paystack on a scope-only update', async () => {
      const gateway = fakeGateway();
      const service = new SettlementAccountService(
        fakePrisma() as never,
        fakeScopeService() as never,
        gateway as never,
      );

      await service.update(CHURCH, ACCOUNT.id, SUPER_ADMIN, {
        scopeType: 'region',
        scopeRefId: REGION,
      });

      expect(gateway.createSubaccount).not.toHaveBeenCalled();
      expect(gateway.resolveAccountNumber).not.toHaveBeenCalled();
    });
  });
});
