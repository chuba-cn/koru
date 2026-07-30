import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TenantStaff } from '../auth/tenant.guard';
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
      findMany: vi.fn(() => Promise.resolve([REGION])),
      count: vi.fn(() => Promise.resolve(1)),
      delete: vi.fn(() => Promise.resolve(REGION)),
    },
    branch: { count: vi.fn(() => Promise.resolve(0)) },
  };
}

function fakeScopeService(overrides: { regionIds?: string[] } = {}) {
  return {
    coveredRegionIds: vi.fn(() => Promise.resolve(overrides.regionIds ?? [])),
    coveredBranchIds: vi.fn(() => Promise.resolve([])),
  };
}

function callerWith(role: TenantStaff['role'], scopes: TenantStaff['scopes'] = []): TenantStaff {
  return { id: 'caller-1', churchId: CHURCH, role, scopes };
}

const duplicateKeyError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });

describe('RegionService', () => {
  describe('create', () => {
    it('turns a duplicate name into a 409 that names the region', async () => {
      const prisma = fakePrisma();
      prisma.region.create.mockRejectedValue(duplicateKeyError());
      const service = new RegionService(prisma as never, fakeScopeService() as never);

      await expect(service.create(CHURCH, { name: 'Abuja', state: 'FCT' })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(CHURCH, { name: 'Abuja', state: 'FCT' })).rejects.toThrow(
        /Abuja/,
      );
    });

    it('rejects when the church does not exist', async () => {
      const service = new RegionService(fakePrisma() as never, fakeScopeService() as never);

      await expect(
        service.create('no-such-church', { name: 'Abuja', state: 'FCT' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets an unexpected database error through rather than mislabelling it', async () => {
      const prisma = fakePrisma();
      prisma.region.create.mockRejectedValue(new Error('connection lost'));
      const service = new RegionService(prisma as never, fakeScopeService() as never);

      await expect(service.create(CHURCH, { name: 'Abuja', state: 'FCT' })).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('list', () => {
    const query = { limit: 50, direction: 'forward' as const };

    it('leaves the WHERE clause scoped to just churchId for a super_admin', async () => {
      const prisma = fakePrisma();
      const service = new RegionService(prisma as never, fakeScopeService() as never);

      await service.list(CHURCH, callerWith('super_admin'), query);

      const expectedWhere = { AND: [{ churchId: CHURCH }, {}] };
      expect(prisma.region.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.region.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('scopes the WHERE clause to coveredRegionIds for a delegated caller', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ regionIds: [REGION.id] });
      const service = new RegionService(prisma as never, scopeService as never);
      const caller = callerWith('regional_admin', [{ scopeType: 'region', scopeRefId: REGION.id }]);

      await service.list(CHURCH, caller, query);

      expect(scopeService.coveredRegionIds).toHaveBeenCalledWith(CHURCH, caller);
      const expectedWhere = { AND: [{ churchId: CHURCH }, { id: { in: [REGION.id] } }] };
      expect(prisma.region.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.region.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('passes skip:1 and the cursor id through to findMany once the cursor is validated', async () => {
      const prisma = fakePrisma();
      prisma.region.findFirst.mockResolvedValueOnce(REGION);
      const service = new RegionService(prisma as never, fakeScopeService() as never);

      await service.list(CHURCH, callerWith('super_admin'), { ...query, cursor: REGION.id });

      expect(prisma.region.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: REGION.id }, skip: 1 }),
      );
    });

    it('400s when the cursor lookup comes back empty, instead of silently paging', async () => {
      const prisma = fakePrisma();
      prisma.region.findFirst.mockResolvedValueOnce(null);
      const service = new RegionService(prisma as never, fakeScopeService() as never);

      await expect(
        service.list(CHURCH, callerWith('super_admin'), {
          ...query,
          cursor: 'someone-elses-region',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.region.findMany).not.toHaveBeenCalled();
    });

    it('rejects direction=backward with no cursor rather than silently returning the last page', async () => {
      const service = new RegionService(fakePrisma() as never, fakeScopeService() as never);

      await expect(
        service.list(CHURCH, callerWith('super_admin'), { limit: 50, direction: 'backward' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('finds a region that belongs to the church', async () => {
      const service = new RegionService(fakePrisma() as never, fakeScopeService() as never);

      await expect(service.findById(CHURCH, REGION.id)).resolves.toEqual(REGION);
    });

    /**
     * The tenant-isolation test. It fails the moment the service stops scoping
     * its lookup by churchId, which would let any church read any region by id.
     */
    it('refuses to find that same region from another church', async () => {
      const service = new RegionService(fakePrisma() as never, fakeScopeService() as never);

      await expect(service.findById('another-church', REGION.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('refuses to delete a region that still has branches', async () => {
      const prisma = fakePrisma();
      prisma.branch.count.mockResolvedValue(3);
      const service = new RegionService(prisma as never, fakeScopeService() as never);

      await expect(service.remove(CHURCH, REGION.id)).rejects.toThrow(ConflictException);
      await expect(service.remove(CHURCH, REGION.id)).rejects.toThrow(/branch/);
      expect(prisma.region.delete).not.toHaveBeenCalled();
    });

    it('deletes an empty region', async () => {
      const prisma = fakePrisma();
      const service = new RegionService(prisma as never, fakeScopeService() as never);

      await service.remove(CHURCH, REGION.id);

      expect(prisma.region.delete).toHaveBeenCalledWith({ where: { id: REGION.id } });
    });

    it('refuses to delete a region belonging to another church', async () => {
      const prisma = fakePrisma();
      const service = new RegionService(prisma as never, fakeScopeService() as never);

      await expect(service.remove('another-church', REGION.id)).rejects.toThrow(NotFoundException);
      expect(prisma.region.delete).not.toHaveBeenCalled();
    });
  });
});
