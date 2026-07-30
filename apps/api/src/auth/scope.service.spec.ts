import { describe, expect, it, vi } from 'vitest';
import { ScopeService } from './scope.service';
import type { TenantStaff } from './tenant.guard';

const CHURCH = 'church-1';
const REGION = 'region-1';
const OTHER_REGION = 'region-2';
const BRANCH_IN_REGION = 'branch-in-region';
const BRANCH_ELSEWHERE = 'branch-elsewhere';

function fakePrisma() {
  return {
    branch: {
      findFirst: vi.fn(({ where }: { where: { id: string; regionId: string } }) => {
        const inRegion = where.id === BRANCH_IN_REGION && where.regionId === REGION;
        return Promise.resolve(inRegion ? { id: BRANCH_IN_REGION } : null);
      }),
      findMany: vi.fn(
        (): Promise<Array<{ id?: string; regionId?: string | null }>> => Promise.resolve([]),
      ),
    },
  };
}

function callerWith(scopes: TenantStaff['scopes']): TenantStaff {
  return { id: 'caller-1', churchId: CHURCH, role: 'regional_admin', scopes };
}

describe('ScopeService', () => {
  describe('branchInRegion', () => {
    it('is true when the branch belongs to that region', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(service.branchInRegion(BRANCH_IN_REGION, REGION)).resolves.toBe(true);
    });

    it('is false when the branch belongs to a different region', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(service.branchInRegion(BRANCH_IN_REGION, OTHER_REGION)).resolves.toBe(false);
    });

    it('is false for a branch with no region at all', async () => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(service.branchInRegion(BRANCH_ELSEWHERE, REGION)).resolves.toBe(false);
    });

    /**
     * Prisma treats an undefined where-value as an omitted filter, not a
     * wildcard — without this guard, a malformed regionId would widen the
     * check into "does a branch with this id exist at all," not "is it in
     * that region." Verified against a fake that returns true whenever the
     * regionId argument is falsy, since a real omitted filter would do the same.
     */
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
        service.branchInRegion(BRANCH_IN_REGION, badRegionId as unknown as string),
      ).resolves.toBe(false);
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      undefined,
      null,
      '',
    ] as const)('is false when branchId is %s, for the same reason', async (badBranchId) => {
      const service = new ScopeService(fakePrisma() as never);
      await expect(service.branchInRegion(badBranchId as unknown as string, REGION)).resolves.toBe(
        false,
      );
    });
  });

  describe('scopeCovers', () => {
    it('covers an exact region match', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers([{ scopeType: 'region', scopeRefId: REGION }], {
        scopeType: 'region',
        scopeRefId: REGION,
      });
      expect(covers).toBe(true);
    });

    it('covers an exact branch match', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(
        [{ scopeType: 'branch', scopeRefId: BRANCH_IN_REGION }],
        { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
      );
      expect(covers).toBe(true);
    });

    it('covers a branch inside a region the caller holds', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers([{ scopeType: 'region', scopeRefId: REGION }], {
        scopeType: 'branch',
        scopeRefId: BRANCH_IN_REGION,
      });
      expect(covers).toBe(true);
    });

    it("does not cover a branch outside the caller's region", async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(
        [{ scopeType: 'region', scopeRefId: OTHER_REGION }],
        { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
      );
      expect(covers).toBe(false);
    });

    /**
     * A branch scope must never reach upward to its own containing region —
     * that would let branch-level staff claim region-level authority.
     */
    it('does not let a branch scope cover its own containing region', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(
        [{ scopeType: 'branch', scopeRefId: BRANCH_IN_REGION }],
        { scopeType: 'region', scopeRefId: REGION },
      );
      expect(covers).toBe(false);
    });

    it('does not cover when the caller has no scopes at all', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers([], { scopeType: 'region', scopeRefId: REGION });
      expect(covers).toBe(false);
    });

    it('covers when any one of several scopes matches, not just the first', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const covers = await service.scopeCovers(
        [
          { scopeType: 'region', scopeRefId: OTHER_REGION },
          { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
        ],
        { scopeType: 'branch', scopeRefId: BRANCH_IN_REGION },
      );
      expect(covers).toBe(true);
    });

    /**
     * Region and branch ids never collide (separate tables), so a test built
     * only from realistic ids can't tell "the region->branch guard is present"
     * apart from "region and branch ids never happen to match." Stubbing
     * branchInRegion directly pins the guard itself, independent of id luck.
     */
    it('never attempts a containment check for a branch-scoped caller, exact match or not', async () => {
      const service = new ScopeService(fakePrisma() as never);
      const containmentCheck = vi.spyOn(service, 'branchInRegion');

      await service.scopeCovers([{ scopeType: 'branch', scopeRefId: BRANCH_IN_REGION }], {
        scopeType: 'region',
        scopeRefId: REGION,
      });
      await service.scopeCovers([{ scopeType: 'branch', scopeRefId: BRANCH_IN_REGION }], {
        scopeType: 'branch',
        scopeRefId: BRANCH_ELSEWHERE,
      });

      expect(containmentCheck).not.toHaveBeenCalled();
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
});
