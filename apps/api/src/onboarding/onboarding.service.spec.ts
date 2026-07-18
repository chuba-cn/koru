import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { OnboardingService, type User } from './onboarding.service';

const USER = { id: 'user-1', email: 'ada@example.test' } as User;
const INPUT = { churchName: 'Celebration Church', fullName: 'Ada Obi' };

type CreateArgs = { data: { staff: { create: Record<string, unknown> } } };

/** Echoes the nested write back, so tests can assert the church that comes out. */
function fakePrisma(existingStaff: unknown = null) {
  return {
    staff: { findUnique: vi.fn(() => Promise.resolve(existingStaff)) },
    church: {
      create: vi.fn(({ data }: CreateArgs) =>
        Promise.resolve({ id: 'church-1', staff: [{ id: 'staff-1', ...data.staff.create }] }),
      ),
    },
  };
}

const duplicateKeyError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });

describe('OnboardingService.bootstrapChurch', () => {
  it('returns a church whose founding staff is a super_admin linked to the caller', async () => {
    const service = new OnboardingService(fakePrisma() as never);

    const church = await service.bootstrapChurch(USER, INPUT);

    expect(church.staff[0]).toMatchObject({
      email: USER.email,
      role: 'super_admin',
      userId: USER.id,
    });
  });

  it('rejects an account that already administers a church', async () => {
    const prisma = fakePrisma({ id: 'staff-1' });
    const service = new OnboardingService(prisma as never);

    await expect(service.bootstrapChurch(USER, INPUT)).rejects.toThrow(ConflictException);
    expect(prisma.church.create).not.toHaveBeenCalled();
  });

  /** Losing the Staff.userId index is the constraint working, not a server fault. */
  it('maps a lost race on the unique index to a conflict, never a 500', async () => {
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
