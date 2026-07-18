import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { StaffInvite } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const INVITE_TTL_MS = 1_000 * 60 * 60 * 24 * 7;

@Injectable()
export class StaffInviteService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(rawToken: string) {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Mints an invite and revokes any earlier one for the same staff member, so
   * a token that was sent to the wrong place cannot be used once it is replaced.
   * The raw token is returned here and never again.
   */
  async issue(staffId: string, now = new Date()) {
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.staffInvite.updateMany({
        where: { staffId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      }),

      this.prisma.staffInvite.create({
        data: { staffId, tokenHash: this.hash(rawToken), expiresAt },
      }),
    ]);

    return { token: rawToken, expiresAt };
  }

  async revokeAllFor(staffId: string, now = new Date()) {
    await this.prisma.staffInvite.updateMany({
      where: { staffId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async peek(rawToken: string, now = new Date()) {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: { staff: true },
    });

    if (!this.isUsable(invite, now))
      throw new BadRequestException('This invite is no longer valid');

    return invite;
  }

  /**
   * A single conditional UPDATE, so two concurrent callers cannot both win.
   * Under READ COMMITTED the loser blocks on the row lock, re-evaluates its
   * WHERE once the winner commits, and matches nothing.
   *
   * Validate everything cheap before calling this: a claim burns the token
   * regardless of what fails afterwards.
   */
  async claim(rawToken: string, now = new Date()) {
    const tokenHash = this.hash(rawToken);

    const { count } = await this.prisma.staffInvite.updateMany({
      where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });

    if (count === 0) throw new BadRequestException('This invite is no longer valid');

    return this.prisma.staffInvite.findUniqueOrThrow({
      where: { tokenHash },
      include: { staff: true },
    });
  }

  /** Undoes a claim when provisioning failed for a reason the caller can retry. */
  async release(inviteId: string) {
    await this.prisma.staffInvite.update({ where: { id: inviteId }, data: { acceptedAt: null } });
  }

  private isUsable<T extends StaffInvite>(invite: T | null, now: Date): invite is T {
    if (!invite) return false;
    if (invite.acceptedAt) return false;
    if (invite.revokedAt) return false;
    return invite.expiresAt > now;
  }
}
