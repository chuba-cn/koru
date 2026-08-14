import { createHmac, randomUUID } from 'node:crypto';
import type {
  CreateSettlementAccountInput,
  ListSettlementAccountsQuery,
  ScopeLevel,
  StaffRole,
  UpdateSettlementAccountInput,
} from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ScopeService } from '../auth/scope.service';
import type { TenantStaff } from '../auth/tenant.guard';
import {
  assertCursorVisible,
  assertValidDirection,
  buildCursorPage,
} from '../common/cursor-pagination';
import { SETTLEMENT_ACCOUNT_HASH_PEPPER } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { PAYMENT_GATEWAY, PaymentGateway } from '../payments/gateway/payment-gateway';
import { PAYSTACK_SUBACCOUNT_PERCENTAGE_CHARGE } from '../payments/gateway/paystack.config';
import { PrismaService } from '../prisma/prisma.service';

const publicShape = {
  omit: { providerSubaccountCode: true, accountNumberHash: true },
} as const;

const SCOPE_LEVEL_ROLES: Record<ScopeLevel, readonly StaffRole[]> = {
  church: ['super_admin'],
  region: ['super_admin', 'regional_admin', 'finance'],
  branch: ['super_admin', 'regional_admin', 'branch_admin', 'finance'],
};

type AccountScope = {
  scopeType: ScopeLevel;
  scopeRefId: string | null;
};

@Injectable()
export class SettlementAccountService {
  private readonly logger = new Logger(SettlementAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: ScopeService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Asserts that a church exists in the database and returns its record.
   *
   * @param churchId - The ID of the church tenant
   * @returns The Church entity record
   * @throws NotFoundException if the church does not exist
   */
  private async assertChurchExistsAndReturn(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);

    return church;
  }

  /**
   * Asserts that a caller has appropriate role privileges and domain scope authorization
   * to manage a settlement account at the target scope level.
   *
   * Rules:
   * - Validates caller role against `SCOPE_LEVEL_ROLES` for the target scope level.
   * - For 'region' or 'branch' scopes, delegates to `ScopeService.assertCanActOnScope`.
   *
   * @param caller - The logged-in staff member initiating the action
   * @param scope - The target account scope (`scopeType` and `scopeRefId`)
   * @throws ForbiddenException if caller role or scope authority is insufficient
   */
  private async assertMayActOnScope(caller: TenantStaff, scope: AccountScope) {
    if (!SCOPE_LEVEL_ROLES[scope.scopeType].includes(caller.role)) {
      throw new ForbiddenException(
        `A ${caller.role} cannot act on a ${scope.scopeType}-level settlement account`,
      );
    }

    if (scope.scopeType === 'church') return;

    await this.scopeService.assertCanActOnScope(caller, {
      scopeType: scope.scopeType,
      scopeRefId: scope.scopeRefId ?? '',
    });
  }

  /**
   * Builds the Prisma `WHERE` query filter to restrict settlement account visibility based on caller scopes.
   *
   * Visibility Rules:
   * - 'super_admin' sees all accounts across the church.
   * - Delegated roles see church-level accounts, plus accounts matching their covered region/branch IDs.
   *
   * @param churchId - The tenant church ID
   * @param caller - The logged-in staff member
   * @returns Prisma WHERE filter input object for SettlementAccount queries
   */
  private async scopeWhere(
    churchId: string,
    caller: TenantStaff,
  ): Promise<Prisma.SettlementAccountWhereInput> {
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
   * Creates a new settlement bank account for payouts/donations and registers a subaccount with the payment gateway.
   *
   * Workflow:
   * 1. Validates church existence, scope reference ID, and caller permission.
   * 2. Checks for duplicate account hashes within the church.
   * 3. Verifies bank code & resolves bank account name via payment gateway.
   * 4. Provisions a subaccount with the payment gateway (e.g. Paystack).
   * 5. Persists the settlement account record in the database.
   *
   * @param churchId - The tenant church ID
   * @param caller - The staff member creating the account
   * @param input - Account details including label, bankCode, accountNumber, scopeType, and scopeRefId
   * @returns Created SettlementAccount record (excluding sensitive internal fields)
   * @throws NotFoundException if church is not found
   * @throws ForbiddenException if caller lacks scope authority
   * @throws ConflictException if the bank account is already registered for this church
   * @throws BadRequestException if bank code or account number is invalid
   */
  async create(churchId: string, caller: TenantStaff, input: CreateSettlementAccountInput) {
    const church = await this.assertChurchExistsAndReturn(churchId);

    const scope: AccountScope = {
      scopeType: input.scopeType,
      scopeRefId: input.scopeRefId ?? null,
    };

    await this.scopeService.assertScopeRefInChurch(churchId, scope);
    await this.assertMayActOnScope(caller, scope);

    const accountNumberHash = createHmac('sha256', SETTLEMENT_ACCOUNT_HASH_PEPPER)
      .update(input.accountNumber)
      .digest('hex');

    const duplicate = await this.prisma.settlementAccount.findFirst({
      where: { churchId, bankCode: input.bankCode, accountNumberHash },
      select: { label: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `That bank account is already registered for this church as "${duplicate.label}"`,
      );
    }

    const banks = await this.gateway.listBanks();
    const bank = banks.find((bank) => bank.code === input.bankCode);
    if (!bank) {
      throw new BadRequestException(
        `Bank code ${input.bankCode} is not recognized by the payment gateway`,
      );
    }

    const resolved = await this.gateway.resolveAccountNumber({
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });

    const id = randomUUID();
    const subaccount = await this.gateway.createSubaccount({
      businessName: `${church.name} -- ${input.label}`.slice(0, 100),
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      percentageCharge: PAYSTACK_SUBACCOUNT_PERCENTAGE_CHARGE,
      metadata: { churchId, settlementAccountId: id },
    });

    try {
      return await this.prisma.settlementAccount.create({
        data: {
          id,
          churchId,
          label: input.label,
          scopeType: scope.scopeType,
          scopeRefId: scope.scopeRefId,
          bankCode: bank.code,
          bankName: bank.name,
          accountName: resolved.accountName,
          accountNumberMasked: subaccount.accountNumberMasked,
          accountNumberHash,
          providerSubaccountCode: subaccount.subaccountCode,
        },
        ...publicShape,
      });
    } catch (error: unknown) {
      this.logger.error(
        `Orphaned Paystack subaccount ${subaccount.subaccountCode} for church ${churchId}: the row failed to persist`,
      );
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        JSON.stringify(error.meta?.target ?? '').includes('accountNumberHash')
      ) {
        throw new ConflictException('That bank account is already registered for this church');
      }
      throw error;
    }
  }

  /**
   * Retrieves a paginated list of settlement accounts visible to the caller within a church.
   *
   * Enforces cursor-based pagination and scope-based visibility filtering.
   *
   * @param churchId - The tenant church ID
   * @param caller - The staff member making the query
   * @param query - Pagination parameters (limit, cursor, direction) and optional scope filters
   * @returns Paginated result containing settlement accounts and total count
   * @throws NotFoundException if church does not exist
   */
  async list(churchId: string, caller: TenantStaff, query: ListSettlementAccountsQuery) {
    await this.assertChurchExistsAndReturn(churchId);

    const where: Prisma.SettlementAccountWhereInput = {
      AND: [
        { churchId },
        await this.scopeWhere(churchId, caller),
        ...(query.scopeType ? [{ scopeType: query.scopeType }] : []),
        ...(query.scopeRefId ? [{ scopeRefId: query.scopeRefId }] : []),
      ],
    };

    assertValidDirection(query);
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.settlementAccount.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const backward = query.direction === 'backward';
    const [totalCount, rows] = await Promise.all([
      this.prisma.settlementAccount.count({ where }),
      this.prisma.settlementAccount.findMany({
        where,
        orderBy: backward ? [{ label: 'desc' }, { id: 'desc' }] : [{ label: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        ...publicShape,
      }),
    ]);

    return buildCursorPage(rows, totalCount, query);
  }

  /**
   * Retrieves a single settlement account by ID within a church.
   *
   * @param churchId - The tenant church ID
   * @param id - The settlement account ID
   * @returns The SettlementAccount record
   * @throws NotFoundException if the account does not exist
   */
  async findById(churchId: string, id: string) {
    const account = await this.prisma.settlementAccount.findFirst({
      where: { id, churchId },
      ...publicShape,
    });
    if (!account) throw new NotFoundException(`Settlement account ${id} not found`);
    return account;
  }

  /**
   * Asserts that updating an account's scope will not orphan any active campaigns linked to it.
   *
   * Expressed as a negated Prisma query for efficiency rather than looping over `ScopeService.covers`.
   * Must remain equivalent to `covers(newScope, campaignScope)`.
   *
   * @param churchId - The tenant church ID
   * @param accountId - The settlement account ID being updated
   * @param next - The proposed new account scope
   * @throws ConflictException if any existing campaigns linked to this account are no longer covered by `next` scope
   */
  private async assertCampaignsStillCovered(
    churchId: string,
    accountId: string,
    next: AccountScope,
  ) {
    if (next.scopeType === 'church') return;

    let stillCovered: Prisma.CampaignWhereInput;

    if (next.scopeType === 'region') {
      const branches = await this.prisma.branch.findMany({
        where: { churchId, regionId: next.scopeRefId ?? '' },
        select: { id: true },
      });

      stillCovered = {
        OR: [
          { scopeType: 'region', scopeRefId: next.scopeRefId },
          { scopeType: 'branch', scopeRefId: { in: branches.map((branch) => branch.id) } },
        ],
      };
    } else {
      stillCovered = { scopeType: 'branch', scopeRefId: next.scopeRefId };
    }

    const orphaned = await this.prisma.campaign.findMany({
      where: { churchId, settlementAccountId: accountId, NOT: stillCovered },
      select: { title: true },
      take: 5,
    });

    if (orphaned.length > 0) {
      throw new ConflictException(
        `Re-scoping this account to ${next.scopeType} level would leave campaigns settling into an account that no longer covers them: ${orphaned
          .map((campaign) => `"${campaign.title}"`)
          .join(', ')}`,
      );
    }
  }

  /**
   * Updates an existing settlement account's label or scope (`scopeType`, `scopeRefId`).
   *
   * Rules & Constraints:
   * - Caller must have administrative permissions over both the current scope and any newly requested scope.
   * - Changing scope validates that target scope reference exists within the church.
   * - Scope changes ensure all campaigns currently settling into this account remain fully covered by the new scope.
   * - Note: Re-registering with a different bank or account number is not supported because plaintext account numbers are never stored.
   *
   * @param churchId - The tenant church ID
   * @param id - The settlement account ID
   * @param caller - The staff member attempting the update
   * @param input - The update payload containing optional new label, scopeType, and scopeRefId
   * @returns Updated SettlementAccount record (excluding sensitive internal fields)
   * @throws NotFoundException if the account is not found
   * @throws ForbiddenException if caller lacks scope authority on current or requested scope
   * @throws ConflictException if re-scoping leaves existing linked campaigns uncovered
   * @throws BadRequestException if scope reference validation fails
   */
  async update(
    churchId: string,
    id: string,
    caller: TenantStaff,
    input: UpdateSettlementAccountInput,
  ) {
    const account = await this.findById(churchId, id);
    await this.assertMayActOnScope(caller, account);

    const requested: AccountScope | null =
      input.scopeType === undefined
        ? null
        : { scopeType: input.scopeType, scopeRefId: input.scopeRefId ?? null };

    const scopeChanging =
      requested !== null &&
      (requested.scopeType !== account.scopeType || requested.scopeRefId !== account.scopeRefId);

    if (scopeChanging && requested) {
      await this.scopeService.assertScopeRefInChurch(churchId, requested);
      await this.assertMayActOnScope(caller, requested);
      await this.assertCampaignsStillCovered(churchId, id, requested);
    }

    return this.prisma.settlementAccount.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(scopeChanging && requested
          ? { scopeType: requested.scopeType, scopeRefId: requested.scopeRefId }
          : {}),
      },
      ...publicShape,
    });
  }
}
