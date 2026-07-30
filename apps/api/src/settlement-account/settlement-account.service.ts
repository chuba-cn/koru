import type {
  CreateSettlementAccountInput,
  ListSettlementAccountsQuery,
  UpdateSettlementAccountInput,
} from '@koru/shared';
import { maskTail } from '@koru/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ScopeService } from '../auth/scope.service';
import type { TenantStaff } from '../auth/tenant.guard';
import {
  assertCursorVisible,
  assertValidDirection,
  buildCursorPage,
} from '../common/cursor-pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const publicShape = {
  omit: { paystackSubaccountCode: true },
} as const;

@Injectable()
export class SettlementAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: ScopeService,
  ) {}

  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);
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
    await this.assertChurchExists(churchId);
    if (input.branchId) {
      await this.assertBranchInChurch(churchId, input.branchId);
    }

    const accountNumberMasked = maskTail(input.accountNumber);

    return this.prisma.settlementAccount.create({
      data: {
        churchId,
        label: input.label,
        bankName: input.bankName,
        branchId: input.branchId ?? null,
        accountNumberMasked,
      },
      ...publicShape,
    });
  }

  async list(churchId: string, caller: TenantStaff, query: ListSettlementAccountsQuery) {
    await this.assertChurchExists(churchId);

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

  async update(churchId: string, id: string, input: UpdateSettlementAccountInput) {
    await this.findById(churchId, id);
    return this.prisma.settlementAccount.update({
      where: { id },
      data: { label: input.label },
      ...publicShape,
    });
  }
}
