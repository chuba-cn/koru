import type { CreateBranchInput, ListBranchesQuery, UpdateBranchInput } from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ScopeService } from '../auth/scope.service';
import type { TenantStaff } from '../auth/tenant.guard';
import {
  assertCursorVisible,
  assertValidDirection,
  buildCursorPage,
} from '../common/cursor-pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: ScopeService,
  ) {}

  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);
  }

  private async assertRegionInChurch(churchId: string, regionId: string) {
    const region = await this.prisma.region.findFirst({ where: { id: regionId, churchId } });

    if (!region) {
      throw new BadRequestException(
        `regionId ${regionId} does not reference a region of this church`,
      );
    }
  }

  /**
   * Asserts that moving a branch to a new region (or detaching it from a region) will not orphan
   * any branch-scoped campaigns whose settlement accounts are tied to the branch's current region.
   *
   * Background:
   * A region-scoped settlement account covers all branches within that region. If a branch-scoped
   * campaign points to a region-level settlement account, re-assigning the branch to a different
   * region would break `ScopeService.covers(account, campaign)`, leaving the campaign settling into
   * an account that no longer covers its branch.
   *
   * @param churchId - The tenant church ID
   * @param branchId - The ID of the branch being moved
   * @param nextRegionId - The target region ID (or `null` if detaching from a region)
   * @throws ConflictException if any branch-level campaign is linked to a region-level settlement account
   *                         that does not match `nextRegionId`
   */
  private async assertCampaignsStillCoveredAfterMove(
    churchId: string,
    branchId: string,
    nextRegionId: string | null,
  ) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { churchId, scopeType: 'branch', scopeRefId: branchId },
      select: {
        title: true,
        settlementAccount: { select: { scopeType: true, scopeRefId: true } },
      },
    });

    const orphaned = campaigns.filter(
      (campaign) =>
        campaign.settlementAccount.scopeType === 'region' &&
        campaign.settlementAccount.scopeRefId !== nextRegionId,
    );

    if (orphaned.length > 0) {
      throw new ConflictException(
        `Moving this branch would leave campaigns settling into an account that no longer covers them: ${orphaned
          .map((campaign) => `"${campaign.title}"`)
          .join(', ')}`,
      );
    }
  }

  async create(churchId: string, caller: TenantStaff, input: CreateBranchInput) {
    await this.assertChurchExists(churchId);
    if (input.regionId) {
      await this.assertRegionInChurch(churchId, input.regionId);
      await this.scopeService.assertCanActOnScope(caller, {
        scopeType: 'region',
        scopeRefId: input.regionId,
      });
    }

    try {
      return await this.prisma.branch.create({ data: { churchId, ...input } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Branch "${input.name}" already exists in this church`);
      }
      throw e;
    }
  }

  async list(churchId: string, caller: TenantStaff, query: ListBranchesQuery) {
    await this.assertChurchExists(churchId);

    const scopeWhere: Prisma.BranchWhereInput =
      caller.role === 'super_admin'
        ? {}
        : {
            id: { in: await this.scopeService.coveredBranchIds(churchId, caller) },
          };

    const where: Prisma.BranchWhereInput = {
      AND: [{ churchId }, scopeWhere, ...(query.regionId ? [{ regionId: query.regionId }] : [])],
    };

    assertValidDirection(query);
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.branch.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const backward = query.direction === 'backward';
    const [totalCount, rows] = await Promise.all([
      this.prisma.branch.count({ where }),
      this.prisma.branch.findMany({
        where,
        orderBy: backward ? [{ name: 'desc' }, { id: 'desc' }] : [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);

    return buildCursorPage(rows, totalCount, query);
  }

  async findById(churchId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, churchId } });
    if (!branch) throw new NotFoundException(`Branch ${id} not found`);
    return branch;
  }

  async update(churchId: string, id: string, caller: TenantStaff, input: UpdateBranchInput) {
    const current = await this.findById(churchId, id);
    await this.scopeService.assertCanActOnScope(caller, { scopeType: 'branch', scopeRefId: id });

    // A move needs authority over BOTH sides — the region losing the branch and
    // the one gaining it — or a caller could detach/steal a branch through a
    // region they otherwise have no authority over.
    if (typeof input.regionId !== 'undefined' && input.regionId !== current.regionId) {
      if (current.regionId) {
        await this.scopeService.assertCanActOnScope(caller, {
          scopeType: 'region',
          scopeRefId: current.regionId,
        });
      }

      if (typeof input.regionId === 'string') {
        await this.assertRegionInChurch(churchId, input.regionId);
        await this.scopeService.assertCanActOnScope(caller, {
          scopeType: 'region',
          scopeRefId: input.regionId,
        });
      }

      await this.assertCampaignsStillCoveredAfterMove(
        churchId,
        id,
        typeof input.regionId === 'string' ? input.regionId : null,
      );
    }

    try {
      return await this.prisma.branch.update({ where: { id }, data: input });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Branch "${input.name}" already exists in this church`);
      }

      throw e;
    }
  }
}
