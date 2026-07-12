import type { CreateRegionInput, UpdateRegionInput } from '@koru/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RegionService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });

    if (!church) throw new NotFoundException(`Church with ${churchId} not found`);
  }

  async create(churchId: string, input: CreateRegionInput) {
    await this.assertChurchExists(churchId);

    try {
      return await this.prisma.region.create({ data: { churchId, ...input } });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Region ${input.name} already exists in this church`);
      }

      throw error;
    }
  }

  async list(churchId: string) {
    await this.assertChurchExists(churchId);
    return this.prisma.region.findMany({ where: { churchId }, orderBy: { name: 'asc' } });
  }

  async findById(churchId: string, id: string) {
    const region = await this.prisma.region.findFirst({ where: { id, churchId } });
    if (!region) throw new NotFoundException(`Region ${id} not found`);
    return region;
  }

  async update(churchId: string, id: string, input: UpdateRegionInput) {
    await this.findById(churchId, id);

    try {
      return await this.prisma.region.update({ where: { id }, data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Region ${input.name} already exists in this church`);
      }

      throw error;
    }
  }

  async remove(churchId: string, id: string) {
    await this.findById(churchId, id);
    const branchCount = await this.prisma.branch.count({ where: { regionId: id } });

    if (branchCount > 0) {
      throw new ConflictException(
        `Region has ${branchCount} branch(es); move or delete them first`,
      );
    }

    await this.prisma.region.delete({ where: { id } });
  }
}
