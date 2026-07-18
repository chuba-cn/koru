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
import { StaffInviteService } from './staff-invite.service';

type StaffRow = { userId: string | null };

const withStatus = <T extends StaffRow>(staff: T) => ({
  ...staff,
  status: staff.userId ? ('active' as const) : ('pending' as const),
});

const staffQueryShape = {
  omit: { passwordHash: true },
  include: {
    scopes: { select: { id: true, scopeType: true, scopeRefId: true } },
  },
} as const;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: StaffInviteService,
  ) {}

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

    let staff: Prisma.StaffGetPayload<typeof staffQueryShape>;

    try {
      staff = await this.prisma.staff.create({
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

    const invite = await this.invites.issue(staff.id);
    return { ...withStatus(staff), invite };
  }

  async list(churchId: string) {
    await this.assertChurchExists(churchId);
    const staff = await this.prisma.staff.findMany({
      where: { churchId },
      orderBy: { fullName: 'asc' },
      ...staffQueryShape,
    });

    return staff.map(withStatus);
  }

  async findById(churchId: string, id: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id, churchId },
      ...staffQueryShape,
    });

    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return withStatus(staff);
  }

  async update(churchId: string, id: string, input: UpdateStaffInput) {
    await this.findById(churchId, id);
    const staff = await this.prisma.staff.update({
      where: { id },
      data: input,
      ...staffQueryShape,
    });

    return withStatus(staff);
  }

  async replaceScopes(churchId: string, id: string, input: ReplaceScopesInput) {
    await this.findById(churchId, id);
    await this.assertScopesInChurch(churchId, input.scopes);

    const staff = await this.prisma.staff.update({
      where: { id },
      data: {
        scopes: {
          deleteMany: {},
          create: input.scopes,
        },
      },
      ...staffQueryShape,
    });

    return withStatus(staff);
  }

  async remove(churchId: string, id: string) {
    await this.findById(churchId, id);
    await this.prisma.staff.delete({ where: { id } });
  }

  async reissueInvite(churchId: string, id: string) {
    const staff = await this.findById(churchId, id);
    if (staff.status === 'active')
      throw new ConflictException('This staff member has already accepted their invite');

    return this.invites.issue(id);
  }

  async revokeInvite(churchId: string, id: string) {
    await this.findById(churchId, id);
    await this.invites.revokeAllFor(id);
  }
}
