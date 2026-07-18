import type { AcceptInviteInput } from '@koru/shared';
import { ConflictException, Injectable } from '@nestjs/common';
import { auth } from '../auth/auth';
import { PrismaService } from '../prisma/prisma.service';
import { StaffInviteService } from './staff-invite.service';

@Injectable()
export class AcceptInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: StaffInviteService,
  ) {}

  async accept(input: AcceptInviteInput) {
    const invite = await this.invites.consume(input.token);
    const { staff } = invite;

    if (staff.userId) throw new ConflictException('This staff member already has a login');

    const response = await auth.api.signUpEmail({
      body: { name: staff.fullName, email: staff.email, password: input.password },
      asResponse: true,
    });

    if (!response.ok)
      throw new ConflictException('Could not create a login for this email address');

    const { user } = (await response.json()) as { user: { id: string } };

    const linked = await this.prisma.staff.update({
      where: { id: staff.id },
      data: { userId: user.id },
      omit: { passwordHash: true },
      include: { scopes: { select: { id: true, scopeType: true, scopeRefId: true } } },
    });

    await this.invites.markAccepted(invite.id);

    return {
      staff: { ...linked, status: 'active' as const },
      cookies: response.headers.getSetCookie(),
    };
  }
}
