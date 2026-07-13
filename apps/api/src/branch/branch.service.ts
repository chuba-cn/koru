import type { CreateBranchInput, ListBranchesQuery, UpdateBranchInput } from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);
  }

  /** Body-referenced region must exist AND belong to this church → else 400. */
  private async assertRegionInChurch(churchId: string, regionId: string) {
    const region = await this.prisma.region.findFirst({ where: { id: regionId, churchId } });

    if (!region) {
      throw new BadRequestException(
        `regionId ${regionId} does not reference a region of this church`,
      );
    }
  }

  async create(churchId: string, input: CreateBranchInput) {
    await this.assertChurchExists(churchId);
    if (input.regionId) {
      await this.assertRegionInChurch(churchId, input.regionId);
    }

    try {
      return await this.prisma.branch.create({ data: { churchId, ...input } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Branch "${input.name}" already exists in this church`);
      }
      throw e;
    }
  }

  async list(churchId: string, query: ListBranchesQuery) {
    await this.assertChurchExists(churchId);

    return await this.prisma.branch.findMany({
      where: { churchId, ...(query.regionId ? { regionId: query.regionId } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async findById(churchId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, churchId } });
    if (!branch) throw new NotFoundException(`Branch ${id} not found`);
    return branch;
  }

  async update(churchId: string, id: string, input: UpdateBranchInput) {
    await this.findById(churchId, id);

    if (typeof input.regionId === 'string') {
      await this.assertRegionInChurch(churchId, input.regionId);
    }

    try {
      return await this.prisma.branch.update({ where: { id }, data: input });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Branch "${input.name}" already exists in this church`);
      }

      throw e;
    }
  }
}
