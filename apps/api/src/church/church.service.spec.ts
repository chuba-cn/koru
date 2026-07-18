import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ChurchService } from './church.service';

const CHURCH = { id: 'church-1', name: 'Grace Assembly' };

function fakePrisma() {
  return {
    church: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === CHURCH.id ? CHURCH : null),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...CHURCH, ...data }),
      ),
    },
  };
}

describe('ChurchService', () => {
  describe('findById', () => {
    it('finds a church that exists', async () => {
      const service = new ChurchService(fakePrisma() as never);

      await expect(service.findById(CHURCH.id)).resolves.toEqual(CHURCH);
    });

    it('404s on a church that does not exist', async () => {
      const service = new ChurchService(fakePrisma() as never);

      await expect(service.findById('no-such-church')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies the update to an existing church', async () => {
      const prisma = fakePrisma();
      const service = new ChurchService(prisma as never);

      const result = await service.update(CHURCH.id, { name: 'New Name' });

      expect(result).toEqual({ ...CHURCH, name: 'New Name' });
      expect(prisma.church.update).toHaveBeenCalledWith({
        where: { id: CHURCH.id },
        data: { name: 'New Name' },
      });
    });

    it('404s rather than updating a church that does not exist', async () => {
      const prisma = fakePrisma();
      const service = new ChurchService(prisma as never);

      await expect(service.update('no-such-church', { name: 'New Name' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.church.update).not.toHaveBeenCalled();
    });
  });
});
