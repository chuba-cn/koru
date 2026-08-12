import type { ScopeInput, ScopeRef } from '@koru/shared';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantStaff } from './tenant.guard';

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Checks database records to verify whether a specific branch belongs to a given region.
   *
   * @param churchId - The ID of the church (tenant)
   * @param branchId - The ID of the branch to check
   * @param regionId - The ID of the region to check against
   * @returns True if the branch exists in that region and church, false otherwise
   */
  async branchInRegion(churchId: string, branchId: string, regionId: string): Promise<boolean> {
    if (!branchId || !regionId) return false;

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, regionId, churchId },
      select: { id: true },
    });

    return branch !== null;
  }

  /**
   * Checks structural hierarchy: returns true if `outer` scope physically contains `inner` scope.
   *
   * Hierarchy Rules:
   * - A 'church' scope contains all regions and branches in that church.
   * - A 'region' scope contains itself and all branches inside it.
   * - A 'branch' scope contains only itself.
   *
   * @param churchId - The tenant church ID
   * @param outer - The container scope (e.g., Church or Region)
   * @param inner - The target scope being checked for containment
   * @returns True if `outer` encompasses `inner`, false otherwise
   *
   * Note: This checks pure resource containment (where locations live),
   * NOT user authority/permissions (use `scopeCovers` for user permission checks).
   */
  async covers(churchId: string, outer: ScopeRef, inner: ScopeRef): Promise<boolean> {
    if (outer.scopeType === 'church') return true;

    if (outer.scopeType === inner.scopeType && outer.scopeRefId === inner.scopeRefId) return true;

    if (outer.scopeType === 'region' && inner.scopeType === 'branch') {
      return this.branchInRegion(churchId, inner.scopeRefId ?? '', outer.scopeRefId ?? '');
    }

    return false;
  }

  /**
   * Evaluates whether a caller's assigned permissions grant authority over a target scope.
   *
   * Authority Rules (One-Directional):
   * - Exact Match: Caller has the exact same scope type and ID as the target.
   * - Top-Down Hierarchy: A caller with a 'region' scope has authority over all 'branch'es inside that region.
   * - No Bottom-Up Elevation: A caller with a 'branch' scope NEVER has authority over its parent 'region'
   *   (prevents branch staff from claiming region-level admin power).
   *
   * @param callerScopes - The array of scopes assigned to the caller
   * @param target - The target scope being accessed or modified
   * @returns True if the caller is authorized to manage the target scope
   */
  async scopeCovers(
    churchId: string,
    callerScopes: ScopeInput[],
    target: ScopeInput,
  ): Promise<boolean> {
    for (const scope of callerScopes) {
      if (await this.covers(churchId, scope, target)) return true;
    }

    return false;
  }

  /**
   * Asserts that a referenced region or branch scope ID exists in the database and belongs to the given church.
   *
   * Validation Behavior:
   * - Top-level 'church' scopes pass automatically (no reference ID check needed).
   * - 'region' or 'branch' scopes verify that `scopeRefId` matches an existing record in that church.
   *
   * @param churchId - The tenant church ID
   * @param scope - The scope reference object containing `scopeType` and `scopeRefId`
   * @throws BadRequestException if the referenced region or branch is not found in the church
   */
  async assertScopeRefInChurch(churchId: string, scope: ScopeRef): Promise<void> {
    if (scope.scopeType === 'church') return;

    const id = scope.scopeRefId ?? '';
    const found =
      scope.scopeType === 'region'
        ? await this.prisma.region.findFirst({
            where: { id, churchId },
            select: { id: true },
          })
        : await this.prisma.branch.findFirst({
            where: { id, churchId },
            select: { id: true },
          });

    if (!found) {
      throw new BadRequestException(
        `scopeRefId ${id} does not reference a ${scope.scopeType} in this church`,
      );
    }
  }

  /**
   * Returns all region IDs that should be visible to a caller (both directly assigned regions
   * and parent regions of their assigned branches).
   *
   * FOR READ/VISIBILITY ONLY: Do NOT use this for write/management permission checks!
   * Unlike `scopeCovers`, this resolves branch scopes upward to parent regions so branch staff
   * can view relevant regional context.
   *
   * @param churchId - The tenant church ID
   * @param caller - The logged-in staff member
   * @returns Array of unique region IDs visible to the caller
   */
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

  /**
   * Returns all branch IDs that fall under a caller's domain (both directly assigned branches
   * and all branches located within their assigned regions).
   *
   * Used for scoping queries (e.g., listing staff or resources under a caller's jurisdiction).
   *
   * @param churchId - The tenant church ID
   * @param caller - The logged-in staff member
   * @returns Array of unique branch IDs covered by the caller
   */
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

  /**
   * Asserts that a caller has permission to perform write/mutation actions on a target scope.
   * Throws a `ForbiddenException` if permission is denied.
   *
   * Authority Rules:
   * - 'super_admin' can act on any scope across the church.
   * - All other roles must have explicit authority over the target scope via `scopeCovers`.
   *
   * @param caller - The staff member attempting the action
   * @param target - The scope being acted upon
   * @throws ForbiddenException if caller lacks permission
   */
  async assertCanActOnScope(caller: TenantStaff, target: ScopeInput): Promise<void> {
    if (caller.role === 'super_admin') return;

    if (!(await this.scopeCovers(caller.churchId, caller.scopes, target))) {
      throw new ForbiddenException(`A ${caller.role} cannot act on this ${target.scopeType}`);
    }
  }
}
