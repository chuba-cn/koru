import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { INVITE_TTL_MS, StaffInviteService } from './staff-invite.service';

const STAFF_ID = 'staff-1';
const NOW = new Date('2026-01-01T00:00:00.000Z');

function hashOf(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex');
}

function usableInvite(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'invite-1',
    staffId: STAFF_ID,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + 1000),
    staff: { id: STAFF_ID },
    ...overrides,
  };
}

function fakePrisma() {
  const staffInvite = {
    updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve(usableInvite())),
    findUnique: vi.fn(
      (): Promise<ReturnType<typeof usableInvite> | null> => Promise.resolve(usableInvite()),
    ),
    findUniqueOrThrow: vi.fn(() => Promise.resolve(usableInvite())),
    update: vi.fn(() => Promise.resolve(usableInvite())),
  };

  return {
    staffInvite,
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

describe('StaffInviteService', () => {
  describe('issue', () => {
    it('revokes any earlier unclaimed invite before creating the new one, in the same transaction', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      await service.issue(STAFF_ID, NOW);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.staffInvite.updateMany).toHaveBeenCalledWith({
        where: { staffId: STAFF_ID, acceptedAt: null, revokedAt: null },
        data: { revokedAt: NOW },
      });
      expect(prisma.staffInvite.create).toHaveBeenCalled();
    });

    it('sets expiresAt exactly INVITE_TTL_MS after now, which is seven days', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      const { expiresAt } = await service.issue(STAFF_ID, NOW);

      expect(expiresAt.getTime() - NOW.getTime()).toBe(INVITE_TTL_MS);
      expect(INVITE_TTL_MS).toBe(1000 * 60 * 60 * 24 * 7);
    });

    it('stores only the hash of the token, never the raw value', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      const { token } = await service.issue(STAFF_ID, NOW);

      const createArgs = prisma.staffInvite.create.mock.calls[0]?.[0];
      expect(createArgs?.data.tokenHash).toBe(hashOf(token));
      expect(createArgs?.data.tokenHash).not.toBe(token);
    });
  });

  describe('peek', () => {
    it('returns a usable invite without consuming it', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      const invite = await service.peek('raw-token', NOW);

      expect(invite.id).toBe('invite-1');
      expect(prisma.staffInvite.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['already accepted', { acceptedAt: NOW }],
      ['revoked', { revokedAt: NOW }],
      ['expired', { expiresAt: new Date(NOW.getTime() - 1) }],
    ])('rejects an invite that is %s', async (_label, overrides) => {
      const prisma = fakePrisma();
      prisma.staffInvite.findUnique.mockResolvedValue(usableInvite(overrides));
      const service = new StaffInviteService(prisma as never);

      await expect(service.peek('raw-token', NOW)).rejects.toThrow(BadRequestException);
    });

    it('rejects a token that matches no invite', async () => {
      const prisma = fakePrisma();
      prisma.staffInvite.findUnique.mockResolvedValue(null);
      const service = new StaffInviteService(prisma as never);

      await expect(service.peek('raw-token', NOW)).rejects.toThrow(BadRequestException);
    });

    it('looks the invite up by the hash of the raw token, not the raw token itself', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      await service.peek('raw-token', NOW);

      expect(prisma.staffInvite.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashOf('raw-token') } }),
      );
    });
  });

  describe('claim', () => {
    it('burns the token with a conditional update guarded by expiresAt', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      await service.claim('raw-token', NOW);

      expect(prisma.staffInvite.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: hashOf('raw-token'),
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: NOW },
        },
        data: { acceptedAt: NOW },
      });
    });

    /**
     * This is the concurrency guarantee: a claim that matches zero rows — because
     * a racing caller already accepted, revoked, or it expired — must reject
     * rather than fetch and return whatever state the row happens to be in now.
     */
    it('rejects when the conditional update matches nothing', async () => {
      const prisma = fakePrisma();
      prisma.staffInvite.updateMany.mockResolvedValue({ count: 0 });
      const service = new StaffInviteService(prisma as never);

      await expect(service.claim('raw-token', NOW)).rejects.toThrow(BadRequestException);
      expect(prisma.staffInvite.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('returns the claimed invite with its staff when the update wins', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      const invite = await service.claim('raw-token', NOW);

      expect(invite.staff).toEqual({ id: STAFF_ID });
    });
  });

  describe('release', () => {
    it('clears acceptedAt so the invite can be claimed again', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      await service.release('invite-1');

      expect(prisma.staffInvite.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { acceptedAt: null },
      });
    });
  });

  describe('revokeAllFor', () => {
    it('revokes every unclaimed invite for the staff member', async () => {
      const prisma = fakePrisma();
      const service = new StaffInviteService(prisma as never);

      await service.revokeAllFor(STAFF_ID, NOW);

      expect(prisma.staffInvite.updateMany).toHaveBeenCalledWith({
        where: { staffId: STAFF_ID, acceptedAt: null, revokedAt: null },
        data: { revokedAt: NOW },
      });
    });
  });
});
