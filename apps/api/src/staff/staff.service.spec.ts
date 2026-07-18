import { ConflictException, NotFoundException } from '@nestjs/common';
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
    staff: {
      findFirst: vi.fn(({ where }: { where: { id?: string; userId?: string } }) => {
        if (where.userId) return Promise.resolve(overrides.ownedByStaff ? { id: 'other' } : null);
        return Promise.resolve(overrides.staff === undefined ? STAFF : overrides.staff);
      }),
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

  return {
    service: new StaffService(prisma as never, invites as never, authUsers as never),
    authUsers,
    invites,
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
