import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';

/**
 * Gates any route that must not run for a login without a verified phone —
 * currently just /join/:churchId, since joining is what a verified phone earns.
 *
 * Requires: AuthGuard has already run (i.e. request.session has been populated)
 */
@Injectable()
export class VerifiedPhoneGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const session = req.session;
    if (!session?.user?.id)
      throw new InternalServerErrorException('VerifiedPhoneGuard ran without a session');

    if (!session.user.phoneNumberVerified)
      throw new ForbiddenException('A verified phone number is required to join a church');

    return true;
  }
}
