import type { ScopeInput } from '@koru/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async branchInRegion(branchId: string, regionId: string): Promise<boolean> {
    // A falsy id means malformed input, not "any region/branch" — Prisma treats
    // an undefined where-value as an omitted filter, which would otherwise widen
    // this into "does a branch with this id exist at all."
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
}
