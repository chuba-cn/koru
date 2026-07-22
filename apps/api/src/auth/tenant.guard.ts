import { ScopeInput } from '@koru/shared';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { StaffRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type TenantStaff = {
  id: string;
  churchId: string;
  role: StaffRole;
  scopes: ScopeInput[];
};

/**
 * This guard ensures the session's user has a Staff row whose churchId matches the :churchId path param.
 * It attaches the resolved Staff to request.staff so the StaffRoles guard (and handlers) can reuse it.
 *
 * Requires: AuthGuard has already run (i.e. request.session has been populated)
 * Applies to: any controller with "churchId in its path."
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const session = req.session;
    if (!session?.user?.id) {
      throw new InternalServerErrorException('TenantGuard ran without a session');
    }

    const churchId = req.params?.churchId;
    if (!churchId) return true;

    const staff = await this.prisma.staff.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        churchId: true,
        role: true,
        scopes: { select: { scopeType: true, scopeRefId: true } },
      },
    });

    if (!staff || staff.churchId !== churchId) {
      throw new ForbiddenException('You do not have access to this church');
    }

    req.staff = staff satisfies TenantStaff;
    return true;
  }
}
