import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from '../generated/prisma/client';
import { STAFF_ROLES_KEY } from './staff-roles.decorator';

/**
 * Reads the @StaffRoles(...) list off the handler/controller and compares to the Staff.role
 * that TenantGuard attached. If no @StaffRoles decorator is present, allows through.
 *
 * Requires: TenantGuard has already run (request.staff populated).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const staff = req.staff;

    if (!staff) throw new ForbiddenException('Missing tenant context');
    if (!required.includes(staff.role)) {
      throw new ForbiddenException(`Requires roles: ${required.join(' or ')}`);
    }

    return true;
  }
}
