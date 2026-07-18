import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { ChurchController } from './church.controller';

/** NestJS stores @UseGuards under this internal key, on the class or the method. */
const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('ChurchController wiring', () => {
  const reflector = new Reflector();

  it('is tenant-scoped at the class level', () => {
    expect(guardsOf(ChurchController)).toEqual([TenantGuard]);
  });

  it('leaves findOne open to any staff member of the church', () => {
    expect(guardsOf(ChurchController.prototype.findOne)).toEqual([]);
    expect(reflector.get(STAFF_ROLES_KEY, ChurchController.prototype.findOne)).toBeUndefined();
  });

  it('restricts update to super_admin, on top of the class-level tenant guard', () => {
    expect(guardsOf(ChurchController.prototype.update)).toEqual([RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, ChurchController.prototype.update)).toEqual([
      'super_admin',
    ]);
  });
});
