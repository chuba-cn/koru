import {
  bigintToKobo,
  type CreateCampaignInput,
  koboToBigint,
  type ListCampaignsQuery,
  type ScopeLevel,
  type StaffRole,
  type UpdateCampaignInput,
} from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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

const CAMPAIGN_SCOPE_LEVEL_ROLES: Record<ScopeLevel, readonly StaffRole[]> = {
  church: ['super_admin'],
  region: ['super_admin', 'regional_admin', 'finance'],
  branch: ['super_admin', 'regional_admin', 'branch_admin', 'finance'],
};

type CampaignScope = { scopeType: ScopeLevel; scopeRefId: string | null };

const toPublic = <T extends { targetAmountKobo: bigint }>(campaign: T) => ({
  ...campaign,
  targetAmountKobo: bigintToKobo(campaign.targetAmountKobo),
});

/**
 * Service for managing church project-giving and pledge campaigns.
 * Handles campaign creation, listing, retrieval, and updating while enforcing tenant isolation,
 * role-based scope access control, settlement account scope coverage, and immutability guards.
 */
@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: ScopeService,
  ) {}

  /**
   * Asserts that a church exists in the database.
   *
   * @param churchId - The ID of the church tenant
   * @throws NotFoundException if the church does not exist
   */
  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);
  }

  /**
   * Asserts that a caller has appropriate staff role privileges and domain scope authorization
   * to manage a campaign at the target scope level.
   *
   * Rules:
   * - Validates caller role against `CAMPAIGN_SCOPE_LEVEL_ROLES` for the target scope level.
   * - For 'region' or 'branch' scopes, delegates to `ScopeService.assertCanActOnScope`.
   *
   * @param caller - The staff member initiating the action
   * @param scope - The campaign target scope (`scopeType` and `scopeRefId`)
   * @throws ForbiddenException if caller role or scope authority is insufficient
   */
  private async assertMayActOnScope(caller: TenantStaff, scope: CampaignScope) {
    if (!CAMPAIGN_SCOPE_LEVEL_ROLES[scope.scopeType].includes(caller.role)) {
      throw new ForbiddenException(
        `A ${caller.role} cannot act on a ${scope.scopeType}-level campaign`,
      );
    }

    if (scope.scopeType === 'church') return;

    await this.scopeService.assertCanActOnScope(caller, {
      scopeType: scope.scopeType,
      scopeRefId: scope.scopeRefId ?? '',
    });
  }

  /**
   * Asserts that a settlement account belongs to the specified church and covers the given campaign scope.
   *
   * @param churchId - The tenant church ID
   * @param settlementAccountId - The settlement account ID to validate
   * @param scope - The target campaign scope
   * @throws BadRequestException if the settlement account does not exist or cannot cover the campaign scope
   */
  private async assertAccountCoversCampaign(
    churchId: string,
    settlementAccountId: string,
    scope: CampaignScope,
  ) {
    const account = await this.prisma.settlementAccount.findFirst({
      where: { id: settlementAccountId, churchId },
      select: { label: true, scopeType: true, scopeRefId: true },
    });

    if (!account) {
      throw new BadRequestException(
        `settlementAccountId ${settlementAccountId} does not reference a settlement account of this church`,
      );
    }

    if (!(await this.scopeService.covers(churchId, account, scope))) {
      throw new BadRequestException(
        `Settlement account "${account.label}" is ${account.scopeType}-scoped and cannot receive the giving of a ${scope.scopeType}-scoped campaign`,
      );
    }
  }

  /**
   * Builds the Prisma `WHERE` query filter to restrict campaign visibility based on caller scopes.
   *
   * Visibility Rules:
   * - 'super_admin' sees all campaigns across the church.
   * - Delegated roles see church-level campaigns, plus campaigns matching their covered region/branch IDs.
   *
   * @param churchId - The tenant church ID
   * @param caller - The logged-in staff member
   * @returns Prisma WHERE filter input object for Campaign queries
   */
  private async scopeWhere(
    churchId: string,
    caller: TenantStaff,
  ): Promise<Prisma.CampaignWhereInput> {
    if (caller.role === 'super_admin') return {};

    const [regionIds, branchIds] = await Promise.all([
      this.scopeService.coveredRegionIds(churchId, caller),
      this.scopeService.coveredBranchIds(churchId, caller),
    ]);

    return {
      OR: [
        { scopeType: 'church' },
        { scopeType: 'region', scopeRefId: { in: regionIds } },
        { scopeType: 'branch', scopeRefId: { in: branchIds } },
      ],
    };
  }

  /**
   * Creates a new campaign for a church.
   *
   * Validates church existence, scope hierarchy reference, caller scope permissions,
   * and settlement account scope coverage before persisting.
   *
   * @param churchId - The tenant church ID
   * @param caller - The staff member creating the campaign
   * @param input - Campaign creation payload
   * @returns The created campaign object with `targetAmountKobo` formatted as a number
   * @throws NotFoundException if church does not exist
   * @throws ForbiddenException if caller lacks necessary role or scope authority
   * @throws BadRequestException if settlement account or scope reference validation fails
   */
  async create(churchId: string, caller: TenantStaff, input: CreateCampaignInput) {
    await this.assertChurchExists(churchId);

    const scope: CampaignScope = {
      scopeType: input.scopeType,
      scopeRefId: input.scopeRefId ?? null,
    };

    await this.scopeService.assertScopeRefInChurch(churchId, scope);
    await this.assertMayActOnScope(caller, scope);
    await this.assertAccountCoversCampaign(churchId, input.settlementAccountId, scope);

    const campaign = await this.prisma.campaign.create({
      data: {
        churchId,
        title: input.title,
        description: input.description ?? null,
        scopeType: scope.scopeType,
        scopeRefId: scope.scopeRefId,
        settlementAccountId: input.settlementAccountId,
        targetAmountKobo: koboToBigint(input.targetAmountKobo),
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        ...(input.status ? { status: input.status } : {}),
        createdById: caller.id,
      },
    });

    return toPublic(campaign);
  }

  /**
   * Lists campaigns visible to the caller within a church, supporting filters and cursor pagination.
   *
   * @param churchId - The tenant church ID
   * @param caller - The staff member requesting the campaign list
   * @param query - Query filter and cursor pagination options
   * @returns Paginated campaign items and pagination metadata
   * @throws NotFoundException if the church does not exist
   * @throws BadRequestException if cursor or pagination parameters are invalid
   */
  async list(churchId: string, caller: TenantStaff, query: ListCampaignsQuery) {
    await this.assertChurchExists(churchId);

    const where: Prisma.CampaignWhereInput = {
      AND: [
        { churchId },
        await this.scopeWhere(churchId, caller),
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.scopeRefId ? [{ scopeRefId: query.scopeRefId }] : []),
        ...(query.scopeType ? [{ scopeType: query.scopeType }] : []),
        ...(query.settlementAccountId ? [{ settlementAccountId: query.settlementAccountId }] : []),
      ],
    };

    assertValidDirection(query);
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.campaign.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const backward = query.direction === 'backward';
    const [totalCount, rows] = await Promise.all([
      this.prisma.campaign.count({ where }),
      this.prisma.campaign.findMany({
        where,
        orderBy: backward ? [{ title: 'desc' }, { id: 'desc' }] : [{ title: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);

    const page = buildCursorPage(rows, totalCount, query);
    return { ...page, items: page.items.map(toPublic) };
  }

  /**
   * Finds a campaign by ID within a church, subject to caller scope visibility.
   *
   * @param churchId - The tenant church ID
   * @param caller - The staff member retrieving the campaign
   * @param id - The ID of the campaign
   * @returns The campaign object formatted for public consumption
   * @throws NotFoundException if the campaign is not found or not visible to caller
   */
  async findById(churchId: string, caller: TenantStaff, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { AND: [{ id, churchId }, await this.scopeWhere(churchId, caller)] },
    });
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);

    return toPublic(campaign);
  }

  /**
   * Loads a raw campaign record by ID within a church without caller scope filtering.
   *
   * @param churchId - The tenant church ID
   * @param id - The campaign ID
   * @returns The raw database campaign entity
   * @throws NotFoundException if the campaign does not exist in the church
   */
  private async loadInChurch(churchId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, churchId } });
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);

    return campaign;
  }

  /**
   * Updates an existing campaign's metadata, scope, settlement account, or active dates.
   *
   * Immutability and Business Rules:
   * - Changing settlement account is forbidden if settled payments already exist for the campaign.
   * - Changing scope is forbidden if donation intents or settled payments already exist.
   * - Scope changes require target scope verification and caller permission checks.
   * - Settlement account changes require settlement account scope coverage checks.
   * - End date cannot precede start date.
   *
   * @param churchId - The tenant church ID
   * @param id - The ID of the campaign to update
   * @param caller - The staff member performing the update
   * @param input - Partial update fields
   * @returns The updated campaign object formatted for public output
   * @throws NotFoundException if campaign is not found
   * @throws ForbiddenException if caller lacks permission on current or requested scope
   * @throws ConflictException if attempting to change account/scope when financial activity exists
   * @throws BadRequestException if requested dates or settlement account scope coverage are invalid
   */
  async update(churchId: string, id: string, caller: TenantStaff, input: UpdateCampaignInput) {
    const current = await this.loadInChurch(churchId, id);
    await this.assertMayActOnScope(caller, current);

    const requestedScope: CampaignScope | null =
      input.scopeType === undefined
        ? null
        : { scopeType: input.scopeType, scopeRefId: input.scopeRefId ?? null };

    const scopeChanging =
      requestedScope !== null &&
      (requestedScope.scopeType !== current.scopeType ||
        requestedScope.scopeRefId !== current.scopeRefId);

    const accountChanging =
      input.settlementAccountId !== undefined &&
      input.settlementAccountId !== current.settlementAccountId;

    if (scopeChanging || accountChanging) {
      const [paymentCount, intentCount] = await Promise.all([
        this.prisma.payment.count({ where: { churchId, campaignId: id } }),
        scopeChanging
          ? this.prisma.donationIntent.count({ where: { churchId, campaignId: id } })
          : Promise.resolve(0),
      ]);

      if (accountChanging && paymentCount > 0) {
        throw new ConflictException(
          `This campaign has ${paymentCount} settled payment(s) against its current settlement account; repointing it would make that history unexplainable`,
        );
      }

      if (scopeChanging && (intentCount > 0 || paymentCount > 0)) {
        throw new ConflictException(
          'This campaign already has giving against it, so its scope can no longer be changed',
        );
      }
    }

    if (scopeChanging && requestedScope) {
      await this.scopeService.assertScopeRefInChurch(churchId, requestedScope);
      await this.assertMayActOnScope(caller, requestedScope);
    }

    const nextScope: CampaignScope = scopeChanging && requestedScope ? requestedScope : current;
    const nextAccountId = input.settlementAccountId ?? current.settlementAccountId;

    if (scopeChanging || accountChanging) {
      await this.assertAccountCoversCampaign(churchId, nextAccountId, nextScope);
    }

    const nextStart =
      input.startDate === undefined
        ? current.startDate
        : input.startDate
          ? new Date(input.startDate)
          : null;
    const nextEnd =
      input.endDate === undefined
        ? current.endDate
        : input.endDate
          ? new Date(input.endDate)
          : null;

    if (nextStart && nextEnd && nextEnd < nextStart) {
      throw new BadRequestException('endDate must not be before startDate');
    }

    // The counts above are an early, friendly check — a Payment or DonationIntent
    // could still land in the gap between that count and this write. Re-verify
    // inside the same transaction as the write itself, so the two can never
    // disagree: either the lockout still holds and nothing is written, or it
    // doesn't and the write is the very next statement on the same snapshot.
    const updated = await this.prisma.$transaction(async (tx) => {
      if (scopeChanging || accountChanging) {
        const [paymentCount, intentCount] = await Promise.all([
          tx.payment.count({ where: { churchId, campaignId: id } }),
          scopeChanging
            ? tx.donationIntent.count({ where: { churchId, campaignId: id } })
            : Promise.resolve(0),
        ]);

        if (accountChanging && paymentCount > 0) {
          throw new ConflictException(
            `This campaign has ${paymentCount} settled payment(s) against its current settlement account; repointing it would make that history unexplainable`,
          );
        }

        if (scopeChanging && (intentCount > 0 || paymentCount > 0)) {
          throw new ConflictException(
            'This campaign already has giving against it, so its scope can no longer be changed',
          );
        }
      }

      return tx.campaign.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.targetAmountKobo !== undefined
            ? { targetAmountKobo: koboToBigint(input.targetAmountKobo) }
            : {}),
          ...(input.startDate !== undefined ? { startDate: nextStart } : {}),
          ...(input.endDate !== undefined ? { endDate: nextEnd } : {}),
          ...(scopeChanging && requestedScope
            ? { scopeType: requestedScope.scopeType, scopeRefId: requestedScope.scopeRefId }
            : {}),
          ...(accountChanging ? { settlementAccountId: input.settlementAccountId } : {}),
        },
      });
    });

    return toPublic(updated);
  }
}
