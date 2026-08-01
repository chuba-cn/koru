import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from '../auth/roles.guard';
import { STAFF_ROLES_KEY } from '../auth/staff-roles.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { EmailLogController } from './email-log.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

// Admin-tier only, per ADR-0013's default — recorder has no visibility into
// delivery/failure state for emails it doesn't own.
const ADMIN_TIER_ROLES = ['super_admin', 'regional_admin', 'branch_admin', 'finance'] as const;

describe('EmailLogController wiring', () => {
  const reflector = new Reflector();

  it('is tenant-scoped and role-gated at the class level, admin-tier only', () => {
    expect(guardsOf(EmailLogController)).toEqual([TenantGuard, RolesGuard]);
    expect(reflector.get(STAFF_ROLES_KEY, EmailLogController)).toEqual(ADMIN_TIER_ROLES);
  });

  it.each([
    'list',
    'resend',
  ] as const)('%s inherits the class-level guards with no additional method-level restriction', (method) => {
    expect(guardsOf(EmailLogController.prototype[method])).toEqual([]);
    expect(reflector.get(STAFF_ROLES_KEY, EmailLogController.prototype[method])).toBeUndefined();
  });
});
