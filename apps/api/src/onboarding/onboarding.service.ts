import { renderWelcomeEmail } from '@koru/emails';
import type { BootstrapChurchInput } from '@koru/shared';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { LOGO_URL, SUPPORT_EMAIL, SUPPORT_PHONE } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { MailService } from '../notifications/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export type User = UserSession<typeof auth>['user'];

const ALREADY_ADMINISTERS = 'This account already administers a church';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async bootstrapChurch(user: User, input: BootstrapChurchInput) {
    const existing = await this.prisma.staff.findUnique({ where: { userId: user.id } });
    if (existing) {
      throw new ConflictException(ALREADY_ADMINISTERS);
    }

    let church: Prisma.ChurchGetPayload<{
      include: { staff: { select: { id: true; role: true; userId: true } } };
    }>;

    try {
      church = await this.prisma.church.create({
        data: {
          name: input.churchName,
          timezone: input.timezone ?? undefined,
          staff: {
            create: {
              fullName: input.fullName,
              email: user.email,
              role: 'super_admin',
              userId: user.id,
            },
          },
        },
        include: { staff: { select: { id: true, role: true, userId: true } } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(ALREADY_ADMINISTERS);
      }
      throw e;
    }

    try {
      await this.mail.send({
        churchId: church.id,
        category: 'church_welcome',
        to: user.email,
        recipientStaffId: church.staff[0]?.id,
        subject: `Welcome to Koru, ${input.churchName}!`,
        html: await renderWelcomeEmail(input.churchName, {
          logoUrl: LOGO_URL,
          supportEmail: SUPPORT_EMAIL,
          supportPhone: SUPPORT_PHONE,
        }),
      });
    } catch (error: unknown) {
      this.logger.error(`Could not queue welcome email for church ${church.id}: ${error}`);
    }

    return church;
  }
}
