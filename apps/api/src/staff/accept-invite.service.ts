import type { AcceptInviteInput } from '@koru/shared';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { auth } from '../auth/auth';
import { AuthUsersService } from '../auth/auth-users.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaffInviteService } from './staff-invite.service';

export const EMAIL_TAKEN_MESSAGE =
  'This email address already has a login. Ask an administrator to reclaim it before accepting.';

@Injectable()
export class AcceptInviteService {
  private readonly logger = new Logger(AcceptInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: StaffInviteService,
    private readonly authUsers: AuthUsersService,
  ) {}

  async accept(input: AcceptInviteInput) {
    const preflight = await this.invites.peek(input.token);

    if (preflight.staff.userId) {
      throw new ConflictException('This staff member already has a login');
    }

    if (await this.authUsers.findByEmail(preflight.staff.email)) {
      throw new ConflictException(EMAIL_TAKEN_MESSAGE);
    }

    const invite = await this.invites.claim(input.token);
    const staff = invite.staff;

    const response = await auth.api.signUpEmail({
      body: { name: staff.fullName, email: staff.email, password: input.password },
      asResponse: true,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '<unreadable>');
      this.logger.error(
        `Provisioning failed for invite ${invite.id} (status ${response.status}): ${detail}`,
      );

      const emailTaken = /exist|taken|unique/i.test(detail);

      if (!emailTaken) {
        await this.invites.release(invite.id);
        throw new InternalServerErrorException(
          'Could not create the login. The invite is still valid — please try again.',
        );
      }

      throw new ConflictException(EMAIL_TAKEN_MESSAGE);
    }

    const { user } = (await response.json()) as { user: { id: string } };

    const [linked] = await this.prisma.$transaction([
      this.prisma.staff.update({
        where: { id: staff.id },
        data: { userId: user.id },
        omit: { passwordHash: true },
        include: { scopes: { select: { id: true, scopeType: true, scopeRefId: true } } },
      }),
      this.prisma.staffInvite.update({
        where: { id: invite.id },
        data: { provisionedUserId: user.id },
      }),
    ]);

    return {
      staff: { ...linked, status: 'active' as const },
      cookies: response.headers.getSetCookie(),
    };
  }
}
