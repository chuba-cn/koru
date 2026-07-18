import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard';
import { STAFF_ROLES_KEY } from './staff-roles.decorator';

const handler = () => undefined;
class Controller {}

function contextWith(staff: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ staff }) }),
    getHandler: () => handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
}

/**
 * Honours the metadata key it is asked for, rather than answering every key
 * identically. A fake that ignores the key cannot tell our @StaffRoles from the
 * Better Auth library's own @Roles decorator — exactly the collision that
 * staff-roles.decorator.ts exists to avoid.
 */
function reflectorWith(roles: string[] | undefined) {
  const getAllAndOverride = vi.fn((key: string) => (key === STAFF_ROLES_KEY ? roles : undefined));
  return { reflector: { getAllAndOverride } as unknown as Reflector, getAllAndOverride };
}

describe('RolesGuard', () => {
  it('allows the request when no role is required', () => {
    const { reflector } = reflectorWith(undefined);
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(contextWith({ role: 'finance' }))).toBe(true);
  });

  it('allows the request when the role matches', () => {
    const { reflector } = reflectorWith(['super_admin']);
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(contextWith({ role: 'super_admin' }))).toBe(true);
  });

  it('rejects the request when the role does not match', () => {
    const { reflector } = reflectorWith(['super_admin']);
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(contextWith({ role: 'finance' }))).toThrow(ForbiddenException);
  });

  it('rejects the request when TenantGuard has not attached a staff record', () => {
    const { reflector } = reflectorWith(['super_admin']);
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(contextWith(undefined))).toThrow('Missing tenant context');
  });

  it('reads OUR staff-roles key, not some other decorator', () => {
    const { reflector, getAllAndOverride } = reflectorWith(['super_admin']);
    const guard = new RolesGuard(reflector);

    guard.canActivate(contextWith({ role: 'super_admin' }));

    expect(getAllAndOverride).toHaveBeenCalledWith(STAFF_ROLES_KEY, [handler, Controller]);
  });
});
