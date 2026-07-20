import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { RegionController } from './region.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

const ADMIN_ROLES = ['super_admin', 'regional_admin', 'branch_admin', 'finance'] as const;

describe('RegionController wiring', () => {
  const reflector = new Reflector();

  it('is tenant-scoped at the class level', () => {
    expect(guardsOf(RegionController)).toEqual([TenantGuard]);
  });

  it('leaves list open to any tenant-matched staff, including recorder', () => {
    expect(guardsOf(RegionController.prototype.list)).toEqual([]);
    expect(reflector.get(STAFF_ROLES_KEY, RegionController.prototype.list)).toBeUndefined();
  });

  it.each([
    'create',
    'update',
    'remove',
  ] as const)('restricts %s to the four admin-tier roles, excluding recorder', (method) => {
    expect(guardsOf(RegionController.prototype[method])).toEqual([RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, RegionController.prototype[method])).toEqual(ADMIN_ROLES);
  });
});
