import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RECLAIM_GRACE_MS, StaffService } from './staff.service';

const CHURCH = 'church-1';
const STAFF = { id: 'staff-1', churchId: CHURCH, email: 'ada@example.test', userId: null };
const SQUATTER = { id: 'user-1', createdAt: new Date(Date.now() - RECLAIM_GRACE_MS - 1000) };

function build(overrides: {
  staff?: Record<string, unknown> | null;
  user?: { id: string; createdAt: Date } | null;
  ownedByStaff?: boolean;
  ownedByMember?: boolean;
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
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'new-staff', userId: null, ...data }),
      ),
    },
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

  const invites = { issue: vi.fn(() => Promise.resolve({ token: 'new', expiresAt: new Date() })) };

  const scopeService = {
    scopeCovers: vi.fn(() => Promise.resolve(true)),
    branchInRegion: vi.fn(() => Promise.resolve(true)),
  };

  return {
    service: new StaffService(
      prisma as never,
      invites as never,
      authUsers as never,
      scopeService as never,
    ),
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
