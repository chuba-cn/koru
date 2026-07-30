import type { ScopeInput } from '@koru/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantStaff } from './tenant.guard';

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async branchInRegion(branchId: string, regionId: string): Promise<boolean> {
    if (!branchId || !regionId) return false;

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, regionId },
      select: { id: true },
    });

    return branch !== null;
  }

  async scopeCovers(callerScopes: ScopeInput[], target: ScopeInput): Promise<boolean> {
    for (const scope of callerScopes) {
      if (scope.scopeType === target.scopeType && scope.scopeRefId === target.scopeRefId)
        return true;

      // Deliberately one-directional: a region scope reaches the branches inside
      // it, but a branch scope must never reach back up to its own containing
      // region as that would let branch-level staff claim region-level authority.
      if (scope.scopeType === 'region' && target.scopeType === 'branch') {
        if (await this.branchInRegion(target.scopeRefId, scope.scopeRefId)) return true;
      }
    }

    return false;
  }

  // For visibility only — do not use for authority checks. Unlike
  // scopeCovers, this resolves a branch scope up to its region on purpose.
  async coveredRegionIds(churchId: string, caller: TenantStaff): Promise<string[]> {
    const ownRegionIds = caller.scopes
      .filter((s) => s.scopeType === 'region')
      .map((s) => s.scopeRefId);
    const branchIds = caller.scopes
      .filter((s) => s.scopeType === 'branch')
      .map((s) => s.scopeRefId);

    const branchRegions = branchIds.length
      ? await this.prisma.branch.findMany({
          where: { churchId, id: { in: branchIds } },
          select: { regionId: true },
        })
      : [];

    return [
      ...new Set([
        ...ownRegionIds,
        ...branchRegions.map((b) => b.regionId).filter((id): id is string => id !== null),
      ]),
    ];
  }

  async coveredBranchIds(churchId: string, caller: TenantStaff): Promise<string[]> {
    const ownBranchIds = caller.scopes
      .filter((s) => s.scopeType === 'branch')
      .map((s) => s.scopeRefId);
    const regionIds = caller.scopes
      .filter((s) => s.scopeType === 'region')
      .map((s) => s.scopeRefId);

    const branchesInRegions = regionIds.length
      ? await this.prisma.branch.findMany({
          where: { churchId, regionId: { in: regionIds } },
          select: { id: true },
        })
      : [];

    return [...new Set([...ownBranchIds, ...branchesInRegions.map((b) => b.id)])];
  }
}
