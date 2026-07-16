import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '../generated/prisma/client';

export const STAFF_ROLES_KEY = 'KORU_STAFF_ROLES';

/**
 * Restrict a route to specific KORU StaffRole(s).
 * No decorator = any authenticated tenant-matched user may proceed.
 *
 * Named @StaffRoles (not @Roles) to avoid shadowing the library's own
 * @Roles decorator, which targets Better Auth's admin-plugin user.role.
 */
export const StaffRoles = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES_KEY, roles);
