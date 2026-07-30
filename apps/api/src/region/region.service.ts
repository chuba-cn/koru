import type { CreateRegionInput, PaginationQuery, UpdateRegionInput } from '@koru/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ScopeService } from '../auth/scope.service';
import type { TenantStaff } from '../auth/tenant.guard';
import {
  assertCursorVisible,
  assertValidDirection,
  buildCursorPage,
} from '../common/cursor-pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RegionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: ScopeService,
  ) {}

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

  async list(churchId: string, caller: TenantStaff, query: PaginationQuery) {
    await this.assertChurchExists(churchId);

    const scopeWhere: Prisma.RegionWhereInput =
      caller.role === 'super_admin'
        ? {}
        : { id: { in: await this.scopeService.coveredRegionIds(churchId, caller) } };
    const where: Prisma.RegionWhereInput = { AND: [{ churchId }, scopeWhere] };

    assertValidDirection(query);
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.region.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const backward = query.direction === 'backward';
    const [totalCount, rows] = await Promise.all([
      this.prisma.region.count({ where }),
      this.prisma.region.findMany({
        where,
        orderBy: backward ? [{ name: 'desc' }, { id: 'desc' }] : [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);

    return buildCursorPage(rows, totalCount, query);
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
