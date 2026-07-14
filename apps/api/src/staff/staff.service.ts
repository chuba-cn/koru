import type {
  CreateStaffInput,
  ReplaceScopesInput,
  ScopeInput,
  UpdateStaffInput,
} from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const staffQueryShape = {
  omit: { passwordHash: true },
  include: {
    scopes: { select: { id: true, scopeType: true, scopeRefId: true } },
  },
} as const;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);
  }

  private async assertScopesInChurch(churchId: string, scopes: ScopeInput[]) {
    if (scopes.length === 0) return;

    const regionIds = scopes
      .filter((scope) => scope.scopeType === 'region')
      .map((scope) => scope.scopeRefId);
    const branchIds = scopes
      .filter((scope) => scope.scopeType === 'branch')
      .map((scope) => scope.scopeRefId);

    const [regions, branches] = await Promise.all([
      this.prisma.region.findMany({
        where: { id: { in: regionIds }, churchId },
        select: { id: true },
      }),
      this.prisma.branch.findMany({
        where: { id: { in: branchIds }, churchId },
        select: { id: true },
      }),
    ]);

    const found = new Set([
      ...regions.map((region) => region.id),
      ...branches.map((branch) => branch.id),
    ]);
    const missing = scopes.filter((scope) => !found.has(scope.scopeRefId));

    if (missing.length > 0) {
      const detail = missing.map((m) => `${m.scopeType}:${m.scopeRefId}`).join(',');
      throw new BadRequestException(`scope reference(s) not found in this church: ${detail}`);
    }
  }

  async create(churchId: string, input: CreateStaffInput) {
    await this.assertChurchExists(churchId);
    const scopes = input.scopes ?? [];
    await this.assertScopesInChurch(churchId, scopes);

    try {
      return await this.prisma.staff.create({
        data: {
          churchId,
          fullName: input.fullName,
          email: input.email,
          role: input.role,
          scopes: { create: scopes },
        },
        ...staffQueryShape,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          `Staff with email "${input.email}" already exists in this church`,
        );
      }
      throw e;
    }
  }

  async list(churchId: string) {
    await this.assertChurchExists(churchId);
    return this.prisma.staff.findMany({
      where: { churchId },
      orderBy: { fullName: 'asc' },
      ...staffQueryShape,
    });
  }

  async findById(churchId: string, id: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id, churchId },
      ...staffQueryShape,
    });

    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return staff;
  }

  async update(churchId: string, id: string, input: UpdateStaffInput) {
    await this.findById(churchId, id);
    return this.prisma.staff.update({
      where: { id },
      data: input,
      ...staffQueryShape,
    });
  }

  async replaceScopes(churchId: string, id: string, input: ReplaceScopesInput) {
    await this.findById(churchId, id);
    await this.assertScopesInChurch(churchId, input.scopes);

    return this.prisma.staff.update({
      where: { id },
      data: {
        scopes: {
          deleteMany: {},
          create: input.scopes,
        },
      },
      ...staffQueryShape,
    });
  }

  async remove(churchId: string, id: string) {
    await this.findById(churchId, id);
    await this.prisma.staff.delete({ where: { id } });
  }
}
