import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScopeService } from './scope.service';
import type { TenantStaff } from './tenant.guard';

const CHURCH = 'church-1';
const OTHER_CHURCH = 'church-2';
const REGION = 'region-1';
const OTHER_REGION = 'region-2';
const BRANCH_IN_REGION = 'branch-in-region';
const BRANCH_ELSEWHERE = 'branch-elsewhere';

function fakePrisma() {
  return {
    branch: {
      findFirst: vi.fn(
        ({ where }: { where: { id: string; regionId?: string; churchId: string } }) => {
          const inRegion =
            where.id === BRANCH_IN_REGION && where.regionId === REGION && where.churchId === CHURCH;
          const inChurch = where.id === BRANCH_IN_REGION && where.churchId === CHURCH;
          const matches = 'regionId' in where ? inRegion : inChurch;
          return Promise.resolve(matches ? { id: BRANCH_IN_REGION } : null);
        },
      ),
      findMany: vi.fn(
        (): Promise<Array<{ id?: string; regionId?: string | null }>> => Promise.resolve([]),
      ),
    },
    region: {
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) => {
        const found = where.id === REGION && where.churchId === CHURCH;
        return Promise.resolve(found ? { id: REGION } : null);
      }),
    },
  };
}

function callerWith(scopes: TenantStaff['scopes']): TenantStaff {
  return { id: 'caller-1', churchId: CHURCH, role: 'regional_admin', scopes };
}

describe('ScopeService', () => {
  describe('branchInRegion', () => {
    it('is true when the branch belongs to that region and church', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(service.branchInRegion(CHURCH, BRANCH_IN_REGION, REGION)).resolves.toBe(true);
    });

    it('is false when the branch belongs to a different region', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(service.branchInRegion(CHURCH, BRANCH_IN_REGION, OTHER_REGION)).resolves.toBe(
        false,
      );
    });

    it('is false when the branch and region match but the church does not', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(service.branchInRegion(OTHER_CHURCH, BRANCH_IN_REGION, REGION)).resolves.toBe(
        false,
      );
    });

    it('is false for a branch with no region at all', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(service.branchInRegion(CHURCH, BRANCH_ELSEWHERE, REGION)).resolves.toBe(false);
    });

    it.each([
      undefined,
      null,
      '',
    ] as const)('is false rather than an omitted filter when regionId is %s', async (badRegionId) => {
      const prisma = {
        branch: {
          findFirst: vi.fn(({ where }: { where: { regionId?: string | null } }) =>
            Promise.resolve(!where.regionId ? { id: BRANCH_IN_REGION } : null),
          ),
        },
      };
      const service = new ScopeService(prisma as never);

      await expect(
        service.branchInRegion(CHURCH, BRANCH_IN_REGION, badRegionId as unknown as string),
      ).resolves.toBe(false);
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      undefined,
      null,
      '',
    ] as const)('is false when branchId is %s, for the same reason', async (badBranchId) => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.branchInRegion(CHURCH, badBranchId as unknown as string, REGION),
      ).resolves.toBe(false);
    });
  });

  describe('covers (resource containment)', () => {
    it('a church scope contains any region', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.covers(
          CHURCH,
          { scopeType: 'church', scopeRefId: null },
          { scopeType: 'region', scopeRefId: REGION },
        ),
      ).resolves.toBe(true);
    });

    it('a church scope contains any branch', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.covers(
          CHURCH,
          { scopeType: 'church', scopeRefId: null },
          { scopeType: 'branch', scopeRefId: BRANCH_ELSEWHERE },
        ),
      ).resolves.toBe(true);
    });

    it('an exact region match covers', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.covers(
          CHURCH,
          { scopeType: 'region', scopeRefId: REGION },
          { scopeType: 'region', scopeRefId: REGION },
        ),
      ).resolves.toBe(true);
    });

    it('a region covers a branch inside it', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.covers(
          CHURCH,
          { scopeType: 'region', scopeRefId: REGION },
          { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
        ),
      ).resolves.toBe(true);
    });

    it('a region does not cover a branch outside it', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.covers(
          CHURCH,
          { scopeType: 'region', scopeRefId: OTHER_REGION },
          { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
        ),
      ).resolves.toBe(false);
    });

    it('a branch never covers its own containing region — one-directional', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.covers(
          CHURCH,
          { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
          { scopeType: 'region', scopeRefId: REGION },
        ),
      ).resolves.toBe(false);
    });

    it('a branch does not cover any other branch', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.covers(
          CHURCH,
          { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
          { scopeType: 'branch', scopeRefId: BRANCH_ELSEWHERE },
        ),
      ).resolves.toBe(false);
    });
  });

  describe('scopeCovers', () => {
    it('covers an exact region match', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(
        CHURCH,
        [{ scopeType: 'region', scopeRefId: REGION }],
        { scopeType: 'region', scopeRefId: REGION },
      );
      expect(covers).toBe(true);
    });

    it('covers a branch inside a region the caller holds', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(
        CHURCH,
        [{ scopeType: 'region', scopeRefId: REGION }],
        { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
      );
      expect(covers).toBe(true);
    });

    it("does not cover a branch outside the caller's region", async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(
        CHURCH,
        [{ scopeType: 'region', scopeRefId: OTHER_REGION }],
        { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
      );
      expect(covers).toBe(false);
    });

    it('does not cover when the caller has no scopes at all', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(CHURCH, [], {
        scopeType: 'region',
        scopeRefId: REGION,
      });
      expect(covers).toBe(false);
    });

    it('covers when any one of several scopes matches, not just the first', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(
        CHURCH,
        [
          { scopeType: 'region', scopeRefId: OTHER_REGION },
          { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
        ],
        { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
      );
      expect(covers).toBe(true);
    });

    it('threads churchId through to the containment check', async () => {
      const prisma = fakePrisma();
      const service = new ScopeService(prisma as never);

      await service.scopeCovers(OTHER_CHURCH, [{ scopeType: 'region', scopeRefId: REGION }], {
        scopeType: 'branch',
        scopeRefId: BRANCH_IN_REGION,
      });

      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ churchId: OTHER_CHURCH }) }),
      );
    });
  });

  describe('assertScopeRefInChurch', () => {
    it('is a no-op for a church scope, with no query at all', async () => {
      const prisma = fakePrisma();
      const service = new ScopeService(prisma as never);

      await expect(
        service.assertScopeRefInChurch(CHURCH, { scopeType: 'church', scopeRefId: null }),
      ).resolves.toBeUndefined();
      expect(prisma.region.findFirst).not.toHaveBeenCalled();
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });

    it('passes for a region that exists in this church', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.assertScopeRefInChurch(CHURCH, { scopeType: 'region', scopeRefId: REGION }),
      ).resolves.toBeUndefined();
    });

    it('throws for a region that does not exist in this church', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.assertScopeRefInChurch(CHURCH, {
          scopeType: 'region',
          scopeRefId: OTHER_REGION,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws for a region that belongs to a different church — a tenant crossing', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.assertScopeRefInChurch(OTHER_CHURCH, {
          scopeType: 'region',
          scopeRefId: REGION,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('passes for a branch that exists in this church', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.assertScopeRefInChurch(CHURCH, {
          scopeType: 'branch',
          scopeRefId: BRANCH_IN_REGION,
        }),
      ).resolves.toBeUndefined();
    });

    it('throws for a branch that does not exist in this church', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(
        service.assertScopeRefInChurch(CHURCH, {
          scopeType: 'branch',
          scopeRefId: BRANCH_ELSEWHERE,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('coveredRegionIds', () => {
    it("returns a caller's own region scopes directly, with no query at all", async () => {
      const prisma = fakePrisma();
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredRegionIds(
        CHURCH,
        callerWith([{ scopeType: 'region', scopeRefId: REGION }]),
      );

      expect(ids).toEqual([REGION]);
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });

    it('resolves a branch scope up to the region containing it', async () => {
      const prisma = fakePrisma();
      prisma.branch.findMany.mockResolvedValueOnce([{ regionId: REGION }]);
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredRegionIds(
        CHURCH,
        callerWith([{ scopeType: 'branch', scopeRefId: BRANCH_IN_REGION }]),
      );

      expect(prisma.branch.findMany).toHaveBeenCalledWith({
        where: { churchId: CHURCH, id: { in: [BRANCH_IN_REGION] } },
        select: { regionId: true },
      });
      expect(ids).toEqual([REGION]);
    });

    it('drops a branch scope that points at a regionless branch, rather than returning null', async () => {
      const prisma = fakePrisma();
      prisma.branch.findMany.mockResolvedValueOnce([{ regionId: null }]);
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredRegionIds(
        CHURCH,
        callerWith([{ scopeType: 'branch', scopeRefId: BRANCH_ELSEWHERE }]),
      );

      expect(ids).toEqual([]);
    });

    it('de-duplicates when a region scope and a branch scope resolve to the same region', async () => {
      const prisma = fakePrisma();
      prisma.branch.findMany.mockResolvedValueOnce([{ regionId: REGION }]);
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredRegionIds(
        CHURCH,
        callerWith([
          { scopeType: 'region', scopeRefId: REGION },
          { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
        ]),
      );

      expect(ids).toEqual([REGION]);
    });

    it('returns an empty list, with no query, for a caller with no scopes at all', async () => {
      const prisma = fakePrisma();
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredRegionIds(CHURCH, callerWith([]));

      expect(ids).toEqual([]);
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });
  });

  describe('coveredBranchIds', () => {
    it("returns a caller's own branch scopes directly, with no query at all", async () => {
      const prisma = fakePrisma();
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredBranchIds(
        CHURCH,
        callerWith([{ scopeType: 'branch', scopeRefId: BRANCH_IN_REGION }]),
      );

      expect(ids).toEqual([BRANCH_IN_REGION]);
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });

    it('resolves a region scope down to every branch inside it', async () => {
      const prisma = fakePrisma();
      prisma.branch.findMany.mockResolvedValueOnce([
        { id: BRANCH_IN_REGION },
        { id: 'another-branch-in-region' },
      ]);
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredBranchIds(
        CHURCH,
        callerWith([{ scopeType: 'region', scopeRefId: REGION }]),
      );

      expect(prisma.branch.findMany).toHaveBeenCalledWith({
        where: { churchId: CHURCH, regionId: { in: [REGION] } },
        select: { id: true },
      });
      expect(ids).toEqual([BRANCH_IN_REGION, 'another-branch-in-region']);
    });

    it('de-duplicates when a branch scope and a region scope both resolve to the same branch', async () => {
      const prisma = fakePrisma();
      prisma.branch.findMany.mockResolvedValueOnce([{ id: BRANCH_IN_REGION }]);
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredBranchIds(
        CHURCH,
        callerWith([
          { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
          { scopeType: 'region', scopeRefId: REGION },
        ]),
      );

      expect(ids).toEqual([BRANCH_IN_REGION]);
    });

    it('returns an empty list, with no query, for a caller with no scopes at all', async () => {
      const prisma = fakePrisma();
      const service = new ScopeService(prisma as never);

      const ids = await service.coveredBranchIds(CHURCH, callerWith([]));

      expect(ids).toEqual([]);
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });
  });

  describe('assertCanActOnScope', () => {
    const superAdmin: TenantStaff = {
      id: 'caller-1',
      churchId: CHURCH,
      role: 'super_admin',
      scopes: [],
    };

    it('lets a super_admin act on anything, without consulting scopes', async () => {
      const prisma = fakePrisma();
      const service = new ScopeService(prisma as never);

      await expect(
        service.assertCanActOnScope(superAdmin, { scopeType: 'region', scopeRefId: REGION }),
      ).resolves.toBeUndefined();
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });

    it('lets a delegate act on a scope they cover', async () => {
      const service = new ScopeService(fakePrisma() as never);

      await expect(
        service.assertCanActOnScope(callerWith([{ scopeType: 'region', scopeRefId: REGION }]), {
          scopeType: 'region',
          scopeRefId: REGION,
        }),
      ).resolves.toBeUndefined();
    });

    it('throws Forbidden when the delegate does not cover the target', async () => {
      const service = new ScopeService(fakePrisma() as never);

      await expect(
        service.assertCanActOnScope(
          callerWith([{ scopeType: 'region', scopeRefId: OTHER_REGION }]),
          { scopeType: 'region', scopeRefId: REGION },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a branch-scoped caller acting on their containing region', async () => {
      const service = new ScopeService(fakePrisma() as never);

      await expect(
        service.assertCanActOnScope(
          callerWith([{ scopeType: 'branch', scopeRefId: BRANCH_IN_REGION }]),
          { scopeType: 'region', scopeRefId: REGION },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("uses the caller's own churchId, never a value from the target", async () => {
      const prisma = fakePrisma();
      const service = new ScopeService(prisma as never);
      const caller = callerWith([{ scopeType: 'region', scopeRefId: REGION }]);

      await service.assertCanActOnScope(caller, {
        scopeType: 'branch',
        scopeRefId: BRANCH_IN_REGION,
      });

      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ churchId: caller.churchId }) }),
      );
    });
  });
});
