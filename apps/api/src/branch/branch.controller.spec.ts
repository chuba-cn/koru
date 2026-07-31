import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { BranchController } from './branch.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

// list is open to any tenant staff (finance widened in for visibility, #85).
// Structural mutations — create, and update which can rename or move a branch —
// exclude finance: seeing the structure is a finance concern, editing it is not (#96).
const MUTATION_ROLES = ['super_admin', 'regional_admin', 'branch_admin'] as const;

describe('BranchController wiring', () => {
  const reflector = new Reflector();

  it('is tenant-scoped at the class level', () => {
    expect(guardsOf(BranchController)).toEqual([TenantGuard]);
  });

  it('leaves list open to any tenant-matched staff, including recorder', () => {
    expect(guardsOf(BranchController.prototype.list)).toEqual([]);
    expect(reflector.get(STAFF_ROLES_KEY, BranchController.prototype.list)).toBeUndefined();
  });

  it.each([
    'create',
    'update',
  ] as const)('restricts %s to the structural-admin roles, excluding finance and recorder', (method) => {
    expect(guardsOf(BranchController.prototype[method])).toEqual([RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, BranchController.prototype[method])).toEqual(
      MUTATION_ROLES,
    );
  });
});
