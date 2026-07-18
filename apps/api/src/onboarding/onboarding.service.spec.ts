import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { OnboardingService, type User } from './onboarding.service';

const USER = { id: 'user-1', email: 'ada@example.test' } as User;
const INPUT = { churchName: 'Celebration Church', fullName: 'Ada Obi' };

type CreateArgs = { data: { staff: { create: Record<string, unknown> } } };

function fakePrisma(existingStaff: unknown = null) {
  return {
    staff: { findUnique: vi.fn(() => Promise.resolve(existingStaff)) },
    church: {
      create: vi.fn((_args: CreateArgs) =>
        Promise.resolve({ id: 'church-1', staff: [{ id: 'staff-1' }] }),
      ),
    },
  };
}

const duplicateKeyError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });

describe('OnboardingService.bootstrapChurch', () => {
  it('creates the church and its founding super_admin together', async () => {
    const prisma = fakePrisma();
    const service = new OnboardingService(prisma as never);

    await service.bootstrapChurch(USER, INPUT);

    expect(prisma.church.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          staff: {
            create: expect.objectContaining({
              email: USER.email,
              role: 'super_admin',
              userId: USER.id,
            }),
          },
        }),
      }),
    );
  });

  it('rejects an account that already administers a church', async () => {
    const prisma = fakePrisma({ id: 'staff-1' });
    const service = new OnboardingService(prisma as never);

    await expect(service.bootstrapChurch(USER, INPUT)).rejects.toThrow(ConflictException);
    expect(prisma.church.create).not.toHaveBeenCalled();
  });

  /**
   * Two concurrent requests both pass the findUnique check, so the second one
   * loses on the Staff.userId unique index. That is the constraint doing its
   * job, and it must read as a conflict rather than a server fault.
   */
  it('maps the unique-constraint loss of a concurrent bootstrap to a conflict', async () => {
    const prisma = fakePrisma();
    prisma.church.create.mockRejectedValue(duplicateKeyError());
    const service = new OnboardingService(prisma as never);

    await expect(service.bootstrapChurch(USER, INPUT)).rejects.toThrow(ConflictException);
    await expect(service.bootstrapChurch(USER, INPUT)).rejects.toThrow(/already administers/);
  });

  it('lets an unexpected database error through rather than mislabelling it', async () => {
    const prisma = fakePrisma();
    prisma.church.create.mockRejectedValue(new Error('connection lost'));
    const service = new OnboardingService(prisma as never);

    await expect(service.bootstrapChurch(USER, INPUT)).rejects.toThrow('connection lost');
  });
});
