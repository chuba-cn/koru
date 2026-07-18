import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { SettlementAccountController } from './settlement-account.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('SettlementAccountController wiring', () => {
  const reflector = new Reflector();

  /**
   * Bank details are the most sensitive data this API holds, so every route
   * here is locked to super_admin at the class level rather than left to
   * per-method decorators that a new endpoint could forget to add.
   */
  it('requires super_admin, tenant-matched, for the whole controller', () => {
    expect(guardsOf(SettlementAccountController)).toEqual([TenantGuard, RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, SettlementAccountController)).toEqual(['super_admin']);
  });

  it.each([
    'create',
    'list',
    'update',
  ] as const)('adds no conflicting guard or role on %s', (method) => {
    expect(guardsOf(SettlementAccountController.prototype[method])).toEqual([]);
    expect(
      reflector.get(STAFF_ROLES_KEY, SettlementAccountController.prototype[method]),
    ).toBeUndefined();
  });
});
