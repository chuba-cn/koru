import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { RegionService } from './region.service';

const CHURCH = 'church-1';
const REGION = { id: 'region-1', churchId: CHURCH, name: 'Abuja', state: 'FCT' };

/**
 * Behaves like a tiny store rather than returning a fixed object, so the fake
 * honours the `where` clause it is given.
 *
 * That matters: a fake that ignores `where` cannot tell a tenant-scoped query
 * from an unscoped one, which would make the single most dangerous bug class in
 * this codebase invisible to its own tests. See docs/agents/testing.md.
 */
function fakePrisma() {
  return {
    church: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === CHURCH ? { id: CHURCH } : null),
      ),
    },
    region: {
      create: vi.fn(() => Promise.resolve(REGION)),
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) =>
        Promise.resolve(where.id === REGION.id && where.churchId === CHURCH ? REGION : null),
      ),
      delete: vi.fn(() => Promise.resolve(REGION)),
    },
    branch: { count: vi.fn(() => Promise.resolve(0)) },
  };
}

const duplicateKeyError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });

describe('RegionService', () => {
  describe('create', () => {
    it('turns a duplicate name into a 409 that names the region', async () => {
      const prisma = fakePrisma();
      prisma.region.create.mockRejectedValue(duplicateKeyError());
      const service = new RegionService(prisma as never);

      await expect(service.create(CHURCH, { name: 'Abuja', state: 'FCT' })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(CHURCH, { name: 'Abuja', state: 'FCT' })).rejects.toThrow(
        /Abuja/,
      );
    });

    it('rejects when the church does not exist', async () => {
      const service = new RegionService(fakePrisma() as never);

      await expect(
        service.create('no-such-church', { name: 'Abuja', state: 'FCT' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets an unexpected database error through rather than mislabelling it', async () => {
      const prisma = fakePrisma();
      prisma.region.create.mockRejectedValue(new Error('connection lost'));
      const service = new RegionService(prisma as never);

      await expect(service.create(CHURCH, { name: 'Abuja', state: 'FCT' })).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('findById', () => {
    it('finds a region that belongs to the church', async () => {
      const service = new RegionService(fakePrisma() as never);

      await expect(service.findById(CHURCH, REGION.id)).resolves.toEqual(REGION);
    });

    /**
     * The tenant-isolation test. It fails the moment the service stops scoping
     * its lookup by churchId, which would let any church read any region by id.
     */
    it('refuses to find that same region from another church', async () => {
      const service = new RegionService(fakePrisma() as never);

      await expect(service.findById('another-church', REGION.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('refuses to delete a region that still has branches', async () => {
      const prisma = fakePrisma();
      prisma.branch.count.mockResolvedValue(3);
      const service = new RegionService(prisma as never);

      await expect(service.remove(CHURCH, REGION.id)).rejects.toThrow(ConflictException);
      await expect(service.remove(CHURCH, REGION.id)).rejects.toThrow(/branch/);
      expect(prisma.region.delete).not.toHaveBeenCalled();
    });

    it('deletes an empty region', async () => {
      const prisma = fakePrisma();
      const service = new RegionService(prisma as never);

      await service.remove(CHURCH, REGION.id);

      // remove() returns void, so asserting it resolves proves nothing. The
      // observable effect IS the delete, so that is what the contract is.
      expect(prisma.region.delete).toHaveBeenCalledWith({ where: { id: REGION.id } });
    });

    it('refuses to delete a region belonging to another church', async () => {
      const prisma = fakePrisma();
      const service = new RegionService(prisma as never);

      await expect(service.remove('another-church', REGION.id)).rejects.toThrow(NotFoundException);
      expect(prisma.region.delete).not.toHaveBeenCalled();
    });
  });
});
