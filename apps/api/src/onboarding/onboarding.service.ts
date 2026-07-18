import type { BootstrapChurchInput } from '@koru/shared';
import { ConflictException, Injectable } from '@nestjs/common';
import { UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type User = UserSession<typeof auth>['user'];

const ALREADY_ADMINISTERS = 'This account already administers a church';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrapChurch(user: User, input: BootstrapChurchInput) {
    const existing = await this.prisma.staff.findUnique({ where: { userId: user.id } });
    if (existing) {
      throw new ConflictException(ALREADY_ADMINISTERS);
    }

    try {
      return await this.prisma.church.create({
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
  }
}
