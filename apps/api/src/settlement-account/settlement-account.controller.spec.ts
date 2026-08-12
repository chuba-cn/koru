import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { SettlementAccountController } from './settlement-account.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('SettlementAccountController wiring', () => {
  const reflector = new Reflector();
  const FOUR_ROLES = ['super_admin', 'regional_admin', 'branch_admin', 'finance'];

  it('requires the four admin-tier roles, tenant-matched, for the whole controller', () => {
    expect(guardsOf(SettlementAccountController)).toEqual([TenantGuard, RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, SettlementAccountController)).toEqual(FOUR_ROLES);
  });

  it.each([
    'create',
    'update',
    'list',
  ] as const)('adds no method-level guard or role on %s, deferring to the class decorator', (method) => {
    expect(guardsOf(SettlementAccountController.prototype[method])).toEqual([]);
    expect(
      reflector.get(STAFF_ROLES_KEY, SettlementAccountController.prototype[method]),
    ).toBeUndefined();
  });
});
