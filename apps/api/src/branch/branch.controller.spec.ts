import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { BranchController } from './branch.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('BranchController wiring', () => {
  const reflector = new Reflector();

  it('is tenant-scoped at the class level, with no role restriction', () => {
    expect(guardsOf(BranchController)).toEqual([TenantGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, BranchController)).toBeUndefined();
  });

  it.each([
    'create',
    'list',
    'update',
  ] as const)('carries no extra guard or role on %s, beyond the tenant guard every staff member gets', (method) => {
    expect(guardsOf(BranchController.prototype[method])).toEqual([]);
    expect(reflector.get(STAFF_ROLES_KEY, BranchController.prototype[method])).toBeUndefined();
  });
});
