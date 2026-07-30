import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { SettlementAccountController } from './settlement-account.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('SettlementAccountController wiring', () => {
  const reflector = new Reflector();

  // Class-level lock stays super_admin so a future route inherits it by
  // default. Widening is per-route and asserted below.
  it('requires super_admin, tenant-matched, for the whole controller', () => {
    expect(guardsOf(SettlementAccountController)).toEqual([TenantGuard, RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, SettlementAccountController)).toEqual(['super_admin']);
  });

  it.each([
    'create',
    'update',
  ] as const)('adds no conflicting guard or role on %s, so it stays super_admin-only', (method) => {
    expect(guardsOf(SettlementAccountController.prototype[method])).toEqual([]);
    expect(
      reflector.get(STAFF_ROLES_KEY, SettlementAccountController.prototype[method]),
    ).toBeUndefined();
  });

  it('widens list to the delegated roles, without adding a second guard', () => {
    expect(guardsOf(SettlementAccountController.prototype.list)).toEqual([]);
    expect(reflector.get(STAFF_ROLES_KEY, SettlementAccountController.prototype.list)).toEqual([
      'super_admin',
      'regional_admin',
      'branch_admin',
      'finance',
    ]);
  });
});
