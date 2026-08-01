import type { PaginationQuery } from '@koru/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ScopeService } from '../auth/scope.service';
import type { TenantStaff } from '../auth/tenant.guard';
import {
  assertCursorVisible,
  assertValidDirection,
  buildCursorPage,
} from '../common/cursor-pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';

const RESENDABLE_STATUSES = ['failed', 'bounced', 'complained'];

@Injectable()
export class EmailLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: ScopeService,
    private readonly mail: MailService,
  ) {}

  private async buildVisibilityWhere(
    churchId: string,
    caller: TenantStaff,
  ): Promise<Prisma.EmailLogWhereInput> {
    if (caller.role === 'super_admin') return { churchId };

    const coveredBranchIds = await this.scopeService.coveredBranchIds(churchId, caller);

    return {
      churchId,
      OR: [
        { recipientStaffId: null, recipientMemberId: null },
        {
          staff: {
            scopes: { some: { scopeType: 'branch', scopeRefId: { in: coveredBranchIds } } },
          },
        },
        { member: { homeBranchId: { in: coveredBranchIds } } },
      ],
    };
  }

  async list(churchId: string, caller: TenantStaff, query: PaginationQuery) {
    const where = await this.buildVisibilityWhere(churchId, caller);
    const backward = query.direction === 'backward';

    assertValidDirection(query);
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.emailLog.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const [totalCount, rows] = await Promise.all([
      this.prisma.emailLog.count({ where }),
      this.prisma.emailLog.findMany({
        where,
        orderBy: backward
          ? [{ createdAt: 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          category: true,
          recipientEmail: true,
          recipientStaffId: true,
          recipientMemberId: true,
          subject: true,
          status: true,
          failureReason: true,
          sentAt: true,
          deliveredAt: true,
          createdAt: true,
        },
      }),
    ]);

    return buildCursorPage(rows, totalCount, query);
  }

  async resend(churchId: string, id: string, caller: TenantStaff) {
    const where = await this.buildVisibilityWhere(churchId, caller);
    const log = await this.prisma.emailLog.findFirst({ where: { AND: [where, { id }] } });

    if (!log) throw new NotFoundException(`Email log ${id} not found`);

    if (!RESENDABLE_STATUSES.includes(log.status)) {
      throw new ConflictException(`Cannot resend a log with status "${log.status}"`);
    }

    return this.mail.send({
      churchId,
      category: log.category,
      to: log.recipientEmail,
      recipientStaffId: log.recipientStaffId ?? undefined,
      recipientMemberId: log.recipientMemberId ?? undefined,
      subject: log.subject,
      html: log.renderedHtml,
    });
  }
}
