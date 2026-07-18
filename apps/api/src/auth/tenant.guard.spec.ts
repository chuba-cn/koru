import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { TenantGuard } from './tenant.guard';

const OWN_CHURCH = 'church-own';
const OTHER_CHURCH = 'church-other';
const USER_ID = 'user-1';

type Request = { session?: unknown; params?: Record<string, string>; staff?: unknown };

function contextWith(req: Request) {
  return {
    context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext,
    req,
  };
}

function signedIn(params: Record<string, string>): Request {
  return { session: { user: { id: USER_ID } }, params };
}

/**
 * Honours the userId it is asked for. A fake that returns the same staff row for
 * every lookup would still pass while the guard queried some other user's
 * membership, which is the whole thing this guard exists to prevent.
 */
function prismaWith(rows: Record<string, { id: string; churchId: string; role: string }>) {
  const findUnique = vi.fn(async ({ where }: { where: { userId: string } }) => {
    return rows[where.userId] ?? null;
  });
  return {
    prisma: { staff: { findUnique } } as unknown as PrismaService,
    findUnique,
  };
}

const membership = {
  [USER_ID]: { id: 'staff-1', churchId: OWN_CHURCH, role: 'finance' },
  'someone-else': { id: 'staff-2', churchId: OTHER_CHURCH, role: 'finance' },
};

describe('TenantGuard', () => {
  it('allows a staff member into their own church', async () => {
    const { prisma } = prismaWith(membership);
    const { context } = contextWith(signedIn({ churchId: OWN_CHURCH }));

    await expect(new TenantGuard(prisma).canActivate(context)).resolves.toBe(true);
  });

  it('rejects a staff member reaching into another church, which is ADR-0011', async () => {
    const { prisma } = prismaWith(membership);
    const { context, req } = contextWith(signedIn({ churchId: OTHER_CHURCH }));

    await expect(new TenantGuard(prisma).canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(req.staff).toBeUndefined();
  });

  it('rejects a signed-in user who is not staff anywhere', async () => {
    const { prisma } = prismaWith({});
    const { context, req } = contextWith(signedIn({ churchId: OWN_CHURCH }));

    await expect(new TenantGuard(prisma).canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(req.staff).toBeUndefined();
  });

  it('resolves membership from the session, so naming another user grants nothing', async () => {
    const { prisma } = prismaWith(membership);
    const { context } = contextWith(signedIn({ churchId: OTHER_CHURCH, userId: 'someone-else' }));

    await expect(new TenantGuard(prisma).canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('attaches the resolved staff so RolesGuard can read the role', async () => {
    const { prisma } = prismaWith(membership);
    const { context, req } = contextWith(signedIn({ churchId: OWN_CHURCH }));

    await new TenantGuard(prisma).canActivate(context);

    expect(req.staff).toEqual({ id: 'staff-1', churchId: OWN_CHURCH, role: 'finance' });
  });

  it('leaves staff unattached on a route with no churchId', async () => {
    const { prisma, findUnique } = prismaWith(membership);
    const { context, req } = contextWith(signedIn({}));

    await expect(new TenantGuard(prisma).canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect(req.staff).toBeUndefined();
  });

  /**
   * A missing session here means AuthGuard did not run, which is a wiring bug
   * rather than a rejected caller. Answering 403 would hide it.
   */
  it('fails loudly when AuthGuard has not populated a session', async () => {
    const { prisma } = prismaWith(membership);
    const { context } = contextWith({ params: { churchId: OWN_CHURCH } });

    await expect(new TenantGuard(prisma).canActivate(context)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('fails loudly when the session carries no user id', async () => {
    const { prisma } = prismaWith(membership);
    const { context } = contextWith({ session: {}, params: { churchId: OWN_CHURCH } });

    await expect(new TenantGuard(prisma).canActivate(context)).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});
