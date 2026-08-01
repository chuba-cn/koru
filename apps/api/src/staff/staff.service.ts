import { renderInviteEmail, renderStaffRemovedEmail } from '@koru/emails';
import type {
  CreateStaffInput,
  LinkLoginInput,
  PaginationQuery,
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
import {
  assertCursorVisible,
  assertValidDirection,
  buildCursorPage,
} from '../common/cursor-pagination';
import { LOGO_URL, requireOriginList, SUPPORT_EMAIL, SUPPORT_PHONE } from '../config/env';
import { Prisma, StaffRole } from '../generated/prisma/client';
import { MailService } from '../notifications/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaffInviteService } from './staff-invite.service';

/**
 * WEB_ORIGIN is a list because Better Auth checks it for CORS/CSRF against several
 * allowed origins. There is no separate "which one is the real app" setting, so the
 * first entry is treated as canonical for links we send people. Revisit if staging
 * and production ever share one list.
 */
const WEB_APP_ORIGIN = requireOriginList('WEB_ORIGIN')[0];

const inviteLink = (token: string) =>
  `${WEB_APP_ORIGIN}/invite/accept?token=${encodeURIComponent(token)}`;

/**
 * The roles each delegated (non-super_admin) tier may create. super_admin
 * is handled separately, as the one caller with no single ceiling at all.
 */
const DELEGATED_ROLE_CEILING: Partial<Record<StaffRole, StaffRole[]>> = {
  regional_admin: ['regional_admin', 'branch_admin', 'finance', 'recorder'],
  branch_admin: ['branch_admin', 'finance', 'recorder'],
};

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
    private readonly mail: MailService,
  ) {}

  private async assertChurchExists(churchId: string) {
    const church = await this.prisma.church.findUnique({ where: { id: churchId } });
    if (!church) throw new NotFoundException(`Church ${churchId} not found`);
    return church;
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

  private async assertNotLastSuperAdmin(
    tx: Prisma.TransactionClient,
    churchId: string,
    staffId: string,
  ) {
    const superAdmins = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Staff" WHERE "churchId" = ${churchId} AND role = 'super_admin' FOR UPDATE
      `;

    const isCurrentlySuperAdmin = superAdmins.some((row) => row.id === staffId);
    if (!isCurrentlySuperAdmin) return;

    const remaining = superAdmins.filter((row) => row.id !== staffId);
    if (remaining.length === 0) {
      throw new ConflictException('A church must always have at least one super_admin');
    }
  }

  private async assertScopesGrantable(caller: TenantStaff, scopes: ScopeInput[]) {
    if (caller.role === 'super_admin') return;

    for (const scope of scopes) {
      const covered = await this.scopeService.scopeCovers(caller.scopes, scope);
      if (!covered) {
        throw new ForbiddenException(`A ${caller.role} cannot grant a scope outside their own`);
      }
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

    await this.assertScopesGrantable(caller, scopes);
  }

  /**
   * Whether the caller may manage (update, remove, replace scopes on, or
   * re-issue/revoke the invite of) a staff member who already exists — as
   * opposed to assertCanCreateStaff, which checks a role/scope being requested.
   * The target's CURRENT role and scopes are what get checked here, since a
   * delegated admin's authority over someone doesn't depend on who created them.
   */
  private async canManageStaff(
    caller: TenantStaff,
    target: { role: StaffRole; scopes: ScopeInput[] },
  ): Promise<boolean> {
    if (caller.role === 'super_admin') return true;

    const allowedRoles = DELEGATED_ROLE_CEILING[caller.role];
    if (!allowedRoles?.includes(target.role)) return false;
    if (target.scopes.length === 0) return false;

    for (const scope of target.scopes) {
      if (!(await this.scopeService.scopeCovers(caller.scopes, scope))) return false;
    }
    return true;
  }

  /**
   * The WHERE-clause equivalent of canManageStaff, built once before the query
   * runs rather than checked once per fetched row. Any change to the scope rule
   * in canManageStaff must be mirrored here — see that method's comment.
   */
  private async buildStaffVisibilityWhere(
    churchId: string,
    caller: TenantStaff,
  ): Promise<Prisma.StaffWhereInput> {
    if (caller.role === 'super_admin') return { churchId };

    const allowedRoles = DELEGATED_ROLE_CEILING[caller.role] ?? [];
    if (allowedRoles.length === 0) {
      // No delegated ceiling at all (finance/recorder), same as canManageStaff's
      // implicit "not a manager" case. A condition that can never match any row,
      // expressed without depending on Staff.id's underlying column type.
      return { id: { in: [] } };
    }

    const callerRegionIds = caller.scopes
      .filter((s) => s.scopeType === 'region')
      .map((s) => s.scopeRefId);
    const coveredBranchIds = await this.scopeService.coveredBranchIds(churchId, caller);

    return {
      churchId,
      role: { in: allowedRoles },
      scopes: {
        some: {},
        every: {
          OR: [
            ...(callerRegionIds.length
              ? [{ scopeType: 'region' as const, scopeRefId: { in: callerRegionIds } }]
              : []),
            ...(coveredBranchIds.length
              ? [{ scopeType: 'branch' as const, scopeRefId: { in: coveredBranchIds } }]
              : []),
          ],
        },
      },
    };
  }

  private async assertCanManageStaff(
    caller: TenantStaff,
    target: { role: StaffRole; scopes: ScopeInput[] },
  ) {
    if (!(await this.canManageStaff(caller, target))) {
      throw new ForbiddenException(`A ${caller.role} cannot manage this staff member`);
    }
  }

  private assertCanAssignRole(caller: TenantStaff, role: StaffRole) {
    if (caller.role === 'super_admin') return;

    const allowedRoles = DELEGATED_ROLE_CEILING[caller.role];
    if (!allowedRoles?.includes(role)) {
      throw new ForbiddenException(`A ${caller.role} cannot assign the role ${role}`);
    }
  }

  /**
   * Never allowed to fail the mutation that triggered it: the raw token is still
   * returned in the response, and handing it over out of band is the documented
   * fallback for an invitee with no working address.
   */
  private async sendInviteEmail(
    churchId: string,
    staff: { id: string; email: string },
    churchName: string,
    token: string,
  ) {
    try {
      await this.mail.send({
        churchId,
        category: 'staff_invite',
        to: staff.email,
        recipientStaffId: staff.id,
        subject: `You have been invited to ${churchName} on Koru`,
        html: await renderInviteEmail(churchName, inviteLink(token), {
          logoUrl: LOGO_URL,
          supportEmail: SUPPORT_EMAIL,
          supportPhone: SUPPORT_PHONE,
        }),
      });
    } catch (error) {
      this.logger.error(`Could not queue invite email for staff ${staff.id}: ${error}`);
    }
  }

  async create(churchId: string, input: CreateStaffInput, caller: TenantStaff) {
    const church = await this.assertChurchExists(churchId);
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
    await this.sendInviteEmail(churchId, staff, church.name, invite.token);
    return { ...withStatus(staff), invite };
  }

  async list(churchId: string, caller: TenantStaff, query: PaginationQuery) {
    await this.assertChurchExists(churchId);
    const where = await this.buildStaffVisibilityWhere(churchId, caller);
    const backward = query.direction === 'backward';

    assertValidDirection(query);
    // Prisma's cursor subquery is keyed only on the cursor field (id) — it
    // does not re-apply `where`, so an unchecked cursor is a positional
    // oracle for a row outside this caller's tenant/scope. AND, not a
    // spread: `where` can itself already carry an `id` key (the fail-closed
    // `{ id: { in: [] } }` branch in buildStaffVisibilityWhere), and
    // spreading `id` after it would silently overwrite that guard.
    await assertCursorVisible(query.cursor, (cursor) =>
      this.prisma.staff.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { id: true },
      }),
    );

    const [totalCount, rows] = await Promise.all([
      this.prisma.staff.count({ where }),
      this.prisma.staff.findMany({
        where,
        orderBy: backward
          ? [{ fullName: 'desc' }, { id: 'desc' }]
          : [{ fullName: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        ...staffQueryShape,
      }),
    ]);

    return buildCursorPage(rows.map(withStatus), totalCount, query);
  }

  async findById(churchId: string, id: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id, churchId },
      ...staffQueryShape,
    });

    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return withStatus(staff);
  }

  async update(churchId: string, id: string, input: UpdateStaffInput, caller: TenantStaff) {
    const current = await this.findById(churchId, id);
    await this.assertCanManageStaff(caller, current);

    if (input.role && input.role !== current.role) {
      this.assertCanAssignRole(caller, input.role);
    }

    const leavingSuperAdmin =
      current.role === 'super_admin' && !!input.role && input.role !== 'super_admin';

    const staff = await this.prisma.$transaction(async (tx) => {
      if (leavingSuperAdmin) {
        await this.assertNotLastSuperAdmin(tx, churchId, id);
      }

      return tx.staff.update({
        where: { id },
        data: input,
        ...staffQueryShape,
      });
    });

    return withStatus(staff);
  }

  async replaceScopes(
    churchId: string,
    id: string,
    input: ReplaceScopesInput,
    caller: TenantStaff,
  ) {
    const current = await this.findById(churchId, id);
    await this.assertScopesInChurch(churchId, input.scopes);
    await this.assertCanManageStaff(caller, current);

    if (caller.role !== 'super_admin' && input.scopes.length === 0) {
      throw new ForbiddenException(`A delegated ${caller.role} must grant an explicit scope`);
    }
    await this.assertScopesGrantable(caller, input.scopes);

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

  async remove(churchId: string, id: string, caller: TenantStaff) {
    const staff = await this.findById(churchId, id);
    await this.assertCanManageStaff(caller, staff);

    await this.prisma.$transaction(async (tx) => {
      if (staff.role === 'super_admin') {
        await this.assertNotLastSuperAdmin(tx, churchId, id);
      }
      await tx.staff.delete({ where: { id } });
    });

    const church = await this.prisma.church.findUniqueOrThrow({
      where: { id: churchId },
      select: { name: true },
    });

    try {
      await this.mail.send({
        churchId,
        category: 'staff_removed',
        to: staff.email,
        recipientStaffId: undefined,
        subject: `You have been removed from ${church.name} on Koru`,
        html: await renderStaffRemovedEmail(church.name, {
          logoUrl: LOGO_URL,
          supportEmail: SUPPORT_EMAIL,
          supportPhone: SUPPORT_PHONE,
        }),
      });
    } catch (error) {
      this.logger.error(`Could not queue staff-removed email for ${staff.email}: ${error}`);
    }
  }

  async reissueInvite(churchId: string, id: string, caller: TenantStaff) {
    const church = await this.assertChurchExists(churchId);
    const staff = await this.findById(churchId, id);

    await this.assertCanManageStaff(caller, staff);
    if (staff.status === 'active')
      throw new ConflictException('This staff member has already accepted their invite');

    const invite = await this.invites.issue(id);
    await this.sendInviteEmail(churchId, staff, church.name, invite.token);
    return invite;
  }

  async revokeInvite(churchId: string, id: string, caller: TenantStaff) {
    const staff = await this.findById(churchId, id);
    await this.assertCanManageStaff(caller, staff);
    await this.invites.revokeAllFor(id);
  }

  /**
   * Attaches a login the invitee already has to their pending staff record
   */
  async linkLogin(churchId: string, id: string, input: LinkLoginInput, caller: TenantStaff) {
    const staff = await this.findById(churchId, id);
    await this.assertCanManageStaff(caller, staff);

    if (staff.status === 'active') {
      throw new ConflictException('This staff member already has a login');
    }

    if (staff.email.toLowerCase() !== input.email.toLowerCase()) {
      throw new BadRequestException('That email does not match this staff member');
    }

    const user = await this.authUsers.findByEmail(input.email);
    if (!user) {
      throw new NotFoundException(`No login exists for "${input.email}"`);
    }

    if (!user.emailVerified) {
      throw new ConflictException(
        'That login has not verified its email address, so it cannot be linked',
      );
    }

    const alreadyStaff = await this.prisma.staff.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });

    if (alreadyStaff) {
      throw new ConflictException('That login is already staff at a church');
    }

    let linked: Prisma.StaffGetPayload<typeof staffQueryShape>;
    try {
      linked = await this.prisma.staff.update({
        where: { id },
        data: { userId: user.id },
        ...staffQueryShape,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That login is already staff at a church');
      }
      throw error;
    }

    await this.invites.revokeAllFor(id);
    return withStatus(linked);
  }

  /**
   * Deletes an unverified login squatting on a staff email, and then re-invites
   */
  async clearLogin(churchId: string, id: string) {
    const church = await this.assertChurchExists(churchId);
    const staff = await this.findById(churchId, id);

    if (staff.status === 'active') {
      throw new ConflictException('This staff member has already accepted their invite');
    }

    const user = await this.authUsers.findByEmail(staff.email);
    if (!user) {
      throw new NotFoundException(`No login is holding "${staff.email}"`);
    }

    if (user.emailVerified) {
      throw new ConflictException(
        'That login has a verified email address and belongs to a real person. Link it to this staff member instead of clearing it.',
      );
    }

    await this.assertOwnsNothing(user.id);
    await this.authUsers.delete(user.id);

    /**
     * The check and the delete are not one transaction, and an unverified login
     * can still acquire rows via the phone-OTP path. Cheap to detect after the
     * fact, and loud is better than silent.
     */
    await this.assertOwnsNothing(user.id, true);

    const invite = await this.invites.issue(id);
    await this.sendInviteEmail(churchId, staff, church.name, invite.token);
    return invite;
  }

  private async assertOwnsNothing(userId: string, afterDelete = false) {
    const [staff, member] = await Promise.all([
      this.prisma.staff.findFirst({ where: { userId }, select: { id: true } }),
      this.prisma.member.findFirst({ where: { userId }, select: { id: true } }),
    ]);

    if (!staff && !member) return;

    if (afterDelete) {
      this.logger.error(
        `Login ${userId} acquired ${staff ? 'a staff record' : 'a member record'} while being cleared and was deleted anyway`,
      );
      return;
    }

    throw new ConflictException(
      'That login belongs to an existing person and will not be deleted. Use a different email address.',
    );
  }
}
