import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createAuthedChurch,
  createAuthedChurchWithRegion,
  verifyEmailAndGetCookie,
} from './auth-utils';
import { truncateAll } from './db-utils';

async function createBranch(
  app: INestApplication,
  churchId: string,
  cookie: string,
  name = 'KORU Abuja',
) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/branches`)
    .set('Cookie', cookie)
    .send({ name })
    .expect(201);
  return res.body as { id: string };
}

async function acceptInviteAndGetCookie(app: INestApplication, token: string, email: string) {
  await request(app.getHttpServer())
    .post('/invites/accept')
    .send({ token, password: 'correct horse battery' })
    .expect(201);
  return verifyEmailAndGetCookie(app, email);
}

describe('Staff (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers staff without scopes and never exposes passwordHash', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ada Obi', email: 'ada@example.com', role: 'finance' })
      .expect(201);

    expect(res.body.fullName).toBe('Ada Obi');
    expect(res.body.role).toBe('finance');
    expect(res.body.scopes).toEqual([]);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('registers staff with mixed region + branch scopes in one call', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);
    const branch = await createBranch(app, churchId, cookie);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff`)
      .set('Cookie', cookie)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'regional_admin',
        scopes: [
          { scopeType: 'region', scopeRefId: regionId },
          { scopeType: 'branch', scopeRefId: branch.id },
        ],
      })
      .expect(201);

    expect(res.body.scopes).toHaveLength(2);
    const types = res.body.scopes.map((s: { scopeType: string }) => s.scopeType).sort();
    expect(types).toEqual(['branch', 'region']);
  });

  it('rejects duplicate email within a church (409), allows it in another church', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
    const staff = { fullName: 'Ada Obi', email: 'ada@example.com', role: 'finance' };

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send(staff)
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send(staff)
      .expect(409);

    expect(dup.body.error).toBe('CONFLICT');

    await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/staff`)
      .set('Cookie', bob.cookie)
      .send(staff)
      .expect(201);
  });

  it('rejects scopes referencing another church or nothing at all (400, names the culprits)', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });
    const branchB = await createBranch(app, bob.churchId, bob.cookie);

    const res = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'branch_admin',
        scopes: [{ scopeType: 'branch', scopeRefId: branchB.id }],
      })
      .expect(400);

    expect(res.body.error).toBe('BAD_REQUEST');
    expect(res.body.message).toContain(branchB.id);
  });

  it('rejects duplicate scope pairs in one payload (400 from the Zod refine)', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff`)
      .set('Cookie', cookie)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'regional_admin',
        scopes: [
          { scopeType: 'region', scopeRefId: regionId },
          { scopeType: 'region', scopeRefId: regionId },
        ],
      })
      .expect(400);

    expect(res.body.errors.scopes).toBeDefined();
  });

  it('lists staff with their scopes', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff`)
      .set('Cookie', cookie)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'regional_admin',
        scopes: [{ scopeType: 'region', scopeRefId: regionId }],
      })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchId}/staff`)
      .set('Cookie', cookie)
      .expect(200);

    expect(
      list.body.items.every((s: { passwordHash: unknown }) => s.passwordHash === undefined),
    ).toBe(true);

    const ada = list.body.items.find((s: { email: string }) => s.email === 'ada@example.com');
    expect(ada).toBeDefined();
    expect(ada.scopes).toHaveLength(1);
    expect(list.body.totalCount).toBeGreaterThanOrEqual(1);
  });

  it('updates role via PATCH and replaces scopes wholesale via PUT (empty array clears)', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);
    const branch = await createBranch(app, churchId, cookie);

    const staff = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff`)
      .set('Cookie', cookie)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'branch_admin',
        scopes: [{ scopeType: 'branch', scopeRefId: branch.id }],
      })
      .expect(201);

    const promoted = await request(app.getHttpServer())
      .patch(`/churches/${churchId}/staff/${staff.body.id}`)
      .set('Cookie', cookie)
      .send({ role: 'regional_admin' })
      .expect(200);

    expect(promoted.body.role).toBe('regional_admin');
    expect(promoted.body.scopes).toHaveLength(1);

    const replaced = await request(app.getHttpServer())
      .put(`/churches/${churchId}/staff/${staff.body.id}/scopes`)
      .set('Cookie', cookie)
      .send({ scopes: [{ scopeType: 'region', scopeRefId: regionId }] })
      .expect(200);

    expect(replaced.body.scopes).toHaveLength(1);
    expect(replaced.body.scopes[0].scopeType).toBe('region');

    const cleared = await request(app.getHttpServer())
      .put(`/churches/${churchId}/staff/${staff.body.id}/scopes`)
      .set('Cookie', cookie)
      .send({ scopes: [] })
      .expect(200);

    expect(cleared.body.scopes).toEqual([]);
  });

  it('deletes staff and cascades their scopes at the DB level', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    const staff = await request(app.getHttpServer())
      .post(`/churches/${churchId}/staff`)
      .set('Cookie', cookie)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'regional_admin',
        scopes: [{ scopeType: 'region', scopeRefId: regionId }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/churches/${churchId}/staff/${staff.body.id}`)
      .set('Cookie', cookie)
      .expect(204);

    const orphanCount = await prisma.staffScope.count();
    expect(orphanCount).toBe(0);
  });

  it('isolates tenants: church B cannot see, update, or delete church A staff', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    const ada = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({ fullName: 'Ada Obi', email: 'ada@example.com', role: 'finance' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/churches/${bob.churchId}/staff`)
      .set('Cookie', bob.cookie)
      .expect(200);

    expect(list.body.items.map((s: { id: string }) => s.id)).not.toContain(ada.body.id);

    await request(app.getHttpServer())
      .patch(`/churches/${bob.churchId}/staff/${ada.body.id}`)
      .set('Cookie', bob.cookie)
      .send({ role: 'super_admin' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/churches/${bob.churchId}/staff/${ada.body.id}`)
      .set('Cookie', bob.cookie)
      .expect(404);

    // A cross-tenant staff id used as a pagination cursor must 400, not
    // silently resolve — Prisma's cursor subquery ignores the tenant `where`
    // clause, so an unchecked cursor would let bob's church use alice's
    // staff id as a positional oracle into a roster it can't see.
    await request(app.getHttpServer())
      .get(`/churches/${bob.churchId}/staff`)
      .query({ cursor: ada.body.id })
      .set('Cookie', bob.cookie)
      .expect(400);
  });

  it('walks a real roster forward then backward with no repeats or skips', async () => {
    const { cookie, churchId } = await createAuthedChurchWithRegion(app);

    // Deliberately non-alphabetical insertion order, so a passing test can't
    // be explained by "it happened to already be in order."
    const staffToCreate = [
      { fullName: 'Chidi Obi', email: 'chidi@example.com' },
      { fullName: 'Amaka Obi', email: 'amaka@example.com' },
      { fullName: 'Bola Obi', email: 'bola@example.com' },
    ];
    for (const { fullName, email } of staffToCreate) {
      await request(app.getHttpServer())
        .post(`/churches/${churchId}/staff`)
        .set('Cookie', cookie)
        .send({ fullName, email, role: 'finance' })
        .expect(201);
    }

    const first = await request(app.getHttpServer())
      .get(`/churches/${churchId}/staff`)
      .query({ limit: 2 })
      .set('Cookie', cookie)
      .expect(200);

    expect(first.body.hasNextPage).toBe(true);
    expect(first.body.hasPreviousPage).toBe(false);

    const second = await request(app.getHttpServer())
      .get(`/churches/${churchId}/staff`)
      .query({ limit: 2, cursor: first.body.endCursor })
      .set('Cookie', cookie)
      .expect(200);

    const firstIds = first.body.items.map((s: { id: string }) => s.id);
    const secondIds = second.body.items.map((s: { id: string }) => s.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
    expect(second.body.hasPreviousPage).toBe(true);

    // Which page each name lands on depends on where the seeded super_admin's
    // name sorts, so order is asserted across both concatenated pages.
    const walkedNames = [...first.body.items, ...second.body.items].map(
      (s: { fullName: string }) => s.fullName,
    );
    expect(walkedNames.filter((n: string) => n.endsWith(' Obi'))).toEqual([
      'Amaka Obi',
      'Bola Obi',
      'Chidi Obi',
    ]);

    const back = await request(app.getHttpServer())
      .get(`/churches/${churchId}/staff`)
      .query({ limit: 2, direction: 'backward', cursor: second.body.startCursor })
      .set('Cookie', cookie)
      .expect(200);

    expect(back.body.items.map((s: { id: string }) => s.id)).toEqual(firstIds);
  });

  it('409s deleting the last super_admin of a church', async () => {
    const alice = await createAuthedChurch(app);

    await request(app.getHttpServer())
      .delete(`/churches/${alice.churchId}/staff/${alice.staffId}`)
      .set('Cookie', alice.cookie)
      .expect(409);
  });

  it('409s demoting the last super_admin to any other role', async () => {
    const alice = await createAuthedChurch(app);

    await request(app.getHttpServer())
      .patch(`/churches/${alice.churchId}/staff/${alice.staffId}`)
      .set('Cookie', alice.cookie)
      .send({ role: 'recorder' })
      .expect(409);
  });

  it('allows deleting or demoting a super_admin when another one remains', async () => {
    // Alice acts as the roster manager throughout and is never herself a target,
    // so her own authority never changes mid-test — bob and carol are the ones
    // whose super_admin status is being reduced, one at a time.
    const alice = await createAuthedChurch(app);
    const bob = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({ fullName: 'Bob Second', email: 'bob@example.test', role: 'super_admin' })
      .expect(201);
    const carol = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({ fullName: 'Carol Third', email: 'carol@example.test', role: 'super_admin' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/churches/${alice.churchId}/staff/${bob.body.id}`)
      .set('Cookie', alice.cookie)
      .send({ role: 'finance' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/churches/${alice.churchId}/staff/${carol.body.id}`)
      .set('Cookie', alice.cookie)
      .expect(204);
  });

  it('under two near-simultaneous demotions of a two-super_admin church, exactly one succeeds', async () => {
    // Alice and Bob each act with their own session, each demoting the OTHER —
    // not themselves — so neither request's own caller authority is invalidated
    // by the other's write. This isolates the race to the actual invariant under
    // test (does the church keep at least one super_admin) rather than also
    // racing whichever request happens to touch the caller's own row first.
    const alice = await createAuthedChurch(app);
    const bobStaff = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({ fullName: 'Bob Second', email: 'bob-race@example.test', role: 'super_admin' })
      .expect(201);
    const bobCookie = await acceptInviteAndGetCookie(
      app,
      bobStaff.body.invite.token,
      bobStaff.body.email,
    );

    const [aliceDemotesBob, bobDemotesAlice] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/churches/${alice.churchId}/staff/${bobStaff.body.id}`)
        .set('Cookie', alice.cookie)
        .send({ role: 'finance' }),
      request(app.getHttpServer())
        .patch(`/churches/${alice.churchId}/staff/${alice.staffId}`)
        .set('Cookie', bobCookie)
        .send({ role: 'finance' }),
    ]);

    const statuses = [aliceDemotesBob.status, bobDemotesAlice.status];
    expect(statuses).toContain(200);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);

    const remaining = await prisma.staff.count({
      where: { churchId: alice.churchId, role: 'super_admin' },
    });
    expect(remaining).toBe(1);
  });

  it('under two near-simultaneous deletions of a two-super_admin church, exactly one succeeds', async () => {
    // Same shape as the demotion race above, but for remove — the shared
    // assertNotLastSuperAdmin locking path needs its own real concurrency proof
    // for delete, not just the mocked unit coverage.
    const alice = await createAuthedChurch(app);
    const bobStaff = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/staff`)
      .set('Cookie', alice.cookie)
      .send({ fullName: 'Bob Second', email: 'bob-delete-race@example.test', role: 'super_admin' })
      .expect(201);
    const bobCookie = await acceptInviteAndGetCookie(
      app,
      bobStaff.body.invite.token,
      bobStaff.body.email,
    );

    const [aliceDeletesBob, bobDeletesAlice] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/churches/${alice.churchId}/staff/${bobStaff.body.id}`)
        .set('Cookie', alice.cookie),
      request(app.getHttpServer())
        .delete(`/churches/${alice.churchId}/staff/${alice.staffId}`)
        .set('Cookie', bobCookie),
    ]);

    const statuses = [aliceDeletesBob.status, bobDeletesAlice.status];
    expect(statuses).toContain(204);
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);

    const remaining = await prisma.staff.count({
      where: { churchId: alice.churchId, role: 'super_admin' },
    });
    expect(remaining).toBe(1);
  });
});
