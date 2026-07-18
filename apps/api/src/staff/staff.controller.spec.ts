import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { AcceptInviteController } from './accept-invite.controller';
import { StaffController } from './staff.controller';

/** NestJS stores @UseGuards under this internal key. */
const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('StaffController wiring', () => {
  const reflector = new Reflector();

  /**
   * Asserted at the class, and by identity rather than by name, so this covers
   * three things at once: the guards are present, they are in the right order,
   * and they are attached where new routes will inherit them.
   */
  it('is protected by the tenant and role guards, at the class level', () => {
    expect(guardsOf(StaffController)).toEqual([TenantGuard, RolesGuard]);
  });

  it('requires super_admin for the whole controller', () => {
    expect(reflector.get(STAFF_ROLES_KEY, StaffController)).toEqual(['super_admin']);
  });
});

describe('AcceptInviteController wiring', () => {
  it('is deliberately public, because the invitee has no session', () => {
    expect(Reflect.getMetadata('PUBLIC', AcceptInviteController.prototype.accept)).toBe(true);
  });

  it('carries no tenant guard, which would be unsatisfiable without a session', () => {
    expect(guardsOf(AcceptInviteController)).toEqual([]);
  });
});
