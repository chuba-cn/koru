import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcceptInviteService, EMAIL_TAKEN_MESSAGE } from './accept-invite.service';

const { signUpEmail } = vi.hoisted(() => ({ signUpEmail: vi.fn() }));

vi.mock('../auth/auth', () => ({ auth: { api: { signUpEmail } } }));

const STAFF: { id: string; userId: string | null; fullName: string; email: string } = {
  id: 'staff-1',
  userId: null,
  fullName: 'Ada Lovelace',
  email: 'ada@example.test',
};
const INVITE = { id: 'invite-1', staff: STAFF };
const USER = { id: 'user-1' };

function okResponse() {
  return {
    ok: true,
    headers: { getSetCookie: () => [] },
    json: () => Promise.resolve({ user: USER }),
  };
}

function failedResponse(status: number, detail: string) {
  return { ok: false, status, text: () => Promise.resolve(detail) };
}

function build(
  overrides: {
    staff?: Partial<typeof STAFF>;
    existingLogin?: unknown;
    postSignupUser?: unknown;
  } = {},
) {
  const staff = { ...STAFF, ...overrides.staff };
  const invite = { ...INVITE, staff };

  const invites = {
    peek: vi.fn(() => Promise.resolve(invite)),
    claim: vi.fn(() => Promise.resolve(invite)),
    release: vi.fn(() => Promise.resolve()),
  };

  const findByEmail = vi.fn();
  findByEmail.mockResolvedValueOnce(overrides.existingLogin ?? null);
  findByEmail.mockResolvedValue('postSignupUser' in overrides ? overrides.postSignupUser : USER);
  const authUsers = { findByEmail };

  const prisma = {
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    staff: { update: vi.fn(() => Promise.resolve({ ...staff, userId: USER.id })) },
    staffInvite: { update: vi.fn(() => Promise.resolve(invite)) },
  };

  const service = new AcceptInviteService(prisma as never, invites as never, authUsers as never);

  return { service, invites, authUsers, prisma };
}

describe('AcceptInviteService.accept', () => {
  it('rejects a staff member who already has a login, before touching Better Auth', async () => {
    const { service } = build({ staff: { userId: 'already-linked' } });

    await expect(service.accept({ token: 'raw', password: 'secret123' })).rejects.toThrow(
      ConflictException,
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('rejects when the staff email already has a login elsewhere, which is the squatting guard', async () => {
    const { service, invites } = build({ existingLogin: { id: 'squatter' } });

    await expect(service.accept({ token: 'raw', password: 'secret123' })).rejects.toThrow(
      EMAIL_TAKEN_MESSAGE,
    );
    expect(invites.claim).not.toHaveBeenCalled();
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('provisions the login and links the staff row on success', async () => {
    const { service, prisma } = build();
    signUpEmail.mockResolvedValue(okResponse());

    const result = await service.accept({ token: 'raw', password: 'secret123' });

    expect(result.staff.status).toBe('active');
    expect(result.staff.emailVerificationRequired).toBe(true);
    expect(result.cookies).toEqual([]);
    expect(prisma.staff.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: STAFF.id }, data: { userId: USER.id } }),
    );
    expect(prisma.staffInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { provisionedUserId: USER.id } }),
    );
  });

  it('never returns the password hash on the linked staff record', async () => {
    const { service, prisma } = build();
    signUpEmail.mockResolvedValue(okResponse());

    await service.accept({ token: 'raw', password: 'secret123' });

    expect(prisma.staff.update).toHaveBeenCalledWith(
      expect.objectContaining({ omit: { passwordHash: true } }),
    );
  });

  it('links the staff row and the invite in the same transaction', async () => {
    const { service, prisma } = build();
    signUpEmail.mockResolvedValue(okResponse());

    await service.accept({ token: 'raw', password: 'secret123' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('releases the invite and reports a retryable failure when Better Auth rejects for an unrelated reason', async () => {
    const { service, invites } = build();
    signUpEmail.mockResolvedValue(failedResponse(500, 'internal error'));

    await expect(service.accept({ token: 'raw', password: 'secret123' })).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(invites.release).toHaveBeenCalledWith(INVITE.id);
  });

  it('does not release the invite when Better Auth rejects because the email is now taken', async () => {
    const { service, invites } = build();
    signUpEmail.mockResolvedValue(failedResponse(422, 'email already exists'));

    await expect(service.accept({ token: 'raw', password: 'secret123' })).rejects.toThrow(
      EMAIL_TAKEN_MESSAGE,
    );
    expect(invites.release).not.toHaveBeenCalled();
  });

  it('rejects a raced duplicate — signUpEmail can return 200 with a synthetic, unpersisted user once requireEmailVerification is on', async () => {
    const { service, prisma } = build({ postSignupUser: { id: 'someone-elses-real-user-id' } });
    signUpEmail.mockResolvedValue({
      ok: true,
      headers: { getSetCookie: () => [] },
      json: () => Promise.resolve({ user: { id: 'synthetic-fabricated-id' } }),
    });

    await expect(service.accept({ token: 'raw', password: 'secret123' })).rejects.toThrow(
      EMAIL_TAKEN_MESSAGE,
    );
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });
});
