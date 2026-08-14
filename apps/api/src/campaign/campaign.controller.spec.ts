import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { CampaignController } from './campaign.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('CampaignController wiring', () => {
  const reflector = new Reflector();
  const FOUR_ROLES = ['super_admin', 'regional_admin', 'branch_admin', 'finance'];

  it('requires a tenant-matched session for the whole controller, with no class-level role gate', () => {
    expect(guardsOf(CampaignController)).toEqual([TenantGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, CampaignController)).toBeUndefined();
  });

  it.each([
    'create',
    'update',
  ] as const)('adds the four admin-tier roles and RolesGuard on %s', (method) => {
    expect(guardsOf(CampaignController.prototype[method])).toEqual([RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, CampaignController.prototype[method])).toEqual(
      FOUR_ROLES,
    );
  });

  it.each([
    'list',
    'findById',
  ] as const)('adds no method-level guard or role on %s, open to any tenant-matched staff role', (method) => {
    expect(guardsOf(CampaignController.prototype[method])).toEqual([]);
    expect(reflector.get(STAFF_ROLES_KEY, CampaignController.prototype[method])).toBeUndefined();
  });
});
