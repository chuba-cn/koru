import type {
  CreateSettlementAccountInput,
  ListSettlementAccountsQuery,
  UpdateSettlementAccountInput,
} from '@koru/shared';
import { maskTail } from '@koru/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const publicShape = {
  omit: { paystackSubaccountCode: true },
} as const;

@Injectable()
export class SettlementAccountService {
  constructor(private readonly prisma: PrismaService) {}

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

  async list(churchId: string, query: ListSettlementAccountsQuery) {
    await this.assertChurchExists(churchId);
    return this.prisma.settlementAccount.findMany({
      where: { churchId, ...(query.branchId ? { branchId: query.branchId } : {}) },
      orderBy: { label: 'asc' },
      ...publicShape,
    });
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
