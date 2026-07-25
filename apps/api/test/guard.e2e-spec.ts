import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch, createAuthedChurchWithRegion } from './auth-utils';
import { truncateAll } from './db-utils';
import { signInMemberByPhone } from './member-auth-utils';

describe('Guards (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('401s a protected route with no session', async () => {
    await request(app.getHttpServer())
      .get('/churches/00000000-0000-0000-0000-000000000000')
      .expect(401);
  });

  it('403s when session belongs to a different church (tenant crossing)', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    await request(app.getHttpServer())
      .get(`/churches/${bob.churchId}`)
      .set('Cookie', alice.cookie)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'North', state: 'Lagos' })
      .expect(403);
  });

  it('200s when session belongs to the same church', async () => {
    const alice = await createAuthedChurch(app);
    await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}`)
      .set('Cookie', alice.cookie)
      .expect(200);
  });

  it('leaves public routes (health, auth) reachable without a session', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/api/auth/ok').expect(200);
  });

  it('403s a role-denied action (non-super_admin cannot list staff)', async () => {
    const alice = await createAuthedChurch(app);
    await prisma.staff.update({
      where: { id: alice.staffId },
      data: { role: 'finance' },
    });
    await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .expect(403);
  });

  it('403s a recorder attempting to create a region or branch', async () => {
    const alice = await createAuthedChurch(app);
    await prisma.staff.update({ where: { id: alice.staffId }, data: { role: 'recorder' } });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'North', state: 'Lagos' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja' })
      .expect(403);
  });

  it('leaves region and branch listing open to a recorder', async () => {
    const alice = await createAuthedChurch(app);
    await prisma.staff.update({ where: { id: alice.staffId }, data: { role: 'recorder' } });

    await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .expect(200);
  });

  it.each([
    'regional_admin',
    'branch_admin',
    'finance',
  ] as const)('lets a %s create a region and a branch', async (role) => {
    const alice = await createAuthedChurch(app);
    await prisma.staff.update({ where: { id: alice.staffId }, data: { role } });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'North', state: 'Lagos' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja' })
      .expect(201);
  });

  it('403s a member session reaching a staff-only route', async () => {
    const church = await createAuthedChurch(app);
    const phone = '+2348099999999';
    const { cookie } = await signInMemberByPhone(app, phone);
    await request(app.getHttpServer())
      .post(`/join/${church.churchId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Grace Member' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/churches/${church.churchId}/staff`)
      .set('Cookie', cookie)
      .expect(403);
  });

  it.each([
    'branch_admin',
    'finance',
    'recorder',
  ] as const)('lets a branch_admin create a %s scoped to their own branch', async (role) => {
    const alice = await createAuthedChurchWithRegion(app);
    const branch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'branch_admin',
        scopes: { create: [{ scopeType: 'branch', scopeRefId: branch.body.id }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Grace Delegate',
        email: `grace-${role}@example.test`,
        role,
        scopes: [{ scopeType: 'branch', scopeRefId: branch.body.id }],
      })
      .expect(201);
  });

  it('403s a branch_admin creating a recorder scoped to a different branch', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const ownBranch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);
    const otherBranch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Lekki', regionId: alice.regionId })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'branch_admin',
        scopes: { create: [{ scopeType: 'branch', scopeRefId: ownBranch.body.id }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Grace Recorder',
        email: 'grace@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'branch', scopeRefId: otherBranch.body.id }],
      })
      .expect(403);
  });

  it.each([
    'regional_admin',
    'super_admin',
  ] as const)('403s a branch_admin trying to create a %s', async (role) => {
    const alice = await createAuthedChurchWithRegion(app);
    const branch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'branch_admin',
        scopes: { create: [{ scopeType: 'branch', scopeRefId: branch.body.id }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Above The Ceiling',
        email: `above-${role}@example.test`,
        role,
        scopes: [{ scopeType: 'branch', scopeRefId: branch.body.id }],
      })
      .expect(403);
  });

  it.each([
    'regional_admin',
    'branch_admin',
    'finance',
    'recorder',
  ] as const)('lets a regional_admin create a %s scoped to their region', async (role) => {
    const alice = await createAuthedChurchWithRegion(app);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Region Delegate',
        email: `region-${role}@example.test`,
        role,
        scopes: [{ scopeType: 'region', scopeRefId: alice.regionId }],
      })
      .expect(201);
  });

  it('lets a regional_admin create a recorder scoped to a branch inside their region', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const branch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Branch Recorder',
        email: 'branch-recorder@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'branch', scopeRefId: branch.body.id }],
      })
      .expect(201);
  });

  it('403s a regional_admin trying to create a super_admin', async () => {
    const alice = await createAuthedChurchWithRegion(app);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Above The Ceiling',
        email: 'above-super@example.test',
        role: 'super_admin',
        scopes: [{ scopeType: 'region', scopeRefId: alice.regionId }],
      })
      .expect(403);
  });

  it('403s a regional_admin creating a recorder scoped to a different region, or its branch', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const otherRegion = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'South', state: 'Rivers' })
      .expect(201);
    const branchInOtherRegion = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Port Harcourt', regionId: otherRegion.body.id })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Wrong Region',
        email: 'wrong-region@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'region', scopeRefId: otherRegion.body.id }],
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Wrong Branch',
        email: 'wrong-branch@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'branch', scopeRefId: branchInOtherRegion.body.id }],
      })
      .expect(403);
  });

  it('403s finance and recorder attempting to create staff at all', async () => {
    const alice = await createAuthedChurch(app);

    for (const role of ['finance', 'recorder'] as const) {
      await prisma.staff.update({ where: { id: alice.staffId }, data: { role } });

      await request(app.getHttpServer())
        .post(`/churches/${alice.churchId}/staff`)
        .set('Cookie', alice.cookie)
        .send({ fullName: 'Someone', email: 'someone@example.test', role: 'recorder' })
        .expect(403);
    }
  });

  it('lets a branch_admin update, reissue, revoke, and remove a recorder in their own branch', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const branch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'branch_admin',
        scopes: { create: [{ scopeType: 'branch', scopeRefId: branch.body.id }] },
      },
    });

    const recorder = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Grace Recorder',
        email: 'grace-recorder@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'branch', scopeRefId: branch.body.id }],
      })
      .expect(201);
    const recorderId = recorder.body.id;

    await request(app.getHttpServer())
      .patch(`/churches/${alice.churchId}/staff/${recorderId}`)
      .set('Cookie', alice.cookie)
      .send({ fullName: 'Grace R.' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${recorderId}/invite`)
      .set('Cookie', alice.cookie)
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/churches/${alice.churchId}/staff/${recorderId}/invite`)
      .set('Cookie', alice.cookie)
      .expect(204);

    await request(app.getHttpServer())
      .put(`/churches/${alice.churchId}/staff/${recorderId}/scopes`)
      .set('Cookie', alice.cookie)
      .send({ scopes: [{ scopeType: 'branch', scopeRefId: branch.body.id }] })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/churches/${alice.churchId}/staff/${recorderId}`)
      .set('Cookie', alice.cookie)
      .expect(204);
  });

  it('403s a branch_admin managing staff outside their own branch, on every route', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const ownBranch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);
    const otherBranch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Lekki', regionId: alice.regionId })
      .expect(201);

    const outsider = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Outside Recorder',
        email: 'outside-recorder@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'branch', scopeRefId: otherBranch.body.id }],
      })
      .expect(201);
    const outsiderId = outsider.body.id;

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'branch_admin',
        scopes: { create: [{ scopeType: 'branch', scopeRefId: ownBranch.body.id }] },
      },
    });

    await request(app.getHttpServer())
      .patch(`/churches/${alice.churchId}/staff/${outsiderId}`)
      .set('Cookie', alice.cookie)
      .send({ fullName: 'Renamed' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${outsiderId}/invite`)
      .set('Cookie', alice.cookie)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/churches/${alice.churchId}/staff/${outsiderId}/invite`)
      .set('Cookie', alice.cookie)
      .expect(403);

    await request(app.getHttpServer())
      .put(`/churches/${alice.churchId}/staff/${outsiderId}/scopes`)
      .set('Cookie', alice.cookie)
      .send({ scopes: [{ scopeType: 'branch', scopeRefId: ownBranch.body.id }] })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/churches/${alice.churchId}/staff/${outsiderId}`)
      .set('Cookie', alice.cookie)
      .expect(403);
  });

  it('403s a branch_admin promoting a recorder they manage above their own ceiling', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const branch = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);

    const recorder = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Grace Recorder',
        email: 'grace-promote@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'branch', scopeRefId: branch.body.id }],
      })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'branch_admin',
        scopes: { create: [{ scopeType: 'branch', scopeRefId: branch.body.id }] },
      },
    });

    await request(app.getHttpServer())
      .patch(`/churches/${alice.churchId}/staff/${recorder.body.id}`)
      .set('Cookie', alice.cookie)
      .send({ role: 'regional_admin' })
      .expect(403);
  });

  it('lets a regional_admin list only the staff they fully cover, while super_admin sees everyone', async () => {
    // This is the one place that proves buildStaffVisibilityWhere's `every`/`some`
    // clause actually compiles to the intended SQL against real Postgres — a unit
    // test with a mocked Prisma client can't tell `every` from `some`, since the
    // mock doesn't apply the where clause at all. See staff.service.spec.ts.
    const alice = await createAuthedChurchWithRegion(app);
    const otherRegion = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'South', state: 'Rivers' })
      .expect(201);
    const branchInRegion = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);
    const branchOutsideRegion = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Port Harcourt', regionId: otherRegion.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'In Region',
        email: 'in-region@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'region', scopeRefId: alice.regionId }],
      })
      .expect(201);
    const outOfRegion = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Out Of Region',
        email: 'out-of-region@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'region', scopeRefId: otherRegion.body.id }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Partially Covered',
        email: 'partial@example.test',
        role: 'recorder',
        scopes: [
          { scopeType: 'branch', scopeRefId: branchInRegion.body.id },
          { scopeType: 'branch', scopeRefId: branchOutsideRegion.body.id },
        ],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'No Scope At All',
        email: 'no-scope@example.test',
        role: 'recorder',
      })
      .expect(201);

    const asSuperAdmin = await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .expect(200);
    const namesAsSuperAdmin = asSuperAdmin.body.items.map((s: { fullName: string }) => s.fullName);
    expect(namesAsSuperAdmin).toContain('In Region');
    expect(namesAsSuperAdmin).toContain('Out Of Region');
    expect(namesAsSuperAdmin).toContain('Partially Covered');
    expect(namesAsSuperAdmin).toContain('No Scope At All');

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    const asRegionalAdmin = await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .expect(200);
    const namesAsRegionalAdmin = asRegionalAdmin.body.items.map(
      (s: { fullName: string }) => s.fullName,
    );
    // Fully covered: a region-scoped target inside the caller's region.
    expect(namesAsRegionalAdmin).toContain('In Region');
    // Not covered at all: a different region entirely.
    expect(namesAsRegionalAdmin).not.toContain('Out Of Region');
    // Covers ONE of two branch scopes: must be excluded — this is the `every`,
    // not `some`, semantic. A mocked findMany can't tell these apart; Postgres can.
    expect(namesAsRegionalAdmin).not.toContain('Partially Covered');
    // Zero scopes: canManageStaff refuses this even for a caller who could
    // otherwise manage the role, so buildStaffVisibilityWhere must too.
    expect(namesAsRegionalAdmin).not.toContain('No Scope At All');

    // A cursor outside the caller's visibility scope must 400 rather than
    // silently resolving.
    await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/staff`)
      .query({ cursor: outOfRegion.body.id })
      .set('Cookie', alice.cookie)
      .expect(400);
  });

  // Only regional_admin is exercised: RolesGuard checks membership in a fixed role
  // list with no role-specific branching, so branch_admin would hit the identical
  // code path — this proves "not super_admin" is refused, not one role in particular.
  it('403s a regional_admin calling clear-login, which stays super_admin-only', async () => {
    const alice = await createAuthedChurchWithRegion(app);

    const recorder = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Grace Recorder',
        email: 'grace-clear@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'region', scopeRefId: alice.regionId }],
      })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${recorder.body.id}/invite/clear-login`)
      .set('Cookie', alice.cookie)
      .expect(403);
  });

  it('lets a regional_admin call link-login for a staff member within their own scope', async () => {
    const alice = await createAuthedChurchWithRegion(app);

    const recorder = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Grace Recorder',
        email: 'grace-link@example.test',
        role: 'recorder',
        scopes: [{ scopeType: 'region', scopeRefId: alice.regionId }],
      })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    // No login exists for this email yet, so this hits the 404 the route itself
    // defines rather than a 403 from the role/scope guards — proving the request
    // was actually authorized to reach the service at all.
    const res = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${recorder.body.id}/link-login`)
      .set('Cookie', alice.cookie)
      .send({ email: 'grace-link@example.test' });

    expect(res.status).toBe(404);
  });

  it('403s a regional_admin calling link-login for a staff member outside their scope', async () => {
    const alice = await createAuthedChurchWithRegion(app);

    const outOfScope = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({ fullName: 'Out Of Region', email: 'out-of-region@example.test', role: 'finance' })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff/${outOfScope.body.id}/link-login`)
      .set('Cookie', alice.cookie)
      .send({ email: 'out-of-region@example.test' })
      .expect(403);
  });
});
