import { createHmac, randomUUID } from 'node:crypto';
import type {
  CreateSettlementAccountInput,
  ListSettlementAccountsQuery,
  UpdateSettlementAccountInput,
} from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
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

@Injectable()
export class SettlementAccountService {
  private readonly logger = new Logger(SettlementAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: ScopeService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  private async assertChurchExistsAndReturn(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);

    return church;
  }

  private async assertBranchInChurch(churchId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, churchId } });
    if (!branch) {
      throw new BadRequestException(
        `branchId ${branchId} does not reference a branch of this church`,
      );
    }
  }

  async create(churchId: string, input: CreateSettlementAccountInput) {
    const church = await this.assertChurchExistsAndReturn(churchId);
    if (input.branchId) {
      await this.assertBranchInChurch(churchId, input.branchId);
    }

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
          branchId: input.branchId ?? null,
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

  async list(churchId: string, caller: TenantStaff, query: ListSettlementAccountsQuery) {
    await this.assertChurchExistsAndReturn(churchId);

    const scopeWhere: Prisma.SettlementAccountWhereInput =
      caller.role === 'super_admin'
        ? {}
        : {
            OR: [
              { branchId: { in: await this.scopeService.coveredBranchIds(churchId, caller) } },
              { branchId: null },
            ],
          };

    const where: Prisma.SettlementAccountWhereInput = {
      AND: [{ churchId }, scopeWhere, ...(query.branchId ? [{ branchId: query.branchId }] : [])],
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

  async findById(churchId: string, id: string) {
    const account = await this.prisma.settlementAccount.findFirst({
      where: { id, churchId },
      ...publicShape,
    });
    if (!account) throw new NotFoundException(`Settlement account ${id} not found`);
    return account;
  }

  /**
   * Label-only, deliberately. Paystack has PUT /subaccount/{code}, and this
   * does not call it. A stale business_name on Paystack's dashboard is
   * cosmetic and affects no routing. Re-registering a settlement account
   * with a different bank/account number is not built at all: doing so
   * would need the plaintext account number again, which this service never
   * stores.
   */
  async update(churchId: string, id: string, input: UpdateSettlementAccountInput) {
    await this.findById(churchId, id);
    return this.prisma.settlementAccount.update({
      where: { id },
      data: { label: input.label },
      ...publicShape,
    });
  }
}
