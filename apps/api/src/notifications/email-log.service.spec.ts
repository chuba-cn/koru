import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TenantStaff } from '../auth/tenant.guard';
import { EmailLogService } from './email-log.service';

type FakeLog = {
  id: string;
  churchId: string;
  category: string;
  recipientEmail: string;
  recipientStaffId: string | null;
  recipientMemberId: string | null;
  subject: string;
  status: string;
  renderedHtml: string;
  failureReason: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
};

const CHURCH = 'church-1';
const CHURCH_WIDE_LOG: FakeLog = {
  id: 'log-1',
  churchId: CHURCH,
  category: 'church_welcome',
  recipientEmail: 'a@example.test',
  recipientStaffId: null,
  recipientMemberId: null,
  subject: 'Welcome',
  status: 'delivered',
  renderedHtml: '<p>Welcome</p>',
  failureReason: null,
  sentAt: null,
  deliveredAt: null,
  createdAt: new Date(),
};
const IN_SCOPE_LOG: FakeLog = {
  ...CHURCH_WIDE_LOG,
  id: 'log-2',
  recipientStaffId: 'staff-in-scope',
  status: 'failed',
};
function fakePrisma(rows: FakeLog[] = [CHURCH_WIDE_LOG]) {
  return {
    emailLog: {
      findFirst: vi.fn(({ where }: { where: { AND?: unknown[]; id?: string } }) => {
        const id =
          where.id ??
          (where.AND?.find((c) => (c as { id?: string }).id) as { id: string } | undefined)?.id;
        return Promise.resolve(rows.find((r) => r.id === id) ?? null);
      }),
      count: vi.fn(() => Promise.resolve(rows.length)),
      findMany: vi.fn(() => Promise.resolve(rows)),
    },
  };
}

function fakeScopeService(branchIds: string[] = []) {
  return { coveredBranchIds: vi.fn(() => Promise.resolve(branchIds)) };
}

function fakeMail() {
  return { send: vi.fn(() => Promise.resolve({ id: 'new-log' })) };
}

function callerWith(role: TenantStaff['role'], scopes: TenantStaff['scopes'] = []): TenantStaff {
  return { id: 'caller-1', churchId: CHURCH, role, scopes };
}

const QUERY = { limit: 50, direction: 'forward' as const };

describe('EmailLogService.list', () => {
  it('scopes a super_admin to the whole church, no OR clause', async () => {
    const prisma = fakePrisma();
    const service = new EmailLogService(
      prisma as never,
      fakeScopeService() as never,
      fakeMail() as never,
    );

    await service.list(CHURCH, callerWith('super_admin'), QUERY);

    expect(prisma.emailLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { churchId: CHURCH } }),
    );
  });

  it('scopes a delegated caller to church-wide rows plus their covered branch scope', async () => {
    const prisma = fakePrisma();
    const scope = fakeScopeService(['branch-1']);
    const service = new EmailLogService(prisma as never, scope as never, fakeMail() as never);
    const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: 'branch-1' }]);

    await service.list(CHURCH, caller, QUERY);

    expect(scope.coveredBranchIds).toHaveBeenCalledWith(CHURCH, caller);
    expect(prisma.emailLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          churchId: CHURCH,
          OR: [
            { recipientStaffId: null, recipientMemberId: null },
            {
              staff: {
                scopes: { some: { scopeType: 'branch', scopeRefId: { in: ['branch-1'] } } },
              },
            },
            { member: { homeBranchId: { in: ['branch-1'] } } },
          ],
        },
      }),
    );
  });
});

describe('EmailLogService.resend', () => {
  it('resends a failed log verbatim, through MailService, using the stored renderedHtml', async () => {
    const prisma = fakePrisma([IN_SCOPE_LOG]);
    const scope = fakeScopeService(['staff-in-scope']);
    const mail = fakeMail();
    const service = new EmailLogService(prisma as never, scope as never, mail as never);

    await service.resend(CHURCH, IN_SCOPE_LOG.id, callerWith('super_admin'));

    expect(mail.send).toHaveBeenCalledWith({
      churchId: CHURCH,
      category: IN_SCOPE_LOG.category,
      to: IN_SCOPE_LOG.recipientEmail,
      recipientStaffId: IN_SCOPE_LOG.recipientStaffId,
      recipientMemberId: undefined,
      subject: IN_SCOPE_LOG.subject,
      html: IN_SCOPE_LOG.renderedHtml,
    });
  });

  it('404s on a log outside the church, rather than leaking its existence', async () => {
    const prisma = fakePrisma([]);
    const service = new EmailLogService(
      prisma as never,
      fakeScopeService() as never,
      fakeMail() as never,
    );

    await expect(service.resend(CHURCH, 'no-such-log', callerWith('super_admin'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s on a log that is not in a resendable status', async () => {
    const prisma = fakePrisma([CHURCH_WIDE_LOG]);
    const service = new EmailLogService(
      prisma as never,
      fakeScopeService() as never,
      fakeMail() as never,
    );

    await expect(
      service.resend(CHURCH, CHURCH_WIDE_LOG.id, callerWith('super_admin')),
    ).rejects.toThrow(ConflictException);
  });

  it.each(['failed', 'bounced', 'complained'])('allows resend from status %s', async (status) => {
    const log = { ...CHURCH_WIDE_LOG, status };
    const prisma = fakePrisma([log]);
    const mail = fakeMail();
    const service = new EmailLogService(
      prisma as never,
      fakeScopeService() as never,
      mail as never,
    );

    await service.resend(CHURCH, log.id, callerWith('super_admin'));

    expect(mail.send).toHaveBeenCalled();
  });
});
