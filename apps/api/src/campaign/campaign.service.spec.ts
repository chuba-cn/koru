import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TenantStaff } from '../auth/tenant.guard';
import { CampaignService } from './campaign.service';

const CHURCH = 'church-1';
const REGION = 'region-1';
const BRANCH = 'branch-1';
const OTHER_BRANCH = 'branch-2';
const CHURCH_ACCOUNT = 'account-church';
const REGION_ACCOUNT = 'account-region';
const BRANCH_ACCOUNT = 'account-branch';
const OTHER_BRANCH_ACCOUNT = 'account-other-branch';

const ACCOUNTS: Record<
  string,
  {
    id: string;
    scopeType: 'church' | 'region' | 'branch';
    scopeRefId: string | null;
    label: string;
  }
> = {
  [CHURCH_ACCOUNT]: {
    id: CHURCH_ACCOUNT,
    scopeType: 'church',
    scopeRefId: null,
    label: 'Church account',
  },
  [REGION_ACCOUNT]: {
    id: REGION_ACCOUNT,
    scopeType: 'region',
    scopeRefId: REGION,
    label: 'Region account',
  },
  [BRANCH_ACCOUNT]: {
    id: BRANCH_ACCOUNT,
    scopeType: 'branch',
    scopeRefId: BRANCH,
    label: 'Branch account',
  },
  [OTHER_BRANCH_ACCOUNT]: {
    id: OTHER_BRANCH_ACCOUNT,
    scopeType: 'branch',
    scopeRefId: OTHER_BRANCH,
    label: 'Other branch account',
  },
};

const CAMPAIGN = {
  id: 'campaign-1',
  churchId: CHURCH,
  title: 'Roof Fund',
  description: null,
  scopeType: 'branch' as const,
  scopeRefId: BRANCH,
  settlementAccountId: BRANCH_ACCOUNT,
  targetAmountKobo: BigInt(500000),
  currency: 'NGN',
  startDate: null,
  endDate: null,
  status: 'active' as const,
  createdById: 'caller-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function fakePrisma(overrides: { paymentCount?: number; intentCount?: number } = {}) {
  const client = {
    church: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === CHURCH ? { id: CHURCH, name: 'Grace Chapel' } : null),
      ),
    },
    settlementAccount: {
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) =>
        Promise.resolve(
          where.churchId === CHURCH && ACCOUNTS[where.id] ? ACCOUNTS[where.id] : null,
        ),
      ),
    },
    campaign: {
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...CAMPAIGN, ...args.data }),
      ),
      findFirst: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const id = 'AND' in where ? (where.AND as Record<string, unknown>[])[0].id : where.id;
        return Promise.resolve(id === CAMPAIGN.id ? CAMPAIGN : null);
      }),
      findMany: vi.fn(() => Promise.resolve([CAMPAIGN])),
      count: vi.fn(() => Promise.resolve(1)),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...CAMPAIGN, ...data }),
      ),
    },
    payment: {
      count: vi.fn(() => Promise.resolve(overrides.paymentCount ?? 0)),
    },
    donationIntent: {
      count: vi.fn(() => Promise.resolve(overrides.intentCount ?? 0)),
    },
  };

  return {
    ...client,
    $transaction: vi.fn((fn: (tx: typeof client) => unknown) => fn(client)),
  };
}

function fakeScopeService(
  overrides: {
    branchIds?: string[];
    regionIds?: string[];
    scopeRefFails?: boolean;
    actOnScopeFails?: boolean;
    coversResult?: boolean;
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
    covers: vi.fn(() => Promise.resolve(overrides.coversResult ?? true)),
  };
}

function callerWith(role: TenantStaff['role'], scopes: TenantStaff['scopes'] = []): TenantStaff {
  return { id: 'caller-1', churchId: CHURCH, role, scopes };
}

const SUPER_ADMIN = callerWith('super_admin');
const CREATE_INPUT = {
  title: 'Roof Fund',
  settlementAccountId: BRANCH_ACCOUNT,
  targetAmountKobo: 500000,
  scopeType: 'branch' as const,
  scopeRefId: BRANCH,
};

describe('CampaignService', () => {
  describe('create', () => {
    it('rejects when the church does not exist', async () => {
      const service = new CampaignService(fakePrisma() as never, fakeScopeService() as never);

      await expect(service.create('no-such-church', SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a scopeRefId that does not name a region/branch of this church, before checking the account', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ scopeRefFails: true });
      const service = new CampaignService(prisma as never, scopeService as never);

      await expect(service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.settlementAccount.findFirst).not.toHaveBeenCalled();
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it.each([
      ['regional_admin', 'church'],
      ['branch_admin', 'church'],
      ['finance', 'church'],
      ['branch_admin', 'region'],
    ] as const)('refuses a %s creating a %s-level campaign', async (role, scopeType) => {
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(
        service.create(CHURCH, callerWith(role), {
          ...CREATE_INPUT,
          scopeType,
          scopeRefId: scopeType === 'church' ? undefined : REGION,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it('refuses a branch_admin whose scope does not cover the target branch', async () => {
      const scopeService = fakeScopeService({ actOnScopeFails: true });
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, scopeService as never);

      await expect(
        service.create(
          CHURCH,
          callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: OTHER_BRANCH }]),
          CREATE_INPUT,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it('never consults ScopeService.assertCanActOnScope for a church-level campaign', async () => {
      const scopeService = fakeScopeService();
      const service = new CampaignService(fakePrisma() as never, scopeService as never);

      await service.create(CHURCH, SUPER_ADMIN, {
        ...CREATE_INPUT,
        scopeType: 'church',
        scopeRefId: undefined,
        settlementAccountId: CHURCH_ACCOUNT,
      });

      expect(scopeService.assertCanActOnScope).not.toHaveBeenCalled();
    });

    it('rejects a settlementAccountId that does not name an account of this church', async () => {
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(
        service.create(CHURCH, SUPER_ADMIN, { ...CREATE_INPUT, settlementAccountId: 'nope' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it('accepts a branch campaign settling into its own containing region account (upward)', async () => {
      const scopeService = fakeScopeService({ coversResult: true });
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, scopeService as never);

      await service.create(CHURCH, SUPER_ADMIN, {
        ...CREATE_INPUT,
        settlementAccountId: REGION_ACCOUNT,
      });

      expect(scopeService.covers).toHaveBeenCalledWith(
        CHURCH,
        expect.objectContaining({ scopeType: 'region', scopeRefId: REGION }),
        expect.objectContaining({ scopeType: 'branch', scopeRefId: BRANCH }),
      );
      expect(prisma.campaign.create).toHaveBeenCalled();
    });

    it('refuses a branch campaign settling into a sibling branch account (downward/sideways misroute)', async () => {
      const scopeService = fakeScopeService({ coversResult: false });
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, scopeService as never);

      await expect(
        service.create(CHURCH, SUPER_ADMIN, {
          ...CREATE_INPUT,
          settlementAccountId: OTHER_BRANCH_ACCOUNT,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it('sets createdById from the caller', async () => {
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, fakeScopeService() as never);
      const caller = callerWith('super_admin');
      caller.id = 'staff-42';

      await service.create(CHURCH, caller, CREATE_INPUT);

      expect(prisma.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ createdById: 'staff-42' }) }),
      );
    });

    it('converts targetAmountKobo to a bigint for the write and back to a number on return', async () => {
      const service = new CampaignService(fakePrisma() as never, fakeScopeService() as never);

      const result = await service.create(CHURCH, SUPER_ADMIN, CREATE_INPUT);

      expect(typeof result.targetAmountKobo).toBe('number');
      expect(result.targetAmountKobo).toBe(500000);
    });
  });

  describe('list', () => {
    it('imposes no scope filter for a super_admin', async () => {
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await service.list(CHURCH, SUPER_ADMIN, { direction: 'forward', limit: 50 } as never);

      const calls = prisma.campaign.findMany.mock.calls as unknown as [
        { where: { AND: unknown[] } },
      ][];
      const call = calls[0]?.[0];
      expect(call?.where.AND).toContainEqual({});
    });

    it('scopes a delegated caller to church-wide, their covered regions, and their covered branches', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ regionIds: [REGION], branchIds: [BRANCH] });
      const service = new CampaignService(prisma as never, scopeService as never);
      const caller = callerWith('finance', [{ scopeType: 'region', scopeRefId: REGION }]);

      await service.list(CHURCH, caller, { direction: 'forward', limit: 50 } as never);

      const calls = prisma.campaign.findMany.mock.calls as unknown as [
        { where: { AND: unknown[] } },
      ][];
      const call = calls[0]?.[0];
      expect(call?.where.AND).toContainEqual({
        OR: [
          { scopeType: 'church' },
          { scopeType: 'region', scopeRefId: { in: [REGION] } },
          { scopeType: 'branch', scopeRefId: { in: [BRANCH] } },
        ],
      });
    });

    it('composes an explicit status filter with the scope filter', async () => {
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await service.list(CHURCH, SUPER_ADMIN, {
        direction: 'forward',
        limit: 50,
        status: 'active',
      } as never);

      const calls = prisma.campaign.findMany.mock.calls as unknown as [
        { where: { AND: unknown[] } },
      ][];
      const call = calls[0]?.[0];
      expect(call?.where.AND).toContainEqual({ status: 'active' });
    });

    it('rejects a cursor that does not resolve within the caller-visible set', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findFirst.mockResolvedValueOnce(null);
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(
        service.list(CHURCH, SUPER_ADMIN, {
          direction: 'forward',
          limit: 50,
          cursor: 'not-visible',
        } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('404s when the campaign does not exist or is outside the caller scope', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findFirst.mockResolvedValueOnce(null);
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(service.findById(CHURCH, SUPER_ADMIN, 'no-such-campaign')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the campaign with targetAmountKobo as a plain number', async () => {
      const service = new CampaignService(fakePrisma() as never, fakeScopeService() as never);

      const result = await service.findById(CHURCH, SUPER_ADMIN, CAMPAIGN.id);

      expect(result.targetAmountKobo).toBe(500000);
    });
  });

  describe('update', () => {
    it('updates the title without touching scope or account', async () => {
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, { title: 'New Title' });

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: CAMPAIGN.id },
        data: { title: 'New Title' },
      });
    });

    it('renames a campaign that already has settled payments — the regression this ticket fixed', async () => {
      const prisma = fakePrisma({ paymentCount: 3 });
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, { title: 'Renamed' }),
      ).resolves.toBeDefined();
    });

    it('404s on a missing campaign', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findFirst.mockResolvedValueOnce(null);
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(
        service.update(CHURCH, 'no-such-campaign', SUPER_ADMIN, { title: 'New Title' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('authorizes against the current scope, then against the requested scope, when the scope changes', async () => {
      const scopeService = fakeScopeService();
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, scopeService as never);

      await service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, {
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

    it('refuses a branch_admin whose scope does not cover the requested new scope, even though they cover the current one', async () => {
      const scopeService = {
        ...fakeScopeService(),
        assertCanActOnScope: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new ForbiddenException('cannot act on requested scope')),
      };
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, scopeService as never);
      const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, caller, {
          scopeType: 'region',
          scopeRefId: REGION,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    it('refuses to change scope once a DonationIntent exists against the campaign', async () => {
      const prisma = fakePrisma({ intentCount: 1 });
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, {
          scopeType: 'church',
          scopeRefId: null,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    it('refuses to change scope once a settled Payment exists against the campaign', async () => {
      const prisma = fakePrisma({ paymentCount: 1 });
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, {
          scopeType: 'church',
          scopeRefId: null,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to repoint the settlement account once a settled Payment exists', async () => {
      const prisma = fakePrisma({ paymentCount: 1 });
      const service = new CampaignService(prisma as never, fakeScopeService() as never);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, {
          settlementAccountId: REGION_ACCOUNT,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    it('allows repointing the settlement account when only DonationIntents exist, never Payments — #143 already made that safe', async () => {
      const prisma = fakePrisma({ intentCount: 5, paymentCount: 0 });
      const scopeService = fakeScopeService({ coversResult: true });
      const service = new CampaignService(prisma as never, scopeService as never);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, {
          settlementAccountId: REGION_ACCOUNT,
        }),
      ).resolves.toBeDefined();
      expect(prisma.campaign.update).toHaveBeenCalled();
    });

    it('rejects repointing to an account whose scope no longer covers the campaign', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ coversResult: false });
      const service = new CampaignService(prisma as never, scopeService as never);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, {
          settlementAccountId: OTHER_BRANCH_ACCOUNT,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    it('rejects an endDate before startDate', async () => {
      const service = new CampaignService(fakePrisma() as never, fakeScopeService() as never);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, {
          startDate: '2026-06-01T00:00:00.000Z',
          endDate: '2026-05-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a requested scopeRefId that does not name a region/branch of this church', async () => {
      const scopeService = fakeScopeService({ scopeRefFails: true });
      const prisma = fakePrisma();
      const service = new CampaignService(prisma as never, scopeService as never);

      await expect(
        service.update(CHURCH, CAMPAIGN.id, SUPER_ADMIN, {
          scopeType: 'region',
          scopeRefId: 'no-such-region',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });
  });
});
