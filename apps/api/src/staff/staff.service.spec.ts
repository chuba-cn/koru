import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RECLAIM_GRACE_MS, StaffService } from './staff.service';

const CHURCH = 'church-1';
const STAFF = {
  id: 'staff-1',
  churchId: CHURCH,
  email: 'ada@example.test',
  userId: null,
  role: 'finance',
  scopes: [],
};
const SQUATTER = { id: 'user-1', createdAt: new Date(Date.now() - RECLAIM_GRACE_MS - 1000) };

function build(overrides: {
  staff?: Record<string, unknown> | null;
  allStaff?: Record<string, unknown>[];
  user?: { id: string; createdAt: Date } | null;
  ownedByStaff?: boolean;
  ownedByMember?: boolean;
  superAdminIds?: string[];
}) {
  const prisma = {
    church: {
      findUnique: vi.fn(() => Promise.resolve({ id: CHURCH })),
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
      findFirst: vi.fn(({ where }: { where: { id?: string; userId?: string } }) => {
        if (where.userId) return Promise.resolve(overrides.ownedByStaff ? { id: 'other' } : null);
        return Promise.resolve(overrides.staff === undefined ? STAFF : overrides.staff);
      }),
      findMany: vi.fn(() => Promise.resolve(overrides.allStaff ?? [])),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'new-staff', userId: null, ...data }),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...STAFF, ...data }),
      ),
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
      Promise.resolve(overrides.user === undefined ? SQUATTER : overrides.user),
    ),
    delete: vi.fn(() => Promise.resolve()),
  };

  const invites = {
    issue: vi.fn(() => Promise.resolve({ token: 'new', expiresAt: new Date() })),
    revokeAllFor: vi.fn(() => Promise.resolve()),
  };

  const scopeService = {
    scopeCovers: vi.fn(
      (_caller: unknown, _scope: { scopeRefId: string }): Promise<boolean> => Promise.resolve(true),
    ),
    branchInRegion: vi.fn(() => Promise.resolve(true)),
  };

  return {
    service: new StaffService(
      prisma as never,
      invites as never,
      authUsers as never,
      scopeService as never,
    ),
    prisma,
    authUsers,
    invites,
    scopeService,
  };
}

describe('StaffService.reclaimLogin', () => {
  it('deletes the squatting login and issues a fresh invite', async () => {
    const { service, authUsers, invites } = build({});

    await service.reclaimLogin(CHURCH, STAFF.id);

    expect(authUsers.delete).toHaveBeenCalledWith(SQUATTER.id);
    expect(invites.issue).toHaveBeenCalledWith(STAFF.id);
  });

  it('refuses when the staff member has already accepted', async () => {
    const { service, authUsers } = build({ staff: { ...STAFF, userId: 'already-linked' } });

    await expect(service.reclaimLogin(CHURCH, STAFF.id)).rejects.toThrow(ConflictException);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('404s when no login holds the address', async () => {
    const { service, authUsers } = build({ user: null });

    await expect(service.reclaimLogin(CHURCH, STAFF.id)).rejects.toThrow(NotFoundException);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('refuses when the login owns a staff record', async () => {
    const { service, authUsers } = build({ ownedByStaff: true });

    await expect(service.reclaimLogin(CHURCH, STAFF.id)).rejects.toThrow(/existing person/);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('refuses when the login owns a member record', async () => {
    const { service, authUsers } = build({ ownedByMember: true });

    await expect(service.reclaimLogin(CHURCH, STAFF.id)).rejects.toThrow(/existing person/);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('refuses a login created inside the grace period', async () => {
    const now = new Date();
    const { service, authUsers } = build({
      user: { id: 'user-1', createdAt: new Date(now.getTime() - RECLAIM_GRACE_MS + 1000) },
    });

    await expect(service.reclaimLogin(CHURCH, STAFF.id, now)).rejects.toThrow(/very recently/);
    expect(authUsers.delete).not.toHaveBeenCalled();
  });

  it('allows a login that is exactly at the grace boundary', async () => {
    const now = new Date();
    const { service, authUsers } = build({
      user: { id: 'user-1', createdAt: new Date(now.getTime() - RECLAIM_GRACE_MS) },
    });

    await service.reclaimLogin(CHURCH, STAFF.id, now);

    expect(authUsers.delete).toHaveBeenCalled();
  });

  it('404s when the staff member is not in this church', async () => {
    const { service, authUsers } = build({ staff: null });

    await expect(service.reclaimLogin('another-church', STAFF.id)).rejects.toThrow(
      NotFoundException,
    );
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
