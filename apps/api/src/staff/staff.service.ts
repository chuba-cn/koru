import type {
  CreateStaffInput,
  ReplaceScopesInput,
  ScopeInput,
  UpdateStaffInput,
} from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthUsersService } from '../auth/auth-users.service';
import { ScopeService } from '../auth/scope.service';
import type { TenantStaff } from '../auth/tenant.guard';
import { Prisma, StaffRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StaffInviteService } from './staff-invite.service';

/**
 * info: The roles each delegated (non-super_admin) tier may create. super_admin
 * is handled separately, as the one caller with no single ceiling at all.
 */
const DELEGATED_ROLE_CEILING: Partial<Record<StaffRole, StaffRole[]>> = {
  regional_admin: ['regional_admin', 'branch_admin', 'finance', 'recorder'],
  branch_admin: ['branch_admin', 'finance', 'recorder'],
};

/**
 * Protects someone who has just signed up and is partway through founding their
 * own church from having that login deleted underneath them.
 *
 * It does not stop a determined squatter, who can simply re-register and wait,
 * and it gives them a cheap way to re-block the address for an hour. It is a
 * guard against destroying a bystander, not against the attack. See ADR-0012.
 */
export const RECLAIM_GRACE_MS = 1000 * 60 * 60;

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
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: StaffInviteService,
    private readonly authUsers: AuthUsersService,
    private readonly scopeService: ScopeService,
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

  private async assertCanCreateStaff(caller: TenantStaff, target: CreateStaffInput) {
    if (caller.role === 'super_admin') return;

    const allowedRoles = DELEGATED_ROLE_CEILING[caller.role];
    if (!allowedRoles) {
      throw new ForbiddenException('Only an admin may add staff');
    }

    if (!allowedRoles.includes(target.role)) {
      throw new ForbiddenException(`A ${caller.role} may not create a ${target.role}`);
    }

    const scopes = target.scopes ?? [];
    if (scopes.length === 0) {
      throw new ForbiddenException(`A delegated ${caller.role} must grant an explicit scope`);
    }

    for (const scope of scopes) {
      const covered = await this.scopeService.scopeCovers(caller.scopes, scope);
      if (!covered) {
        throw new ForbiddenException(`A ${caller.role} cannot grant a scope outside their own`);
      }
    }
  }

  async create(churchId: string, input: CreateStaffInput, caller: TenantStaff) {
    await this.assertChurchExists(churchId);
    const scopes = input.scopes ?? [];
    await this.assertScopesInChurch(churchId, scopes);
    await this.assertCanCreateStaff(caller, input);

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

  /**
   * Frees a staff email whose login is held by an account that owns nothing —
   * either a stranger who signed up with it first, or a half-finished accept.
   * Deletes that login and issues a fresh invite.
   *
   * Requires an authenticated super_admin of this church, because an unverified
   * email proves nothing about who controls it and only a human inside the
   * tenant can break the tie. See ADR-0012.
   */
  async reclaimLogin(churchId: string, id: string, now = new Date()) {
    const staff = await this.findById(churchId, id);

    if (staff.status === 'active') {
      throw new ConflictException('This staff member has already accepted their invite');
    }

    const user = await this.authUsers.findByEmail(staff.email);
    if (!user) {
      throw new NotFoundException(`No login is holding "${staff.email}"`);
    }

    if (now.getTime() - user.createdAt.getTime() < RECLAIM_GRACE_MS) {
      throw new ConflictException(
        'That login was created very recently and may belong to someone mid-signup. Try again later.',
      );
    }

    await this.assertOwnsNothing(user.id);
    await this.authUsers.delete(user.id);

    /**
     * The holder could have founded a church between the check and the delete,
     * which would leave that church with a super_admin whose login no longer
     * exists. Cheap to detect, and loud is better than silent.
     */
    await this.assertOwnsNothing(user.id, true);

    return this.invites.issue(id);
  }

  private async assertOwnsNothing(userId: string, afterDelete = false) {
    const [staff, member] = await Promise.all([
      this.prisma.staff.findFirst({ where: { userId }, select: { id: true } }),
      this.prisma.member.findFirst({ where: { userId }, select: { id: true } }),
    ]);

    if (!staff && !member) return;

    if (afterDelete) {
      this.logger.error(
        `Login ${userId} acquired ${staff ? 'a staff record' : 'a member record'} during reclaim and was deleted anyway`,
      );
      return;
    }

    throw new ConflictException(
      'That login belongs to an existing person and will not be deleted. Use a different email address.',
    );
  }
}
