import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TenantStaff } from '../auth/tenant.guard';
import { Prisma } from '../generated/prisma/client';
import { BranchService } from './branch.service';

const CHURCH = 'church-1';
const REGION = 'region-1';
const BRANCH = { id: 'branch-1', churchId: CHURCH, regionId: REGION, name: 'Wuse' };

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
      count: vi.fn(() => Promise.resolve(1)),
      findFirst: vi.fn(({ where }: { where: { id: string; churchId: string } }) =>
        Promise.resolve(where.id === BRANCH.id && where.churchId === CHURCH ? BRANCH : null),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...BRANCH, ...data }),
      ),
    },
  };
}

function fakeScopeService(overrides: { branchIds?: string[] } = {}) {
  return {
    coveredRegionIds: vi.fn(() => Promise.resolve([])),
    coveredBranchIds: vi.fn(() => Promise.resolve(overrides.branchIds ?? [])),
  };
}

function callerWith(role: TenantStaff['role'], scopes: TenantStaff['scopes'] = []): TenantStaff {
  return { id: 'caller-1', churchId: CHURCH, role, scopes };
}

const duplicateKeyError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });

describe('BranchService', () => {
  describe('create', () => {
    it('rejects when the church does not exist', async () => {
      const service = new BranchService(fakePrisma() as never, fakeScopeService() as never);

      await expect(
        service.create('no-such-church', { name: 'Wuse', regionId: REGION }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a regionId that belongs to a different church', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      await expect(
        service.create(CHURCH, { name: 'Wuse', regionId: 'someone-elses-region' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.branch.create).not.toHaveBeenCalled();
    });

    it('creates a branch with no region, since regionId is optional', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      await service.create(CHURCH, { name: 'Wuse' });

      expect(prisma.region.findFirst).not.toHaveBeenCalled();
      expect(prisma.branch.create).toHaveBeenCalled();
    });

    it('turns a duplicate name into a 409 that names the branch', async () => {
      const prisma = fakePrisma();
      prisma.branch.create.mockRejectedValue(duplicateKeyError());
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      await expect(service.create(CHURCH, { name: 'Wuse', regionId: REGION })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(CHURCH, { name: 'Wuse', regionId: REGION })).rejects.toThrow(
        /Wuse/,
      );
    });
  });

  describe('list', () => {
    const query = { limit: 50, direction: 'forward' as const };

    it('leaves the WHERE clause scoped to just churchId for a super_admin', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      await service.list(CHURCH, callerWith('super_admin'), query);

      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ churchId: CHURCH }, {}] } }),
      );
    });

    it('scopes the WHERE clause to coveredBranchIds for a delegated caller', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ branchIds: [BRANCH.id] });
      const service = new BranchService(prisma as never, scopeService as never);
      const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH.id }]);

      await service.list(CHURCH, caller, query);

      expect(scopeService.coveredBranchIds).toHaveBeenCalledWith(CHURCH, caller);
      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ churchId: CHURCH }, { id: { in: [BRANCH.id] } }] },
        }),
      );
    });

    it('composes the existing regionId filter with the scope filter, narrowing rather than bypassing it', async () => {
      const prisma = fakePrisma();
      const scopeService = fakeScopeService({ branchIds: [BRANCH.id] });
      const service = new BranchService(prisma as never, scopeService as never);
      const caller = callerWith('branch_admin', [{ scopeType: 'branch', scopeRefId: BRANCH.id }]);

      await service.list(CHURCH, caller, { ...query, regionId: REGION });

      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ churchId: CHURCH }, { id: { in: [BRANCH.id] } }, { regionId: REGION }],
          },
        }),
      );
    });

    it('passes skip:1 and the cursor id through to findMany once the cursor is validated', async () => {
      const prisma = fakePrisma();
      prisma.branch.findFirst.mockResolvedValueOnce(BRANCH);
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      await service.list(CHURCH, callerWith('super_admin'), { ...query, cursor: BRANCH.id });

      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: BRANCH.id }, skip: 1 }),
      );
    });

    it('400s when the cursor lookup comes back empty, instead of silently paging', async () => {
      const prisma = fakePrisma();
      prisma.branch.findFirst.mockResolvedValueOnce(null);
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      await expect(
        service.list(CHURCH, callerWith('super_admin'), {
          ...query,
          cursor: 'someone-elses-branch',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });

    it('rejects direction=backward with no cursor rather than silently returning the last page', async () => {
      const service = new BranchService(fakePrisma() as never, fakeScopeService() as never);

      await expect(
        service.list(CHURCH, callerWith('super_admin'), { limit: 50, direction: 'backward' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('refuses to find a branch that belongs to another church', async () => {
      const service = new BranchService(fakePrisma() as never, fakeScopeService() as never);

      await expect(service.findById('another-church', BRANCH.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('404s rather than updating a branch that does not exist', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      await expect(service.update(CHURCH, 'no-such-branch', { name: 'New Name' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.branch.update).not.toHaveBeenCalled();
    });

    it('rejects moving a branch to a region outside the church', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      await expect(
        service.update(CHURCH, BRANCH.id, { regionId: 'someone-elses-region' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.branch.update).not.toHaveBeenCalled();
    });

    it('applies the update once every check passes', async () => {
      const prisma = fakePrisma();
      const service = new BranchService(prisma as never, fakeScopeService() as never);

      const result = await service.update(CHURCH, BRANCH.id, { name: 'New Name' });

      expect(result.name).toBe('New Name');
    });
  });
});
