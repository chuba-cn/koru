import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { RegionController } from './region.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('RegionController wiring', () => {
  const reflector = new Reflector();

  it('is tenant-scoped at the class level, with no role restriction', () => {
    expect(guardsOf(RegionController)).toEqual([TenantGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, RegionController)).toBeUndefined();
  });

  it.each([
    'create',
    'list',
    'update',
    'remove',
  ] as const)('carries no extra guard or role on %s, beyond the tenant guard every staff member gets', (method) => {
    expect(guardsOf(RegionController.prototype[method])).toEqual([]);
    expect(reflector.get(STAFF_ROLES_KEY, RegionController.prototype[method])).toBeUndefined();
  });
});
