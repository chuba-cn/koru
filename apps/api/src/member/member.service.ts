import type { JoinMemberInput } from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** userId is delibrately removed from every response */
const MEMBER_SELECT = {
  id: true,
  churchId: true,
  fullName: true,
  phone: true,
  email: true,
  homeBranchId: true,
  createdAt: true,
} satisfies Prisma.MemberSelect;

@Injectable()
export class MemberService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);
  }

  async listBranches(churchId: string) {
    await this.assertChurchExists(churchId);
    return this.prisma.branch.findMany({
      where: { churchId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async myProfile(userId: string, name: string, phoneNumber: string | null) {
    const memberships = await this.prisma.member.findMany({
      where: { userId },
      select: MEMBER_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    return { name, phoneNumber, memberships };
  }

  /**
   * Idempotent: a second call for the same (churchId, phone) updates rather than
   * duplicates. Phone numbers get reassigned (SIM recycling) — a row already
   * linked to a different login is a conflict, never silently reassigned.
   */
  async join(
    churchId: string,
    userId: string,
    phone: string,
    input: JoinMemberInput,
  ): Promise<{
    member: Prisma.MemberGetPayload<{ select: typeof MEMBER_SELECT }>;
    created: boolean;
  }> {
    await this.assertChurchExists(churchId);

    if (input.homeBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: input.homeBranchId, churchId },
      });

      if (!branch) {
        throw new BadRequestException(
          `homeBranchId ${input.homeBranchId} does not reference a branch of this church`,
        );
      }
    }

    const data = {
      userId,
      fullName: input.fullName,
      email: input.email ?? null,
      homeBranchId: input.homeBranchId ?? null,
    };

    const existing = await this.prisma.member.findUnique({
      where: { churchId_phone: { churchId, phone } },
      select: { id: true, userId: true },
    });

    if (!existing) {
      try {
        const member = await this.prisma.member.create({
          data: { churchId, phone, ...data },
          select: MEMBER_SELECT,
        });

        return { member, created: true };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // Lost a create race to a concurrent join call for the same phone. The
          // row now exists; re-run once and take the update-or-409 path below.
          return this.join(churchId, userId, phone, input);
        }
        throw e;
      }
    }

    if (existing.userId && existing.userId !== userId) {
      throw new ConflictException('This phone number is already linked to a different login');
    }

    const member = await this.prisma.member.update({
      where: { id: existing.id },
      data,
      select: MEMBER_SELECT,
    });
    return { member, created: false };
  }
}
