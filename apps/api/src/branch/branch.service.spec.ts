import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { BranchService } from './branch.service';

const CHURCH = 'church-1';
const REGION = 'region-1';
const BRANCH = { id: 'branch-1', churchId: CHURCH, regionId: REGION, name: 'Wuse' };

/**
 * Keys every lookup off the `where` clause it receives, per docs/agents/testing.md
 * — a fake that ignores `where` would hide a broken tenant or region scope.
 */
function fakePrisma() {
  return {
    church: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === CHURCH ? { id: CHURCH } : null),
      ),
    },
    region: {
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) =>
        Promise.resolve(where.id === REGION && where.churchId === CHURCH ? { id: REGION } : null),
      ),
    },
    branch: {
      create: vi.fn(() => Promise.resolve(BRANCH)),
      findMany: vi.fn(() => Promise.resolve([BRANCH])),
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) =>
        Promise.resolve(where.id === BRANCH.id && where.churchId === CHURCH ? BRANCH : null),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...BRANCH, ...data }),
      ),
    },
  };
}

const duplicateKeyError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });

describe('BranchService', () => {
  describe('create', () => {
    it('rejects when the church does not exist', async () => {
      const service = new BranchService(fakePrisma() as never);

      await expect(
        service.create('no-such-church', { name: 'Wuse', regionId: REGION }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a regionId that belongs to a different church', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never);

      await expect(
        service.create(CHURCH, { name: 'Wuse', regionId: 'someone-elses-region' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.branch.create).not.toHaveBeenCalled();
    });

    it('creates a branch with no region, since regionId is optional', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never);

      await service.create(CHURCH, { name: 'Wuse' });

      expect(prisma.region.findFirst).not.toHaveBeenCalled();
      expect(prisma.branch.create).toHaveBeenCalled();
    });

    it('turns a duplicate name into a 409 that names the branch', async () => {
      const prisma = fakePrisma();
      prisma.branch.create.mockRejectedValue(duplicateKeyError());
      const service = new BranchService(prisma as never);

      await expect(service.create(CHURCH, { name: 'Wuse', regionId: REGION })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(CHURCH, { name: 'Wuse', regionId: REGION })).rejects.toThrow(
        /Wuse/,
      );
    });
  });

  describe('list', () => {
    it('filters by regionId when the query supplies one', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never);

      await service.list(CHURCH, { regionId: REGION });

      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { churchId: CHURCH, regionId: REGION } }),
      );
    });

    it('lists every branch in the church when no regionId is given', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never);

      await service.list(CHURCH, {});

      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { churchId: CHURCH } }),
      );
    });
  });

  describe('findById', () => {
    it('refuses to find a branch that belongs to another church', async () => {
      const service = new BranchService(fakePrisma() as never);

      await expect(service.findById('another-church', BRANCH.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('404s rather than updating a branch that does not exist', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never);

      await expect(service.update(CHURCH, 'no-such-branch', { name: 'New Name' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.branch.update).not.toHaveBeenCalled();
    });

    it('rejects moving a branch to a region outside the church', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never);

      await expect(
        service.update(CHURCH, BRANCH.id, { regionId: 'someone-elses-region' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.branch.update).not.toHaveBeenCalled();
    });

    it('applies the update once every check passes', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never);

      const result = await service.update(CHURCH, BRANCH.id, { name: 'New Name' });

      expect(result.name).toBe('New Name');
    });
  });
});
