import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { RegionController } from './region.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

// list is open to any tenant staff (finance was widened in for visibility, #85).
// Every structural mutation — create, rename, delete — is restricted to the
// structural-admin roles, with finance deliberately excluded: seeing the org
// structure is a finance concern, editing it is not (#96).
const MUTATION_ROLES = ['super_admin', 'regional_admin', 'branch_admin'] as const;

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
  ] as const)('restricts %s to the structural-admin roles, excluding finance and recorder', (method) => {
    expect(guardsOf(RegionController.prototype[method])).toEqual([RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, RegionController.prototype[method])).toEqual(
      MUTATION_ROLES,
    );
  });
});
