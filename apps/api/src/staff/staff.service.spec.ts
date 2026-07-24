import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { StaffService } from './staff.service';

const CHURCH = 'church-1';
const STAFF = {
  id: 'staff-1',
  churchId: CHURCH,
  email: 'ada@example.test',
  userId: null,
  role: 'finance',
  scopes: [],
};
const UNVERIFIED_LOGIN = { id: 'user-1', emailVerified: false };
const VERIFIED_LOGIN = { id: 'user-2', emailVerified: true };

const duplicateKeyError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });

function build(overrides: {
  staff?: Record<string, unknown> | null;
  allStaff?: Record<string, unknown>[];
  user?: { id: string; emailVerified: boolean } | null;
  ownedByStaff?: boolean;
  ownedByMember?: boolean;
  /** Owns nothing on the pre-delete check, but has acquired a staff row by the after-delete re-check. */
  acquiresStaffWhileClearing?: boolean;
  superAdminIds?: string[];
  mailSendThrows?: boolean;
  staffUpdateThrowsP2002?: boolean;
  churchName?: string;
}) {
  const prisma = {
    church: {
      findUnique: vi.fn(() =>
        Promise.resolve({ id: CHURCH, name: overrides.churchName ?? 'Celebration Church' }),
      ),
    },
    region: {
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
      ),
    },
    branch: {
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
      ),
    },
    staff: {
      findFirst: vi.fn(
        (() => {
          let ownsNothingCalls = 0;
          return ({ where }: { where: { id?: string; userId?: string } }) => {
            if (where.userId) {
              if (overrides.acquiresStaffWhileClearing) {
                ownsNothingCalls += 1;
                return Promise.resolve(ownsNothingCalls > 1 ? { id: 'acquired-after' } : null);
              }
              return Promise.resolve(overrides.ownedByStaff ? { id: 'other' } : null);
            }
            return Promise.resolve(overrides.staff === undefined ? STAFF : overrides.staff);
          };
        })(),
      ),
      findMany: vi.fn(() => Promise.resolve(overrides.allStaff ?? [])),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'new-staff', userId: null, ...data }),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        if (overrides.staffUpdateThrowsP2002) throw duplicateKeyError();
        return Promise.resolve({ ...STAFF, ...data });
      }),
      delete: vi.fn(() => Promise.resolve()),
    },
    $queryRaw: vi.fn(() =>
      Promise.resolve((overrides.superAdminIds ?? ['staff-1']).map((id) => ({ id }))),
    ),
    $transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    member: {
      findFirst: vi.fn(() => Promise.resolve(overrides.ownedByMember ? { id: 'member' } : null)),
    },
  };

  const authUsers = {
    findByEmail: vi.fn(() =>
      Promise.resolve(overrides.user === undefined ? UNVERIFIED_LOGIN : overrides.user),
    ),
    delete: vi.fn(() => Promise.resolve()),
  };

  const invites = {
    issue: vi.fn(() => Promise.resolve({ token: 'new-token', expiresAt: new Date() })),
    revokeAllFor: vi.fn(() => Promise.resolve()),
  };

  const scopeService = {
    scopeCovers: vi.fn(
      (_caller: unknown, _scope: { scopeRefId: string }): Promise<boolean> => Promise.resolve(true),
    ),
    branchInRegion: vi.fn(() => Promise.resolve(true)),
  };

  const mail = {
    send: vi.fn(() =>
      overrides.mailSendThrows
        ? Promise.reject(new Error('mail provider unreachable'))
        : Promise.resolve({ id: 'log-1' }),
    ),
  };

  return {
    service: new StaffService(
      prisma as never,
      invites as never,
      authUsers as never,
      scopeService as never,
      mail as never,
    ),
    prisma,
    authUsers,
    invites,
    scopeService,
    mail,
  };
}

describe('StaffService — invite email delivery (#61)', () => {
  it('create() sends an invite email containing the raw token, alongside returning it', async () => {
    const { service, mail } = build({});

    const result = await service.create(
      CHURCH,
      { fullName: 'Ada', email: 'ada@example.test', role: 'finance' },
      { id: 'caller-1', churchId: CHURCH, role: 'super_admin', scopes: [] } as never,
    );

    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        churchId: CHURCH,
        category: 'staff_invite',
        to: 'ada@example.test',
        recipientStaffId: 'new-staff',
        html: expect.stringContaining('token=new-token'),
      }),
    );
    expect(result.invite.token).toBe('new-token');
  });

  /**
   * A church name is chosen by whoever self-serve-founds a church, with no
   * character restriction (CreateChurchSchema is a plain bounded string) — it
   * must never be trusted as HTML in an email every invitee's mail client
   * renders.
   */
  it('escapes the church name before interpolating it into the invite email', async () => {
    const { service, mail } = build({
      churchName: '<img src=x onerror=alert(1)><a href="https://evil.example">click</a>',
    });

    await service.create(CHURCH, { fullName: 'Ada', email: 'ada@example.test', role: 'finance' }, {
      id: 'caller-1',
      churchId: CHURCH,
      role: 'super_admin',
      scopes: [],
    } as never);

    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('&lt;img src=x onerror=alert(1)&gt;'),
      }),
    );
    expect(mail.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('<img') }),
    );
    expect(mail.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('<a href="https://evil.example">') }),
    );
  });

  it('create() still returns the token when the mail send fails', async () => {
    const { service } = build({ mailSendThrows: true });

    await expect(
      service.create(CHURCH, { fullName: 'Ada', email: 'ada@example.test', role: 'finance' }, {
        id: 'caller-1',
        churchId: CHURCH,
        role: 'super_admin',
        scopes: [],
      } as never),
    ).resolves.toEqual(
      expect.objectContaining({ invite: { token: 'new-token', expiresAt: expect.any(Date) } }),
    );
  });

  it('reissueInvite() sends an invite email for the fresh token', async () => {
    const { service, mail } = build({});
    const caller = { id: 'caller-1', churchId: CHURCH, role: 'super_admin', scopes: [] } as never;

    const invite = await service.reissueInvite(CHURCH, STAFF.id, caller);

    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: STAFF.email,
        recipientStaffId: STAFF.id,
        html: expect.stringContaining('token=new-token'),
      }),
    );
    expect(invite.token).toBe('new-token');
  });

  it('reissueInvite() still returns the token when the mail send fails', async () => {
    const { service } = build({ mailSendThrows: true });
    const caller = { id: 'caller-1', churchId: CHURCH, role: 'super_admin', scopes: [] } as never;

    await expect(service.reissueInvite(CHURCH, STAFF.id, caller)).resolves.toEqual({
      token: 'new-token',
      expiresAt: expect.any(Date),
    });
  });
});

describe('StaffService.linkLogin (#63)', () => {
  function superAdmin() {
    return { id: 'caller-1', churchId: CHURCH, role: 'super_admin', scopes: [] } as never;
  }

  it('links a verified login and revokes the outstanding invite', async () => {
    const { service, prisma, invites } = build({ user: VERIFIED_LOGIN });

    const result = await service.linkLogin(CHURCH, STAFF.id, { email: STAFF.email }, superAdmin());

    expect(prisma.staff.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: STAFF.id }, data: { userId: VERIFIED_LOGIN.id } }),
    );
    expect(invites.revokeAllFor).toHaveBeenCalledWith(STAFF.id);
    expect(result.status).toBe('active');
  });

  it('rejects when the staff member already has a login', async () => {
    const { service, prisma } = build({
      staff: { ...STAFF, userId: 'already-linked' },
      user: VERIFIED_LOGIN,
    });

    await expect(
      service.linkLogin(CHURCH, STAFF.id, { email: STAFF.email }, superAdmin()),
    ).rejects.toThrow(ConflictException);
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });

  it('rejects when the requested email does not match the staff record', async () => {
    const { service, prisma } = build({ user: VERIFIED_LOGIN });

    await expect(
      service.linkLogin(CHURCH, STAFF.id, { email: 'someone-else@example.test' }, superAdmin()),
    ).rejects.toThrow(/does not match/);
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });

  it('404s when no login exists for that email', async () => {
    const { service, prisma } = build({ user: null });

    await expect(
      service.linkLogin(CHURCH, STAFF.id, { email: STAFF.email }, superAdmin()),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });

  it('refuses to link an unverified login', async () => {
    const { service, prisma } = build({ user: UNVERIFIED_LOGIN });

    await expect(
      service.linkLogin(CHURCH, STAFF.id, { email: STAFF.email }, superAdmin()),
    ).rejects.toThrow(/has not verified/);
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });

  it('rejects when the login is already staff at another church', async () => {
    const { service, prisma } = build({ user: VERIFIED_LOGIN, ownedByStaff: true });

    await expect(
      service.linkLogin(CHURCH, STAFF.id, { email: STAFF.email }, superAdmin()),
    ).rejects.toThrow(/already staff/);
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });

  it('translates a concurrent-link race (P2002) into the same 409, not a 500', async () => {
    const { service } = build({ user: VERIFIED_LOGIN, staffUpdateThrowsP2002: true });

    await expect(
      service.linkLogin(CHURCH, STAFF.id, { email: STAFF.email }, superAdmin()),
    ).rejects.toThrow(/already staff/);
  });

  it('403s a delegated caller linking a staff member outside their scope', async () => {
    const { service, scopeService } = build({
      staff: { ...STAFF, scopes: [{ scopeType: 'branch', scopeRefId: 'someone-elses-branch' }] },
      user: VERIFIED_LOGIN,
    });
    scopeService.scopeCovers.mockResolvedValue(false);
    const caller = {
      id: 'caller-1',
      churchId: CHURCH,
      role: 'branch_admin',
      scopes: [{ scopeType: 'branch', scopeRefId: 'my-branch' }],
    } as never;

    await expect(
      service.linkLogin(CHURCH, STAFF.id, { email: STAFF.email }, caller),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('StaffService.clearLogin (#62)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes an unverified squatting login and issues a fresh invite', async () => {
    const { service, authUsers, mail } = build({ user: UNVERIFIED_LOGIN });

    const invite = await service.clearLogin(CHURCH, STAFF.id);

    expect(authUsers.delete).toHaveBeenCalledWith(UNVERIFIED_LOGIN.id);
    expect(invite.token).toBe('new-token');
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: STAFF.email,
        html: expect.stringContaining('token=new-token'),
      }),
    );
  });

  /**
   * The pre-delete check and the delete are not one transaction, and an
   * unverified login can still acquire a Staff row via the phone-OTP path in
   * that window (see the insight in staff.service.ts). This proves the
   * after-delete re-check is real code, not dead defensive scaffolding: it
   * still deletes (the delete already happened) but logs loudly rather than
   * silently swallowing a state the pre-check would have refused outright.
   */
  it('logs, but still completes, when the login acquires a staff row during the delete window', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, authUsers, invites } = build({
      user: UNVERIFIED_LOGIN,
      acquiresStaffWhileClearing: true,
    });

    await service.clearLogin(CHURCH, STAFF.id);

    expect(authUsers.delete).toHaveBeenCalledWith(UNVERIFIED_LOGIN.id);
    expect(invites.issue).toHaveBeenCalledWith(STAFF.id);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('while being cleared'));
  });

  it('refuses when the staff member has already accepted', async () => {
    const { service, authUsers } = build({ staff: { ...STAFF, userId: 'already-linked' } });

    await expect(service.clearLogin(CHURCH, STAFF.id)).rejects.toThrow(ConflictException);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('404s when no login holds the address', async () => {
    const { service, authUsers } = build({ user: null });

    await expect(service.clearLogin(CHURCH, STAFF.id)).rejects.toThrow(NotFoundException);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('refuses to clear a verified login — it belongs to a real person, link it instead', async () => {
    const { service, authUsers } = build({ user: VERIFIED_LOGIN });

    await expect(service.clearLogin(CHURCH, STAFF.id)).rejects.toThrow(/Link it/);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('refuses when the login owns a staff record', async () => {
    const { service, authUsers } = build({ ownedByStaff: true });

    await expect(service.clearLogin(CHURCH, STAFF.id)).rejects.toThrow(/existing person/);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('refuses when the login owns a member record', async () => {
    const { service, authUsers } = build({ ownedByMember: true });

    await expect(service.clearLogin(CHURCH, STAFF.id)).rejects.toThrow(/existing person/);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('404s when the staff member is not in this church', async () => {
    const { service, authUsers } = build({ staff: null });

    await expect(service.clearLogin('another-church', STAFF.id)).rejects.toThrow(NotFoundException);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });
});

describe('StaffService.create — delegated onboarding authorization', () => {
  const CHURCH = 'church-1';
  const REGION = 'region-1';
  const BRANCH = 'branch-1';

  function callerWith(role: string, scopes: { scopeType: string; scopeRefId: string }[] = []) {
    return { id: 'caller-1', churchId: CHURCH, role, scopes } as never;
  }

  it('lets a super_admin create any role with no scope restriction', async () => {
    const { service, scopeService } = build({});
    scopeService.scopeCovers.mockResolvedValue(false);

    await expect(
      service.create(
        CHURCH,
        { fullName: 'Ada', email: 'ada@example.test', role: 'branch_admin' },
        callerWith('super_admin'),
      ),
    ).resolves.toBeDefined();
  });

  it('rejects finance and recorder outright, even though RolesGuard already blocks them at the route', async () => {
    const { service } = build({});

    await expect(
      service.create(
        CHURCH,
        { fullName: 'Ada', email: 'ada@example.test', role: 'recorder' },
        callerWith('finance'),
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.create(
        CHURCH,
        { fullName: 'Ada', email: 'ada@example.test', role: 'recorder' },
        callerWith('recorder'),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a regional_admin trying to create a super_admin', async () => {
    const { service } = build({});

    await expect(
      service.create(
        CHURCH,
        {
          fullName: 'Ada',
          email: 'ada@example.test',
          role: 'super_admin',
          scopes: [{ scopeType: 'region', scopeRefId: REGION }],
        },
        callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([
    'regional_admin',
    'branch_admin',
    'finance',
    'recorder',
  ] as const)('lets a regional_admin create a %s scoped to their own region', async (role) => {
    const { service, scopeService } = build({});
    scopeService.scopeCovers.mockResolvedValue(true);

    await expect(
      service.create(
        CHURCH,
        {
          fullName: 'Ada',
          email: 'ada@example.test',
          role,
          scopes: [{ scopeType: 'region', scopeRefId: REGION }],
        },
        callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]),
      ),
    ).resolves.toBeDefined();
  });

  it('rejects a branch_admin trying to create a regional_admin or a super_admin', async () => {
    const { service } = build({});

    await expect(
      service.create(
        CHURCH,
        {
          fullName: 'Ada',
          email: 'ada@example.test',
          role: 'regional_admin',
          scopes: [{ scopeType: 'branch', scopeRefId: BRANCH }],
        },
        callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.create(
        CHURCH,
        {
          fullName: 'Ada',
          email: 'ada@example.test',
          role: 'super_admin',
          scopes: [{ scopeType: 'branch', scopeRefId: BRANCH }],
        },
        callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([
    'branch_admin',
    'finance',
    'recorder',
  ] as const)('lets a branch_admin create a %s scoped to their own branch', async (role) => {
    const { service, scopeService } = build({});
    scopeService.scopeCovers.mockResolvedValue(true);

    await expect(
      service.create(
        CHURCH,
        {
          fullName: 'Ada',
          email: 'ada@example.test',
          role,
          scopes: [{ scopeType: 'branch', scopeRefId: BRANCH }],
        },
        callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
      ),
    ).resolves.toBeDefined();
  });

  it('rejects a delegated admin creating staff with no scope at all', async () => {
    const { service } = build({});

    await expect(
      service.create(
        CHURCH,
        { fullName: 'Ada', email: 'ada@example.test', role: 'recorder' },
        callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * The one assertion that proves the delegated check actually calls ScopeService
   * rather than just trusting whatever scope the caller listed in the request.
   */
  it('rejects a scope ScopeService says the caller does not cover', async () => {
    const { service, scopeService } = build({});
    scopeService.scopeCovers.mockResolvedValue(false);

    await expect(
      service.create(
        CHURCH,
        {
          fullName: 'Ada',
          email: 'ada@example.test',
          role: 'recorder',
          scopes: [{ scopeType: 'branch', scopeRefId: 'someone-elses-branch' }],
        },
        callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(scopeService.scopeCovers).toHaveBeenCalledWith(
      [{ scopeType: 'region', scopeRefId: REGION }],
      { scopeType: 'branch', scopeRefId: 'someone-elses-branch' },
    );
  });

  it('rejects when only some of several scopes are covered', async () => {
    const { service, scopeService } = build({});
    scopeService.scopeCovers.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(
      service.create(
        CHURCH,
        {
          fullName: 'Ada',
          email: 'ada@example.test',
          role: 'recorder',
          scopes: [
            { scopeType: 'branch', scopeRefId: BRANCH },
            { scopeType: 'branch', scopeRefId: 'someone-elses-branch' },
          ],
        },
        callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('StaffService — managing existing staff (update/remove/scopes/invite lifecycle)', () => {
  const CHURCH = 'church-1';
  const REGION = 'region-1';
  const BRANCH = 'branch-1';

  function callerWith(role: string, scopes: { scopeType: string; scopeRefId: string }[] = []) {
    return { id: 'caller-1', churchId: CHURCH, role, scopes } as never;
  }

  function targetWith(
    role: string,
    scopes: { scopeType: string; scopeRefId: string }[] = [],
    id = 'target-1',
  ) {
    return {
      id,
      churchId: CHURCH,
      email: 'grace@example.test',
      userId: null,
      role,
      scopes,
    };
  }

  it('lets a super_admin manage any staff member regardless of scope', async () => {
    const { service, scopeService } = build({ staff: targetWith('regional_admin') });
    scopeService.scopeCovers.mockResolvedValue(false);

    await expect(
      service.update(CHURCH, 'target-1', { fullName: 'New Name' }, callerWith('super_admin')),
    ).resolves.toBeDefined();
    await expect(
      service.remove(CHURCH, 'target-1', callerWith('super_admin')),
    ).resolves.toBeUndefined();
  });

  it('lets a regional_admin manage a branch_admin within their own region', async () => {
    const { service } = build({
      staff: targetWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
    });
    const caller = callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]);

    await expect(
      service.update(CHURCH, 'target-1', { fullName: 'New Name' }, caller),
    ).resolves.toBeDefined();
  });

  it('403s a regional_admin trying to manage staff a peer region owns', async () => {
    const { service, scopeService } = build({
      staff: targetWith('recorder', [{ scopeType: 'region', scopeRefId: 'someone-elses-region' }]),
    });
    scopeService.scopeCovers.mockResolvedValue(false);
    const caller = callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]);

    await expect(service.update(CHURCH, 'target-1', { fullName: 'X' }, caller)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.remove(CHURCH, 'target-1', caller)).rejects.toThrow(ForbiddenException);
    await expect(service.reissueInvite(CHURCH, 'target-1', caller)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.revokeInvite(CHURCH, 'target-1', caller)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.replaceScopes(CHURCH, 'target-1', { scopes: [] }, caller)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('403s a branch_admin trying to manage a regional_admin or a super_admin, even within scope', async () => {
    const { service, scopeService } = build({
      staff: targetWith('regional_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
    });
    scopeService.scopeCovers.mockResolvedValue(true);
    const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

    await expect(service.update(CHURCH, 'target-1', { fullName: 'X' }, caller)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('403s managing a staff member who has no explicit scope, unless caller is super_admin', async () => {
    const { service } = build({ staff: targetWith('recorder', []) });
    const caller = callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]);

    await expect(service.remove(CHURCH, 'target-1', caller)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a branch_admin promoting a recorder they manage to regional_admin', async () => {
    const { service } = build({
      staff: targetWith('recorder', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
    });
    const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

    await expect(
      service.update(CHURCH, 'target-1', { role: 'regional_admin' }, caller),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a branch_admin promoting a recorder they manage to finance, still within their branch', async () => {
    const { service } = build({
      staff: targetWith('recorder', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
    });
    const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

    await expect(
      service.update(CHURCH, 'target-1', { role: 'finance' }, caller),
    ).resolves.toBeDefined();
  });

  it('rejects a delegated admin clearing all scopes off a staff member they manage', async () => {
    const { service } = build({
      staff: targetWith('recorder', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
    });
    const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

    await expect(service.replaceScopes(CHURCH, 'target-1', { scopes: [] }, caller)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a delegated admin reassigning a scope outside their own authority', async () => {
    const { service, scopeService } = build({
      staff: targetWith('recorder', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
    });
    scopeService.scopeCovers.mockImplementation(
      async (_caller: unknown, scope: { scopeRefId: string }) => scope.scopeRefId === BRANCH,
    );
    const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

    await expect(
      service.replaceScopes(
        CHURCH,
        'target-1',
        { scopes: [{ scopeType: 'branch', scopeRefId: 'someone-elses-branch' }] },
        caller,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lists only staff a delegated admin can manage, but everyone for super_admin', async () => {
    const inScope = targetWith(
      'recorder',
      [{ scopeType: 'region', scopeRefId: REGION }],
      'in-scope',
    );
    const outOfScope = targetWith(
      'recorder',
      [{ scopeType: 'region', scopeRefId: 'someone-elses-region' }],
      'out-of-scope',
    );
    const { service, scopeService } = build({ allStaff: [inScope, outOfScope] });
    scopeService.scopeCovers.mockImplementation(
      async (_caller: unknown, scope: { scopeRefId: string }) => scope.scopeRefId === REGION,
    );

    const asRegionalAdmin = await service.list(
      CHURCH,
      callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }]),
    );
    expect(asRegionalAdmin.map((s) => s.id)).toEqual(['in-scope']);

    const asSuperAdmin = await service.list(CHURCH, callerWith('super_admin'));
    expect(asSuperAdmin.map((s) => s.id)).toEqual(['in-scope', 'out-of-scope']);
  });

  it('rejects managing a staff member when only some of their several scopes are covered', async () => {
    const { service, scopeService } = build({
      staff: targetWith('recorder', [
        { scopeType: 'branch', scopeRefId: BRANCH },
        { scopeType: 'branch', scopeRefId: 'someone-elses-branch' },
      ]),
    });
    scopeService.scopeCovers.mockImplementation(
      async (_caller: unknown, scope: { scopeRefId: string }) => scope.scopeRefId === BRANCH,
    );
    const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]);

    await expect(service.remove(CHURCH, 'target-1', caller)).rejects.toThrow(ForbiddenException);
  });

  it('excludes a staff member with several scopes, only some covered, from list', async () => {
    const partiallyCovered = targetWith(
      'recorder',
      [
        { scopeType: 'branch', scopeRefId: BRANCH },
        { scopeType: 'branch', scopeRefId: 'someone-elses-branch' },
      ],
      'partial',
    );
    const { service, scopeService } = build({ allStaff: [partiallyCovered] });
    scopeService.scopeCovers.mockImplementation(
      async (_caller: unknown, scope: { scopeRefId: string }) => scope.scopeRefId === BRANCH,
    );

    const visible = await service.list(
      CHURCH,
      callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
    );
    expect(visible).toEqual([]);
  });

  it('rejects a caller with no scopes of their own trying to manage anyone', async () => {
    const { service, scopeService } = build({
      staff: targetWith('recorder', [{ scopeType: 'branch', scopeRefId: BRANCH }]),
    });
    scopeService.scopeCovers.mockResolvedValue(false);
    const caller = callerWith('branch_admin', []);

    await expect(service.update(CHURCH, 'target-1', { fullName: 'X' }, caller)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.remove(CHURCH, 'target-1', caller)).rejects.toThrow(ForbiddenException);
  });

  it('lets a regional_admin manage their own staff row, same as any other staff within scope', async () => {
    const { service } = build({
      staff: targetWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION }], 'self'),
    });
    const caller = {
      id: 'self',
      churchId: CHURCH,
      role: 'regional_admin',
      scopes: [{ scopeType: 'region', scopeRefId: REGION }],
    } as never;

    await expect(
      service.update(CHURCH, 'self', { fullName: 'New Name' }, caller),
    ).resolves.toBeDefined();
  });
});

describe('StaffService — last super_admin guard', () => {
  const CHURCH = 'church-1';

  function superAdminCaller() {
    return { id: 'caller-1', churchId: CHURCH, role: 'super_admin', scopes: [] } as never;
  }

  it('rejects deleting the last super_admin', async () => {
    const { service } = build({
      staff: { id: 'staff-1', churchId: CHURCH, role: 'super_admin', userId: 'user-1' },
      superAdminIds: ['staff-1'],
    });

    await expect(service.remove(CHURCH, 'staff-1', superAdminCaller())).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects demoting the last super_admin to any other role', async () => {
    const { service } = build({
      staff: { id: 'staff-1', churchId: CHURCH, role: 'super_admin', userId: 'user-1' },
      superAdminIds: ['staff-1'],
    });

    await expect(
      service.update(CHURCH, 'staff-1', { role: 'recorder' }, superAdminCaller()),
    ).rejects.toThrow(ConflictException);
  });

  it('allows deleting a super_admin when another remains', async () => {
    const { service } = build({
      staff: { id: 'staff-1', churchId: CHURCH, role: 'super_admin', userId: 'user-1' },
      superAdminIds: ['staff-1', 'staff-2'],
    });

    await expect(service.remove(CHURCH, 'staff-1', superAdminCaller())).resolves.toBeUndefined();
  });

  it('allows demoting a super_admin when another remains', async () => {
    const { service } = build({
      staff: { id: 'staff-1', churchId: CHURCH, role: 'super_admin', userId: 'user-1' },
      superAdminIds: ['staff-1', 'staff-2'],
    });

    await expect(
      service.update(CHURCH, 'staff-1', { role: 'recorder' }, superAdminCaller()),
    ).resolves.toBeDefined();
  });

  it('does not lock or query at all for a non-super_admin removal or update', async () => {
    const { service, prisma } = build({
      staff: { id: 'staff-1', churchId: CHURCH, role: 'finance', userId: 'user-1' },
    });

    await service.remove(CHURCH, 'staff-1', superAdminCaller());
    await service.update(CHURCH, 'staff-1', { role: 'recorder' }, superAdminCaller());

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('re-verifies against the locked read rather than trusting the caller-side role check', async () => {
    // Simulates the row having already been demoted by a concurrent transaction by the
    // time this one's lock clears — the locked query no longer lists it as a super_admin.
    const { service } = build({
      staff: { id: 'staff-1', churchId: CHURCH, role: 'super_admin', userId: 'user-1' },
      superAdminIds: [],
    });

    await expect(service.remove(CHURCH, 'staff-1', superAdminCaller())).resolves.toBeUndefined();
  });
});
