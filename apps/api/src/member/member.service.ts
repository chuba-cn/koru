import type { PaginationQuery } from '@koru/shared';
import { bigintToKobo, type JoinMemberInput } from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assertCursorVisible,
  assertValidDirection,
  buildCursorPage,
} from '../common/cursor-pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** userId is deliberately removed from every response */
const MEMBER_SELECT = {
  id: true,
  churchId: true,
  fullName: true,
  phone: true,
  email: true,
  homeBranchId: true,
  createdAt: true,
} satisfies Prisma.MemberSelect;

const PLEDGE_HISTORY_SELECT = {
  id: true,
  campaignId: true,
  pledgeAmountKobo: true,
  cadence: true,
  status: true,
  source: true,
  createdAt: true,
  campaign: { select: { id: true, title: true } },
} satisfies Prisma.PledgeSelect;

const PAYMENT_HISTORY_SELECT = {
  id: true,
  campaignId: true,
  pledgeId: true,
  amountKobo: true,
  channel: true,
  status: true,
  paidAt: true,
  createdAt: true,
  campaign: { select: { id: true, title: true } },
} satisfies Prisma.PaymentSelect;

@Injectable()
export class MemberService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);
  }

  async listBranches(churchId: string, query: PaginationQuery) {
    await this.assertChurchExists(churchId);

    const where: Prisma.BranchWhereInput = { churchId };

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
        select: { id: true, name: true },
        orderBy: backward ? [{ name: 'desc' }, { id: 'desc' }] : [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);

    return buildCursorPage(rows, totalCount, query);
  }

  async myProfile(
    userId: string,
    name: string,
    phoneNumber: string | null,
    query: PaginationQuery,
  ) {
    const where: Prisma.MemberWhereInput = { userId };

    assertValidDirection(query);
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.member.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const backward = query.direction === 'backward';
    const [totalCount, rows] = await Promise.all([
      this.prisma.member.count({ where }),
      this.prisma.member.findMany({
        where,
        select: MEMBER_SELECT,
        orderBy: backward
          ? [{ createdAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);

    return { name, phoneNumber, memberships: buildCursorPage(rows, totalCount, query) };
  }

  /**
   * Idempotent: a second call for the same (churchId, phone) updates rather than
   * duplicates. Phone numbers get reassigned (SIM recycling) — a row already
   * linked to a different login is a conflict, never silently reassigned.
   */
  async join(
    churchId: string,
    userId: string,
    phone: string,
    input: JoinMemberInput,
  ): Promise<{
    member: Prisma.MemberGetPayload<{ select: typeof MEMBER_SELECT }>;
    created: boolean;
  }> {
    await this.assertChurchExists(churchId);

    if (input.homeBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: input.homeBranchId, churchId },
      });

      if (!branch) {
        throw new BadRequestException(
          `homeBranchId ${input.homeBranchId} does not reference a branch of this church`,
        );
      }
    }

    const data = {
      userId,
      fullName: input.fullName,
      email: input.email ?? null,
      homeBranchId: input.homeBranchId ?? null,
    };

    const existing = await this.prisma.member.findUnique({
      where: { churchId_phone: { churchId, phone } },
      select: { id: true, userId: true },
    });

    if (!existing) {
      try {
        const member = await this.prisma.member.create({
          data: { churchId, phone, ...data },
          select: MEMBER_SELECT,
        });

        return { member, created: true };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // Lost a create race to a concurrent join call for the same phone. The
          // row now exists; re-run once and take the update-or-409 path below.
          return this.join(churchId, userId, phone, input);
        }
        throw e;
      }
    }

    if (existing.userId && existing.userId !== userId) {
      throw new ConflictException('This phone number is already linked to a different login');
    }

    const member = await this.prisma.member.update({
      where: { id: existing.id },
      data,
      select: MEMBER_SELECT,
    });
    return { member, created: false };
  }

  async myPledges(userId: string, churchId: string, query: PaginationQuery) {
    const where: Prisma.PledgeWhereInput = { member: { userId, churchId } };

    assertValidDirection(query);
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.pledge.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const backward = query.direction === 'backward';
    const [totalCount, rows] = await Promise.all([
      this.prisma.pledge.count({ where }),
      this.prisma.pledge.findMany({
        where,
        select: PLEDGE_HISTORY_SELECT,
        orderBy: backward
          ? [{ createdAt: 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);

    const page = buildCursorPage(rows, totalCount, query);
    return {
      ...page,
      items: page.items.map((pledge) => ({
        ...pledge,
        pledgeAmountKobo: bigintToKobo(pledge.pledgeAmountKobo),
      })),
    };
  }

  async myPayments(userId: string, churchId: string, query: PaginationQuery) {
    const where: Prisma.PaymentWhereInput = { member: { userId, churchId } };

    assertValidDirection(query);
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.payment.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const backward = query.direction === 'backward';
    const [totalCount, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        select: PAYMENT_HISTORY_SELECT,
        orderBy: backward
          ? [{ createdAt: 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);

    const page = buildCursorPage(rows, totalCount, query);
    return {
      ...page,
      items: page.items.map((payment) => ({
        ...payment,
        amountKobo: bigintToKobo(payment.amountKobo),
      })),
    };
  }
}
