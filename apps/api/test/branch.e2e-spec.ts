import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch, createAuthedChurchWithRegion } from './auth-utils';
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

describe('Branches (e2e)', () => {
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

  it('creates a branch without a region', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/branches`)
      .set('Cookie', cookie)
      .send({ name: 'KORU Abuja', address: '12 Aguiyi Ironsi St' })
      .expect(201);

    expect(res.body.name).toBe('KORU Abuja');
    expect(res.body.regionId).toBeNull();
  });

  it('creates a branch inside a region', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchId}/branches`)
      .set('Cookie', cookie)
      .send({ name: 'KORU Abuja', regionId })
      .expect(201);

    expect(res.body.regionId).toBe(regionId);
  });

  it('rejects a regionId belonging to another church (400, standard shape)', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurchWithRegion(app, { emailPrefix: 'bob' });

    const res = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'KORU Abuja', regionId: bob.regionId })
      .expect(400);

    expect(res.body.error).toBe('BAD_REQUEST');
    expect(res.body.message).toContain('region');
  });

  it('lists all branches and filters by region', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    await request(app.getHttpServer())
      .post(`/churches/${churchId}/branches`)
      .set('Cookie', cookie)
      .send({ name: 'KORU Abuja', regionId })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/churches/${churchId}/branches`)
      .set('Cookie', cookie)
      .send({ name: 'Usai' })
      .expect(201);

    const all = await request(app.getHttpServer())
      .get(`/churches/${churchId}/branches`)
      .set('Cookie', cookie)
      .expect(200);

    expect(all.body.items).toHaveLength(2);
    expect(all.body.totalCount).toBe(2);

    const filtered = await request(app.getHttpServer())
      .get(`/churches/${churchId}/branches?regionId=${regionId}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].name).toBe('KORU Abuja');
  });

  it('moves a branch to another region, then clears the region with null', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const abujaRes = await request(app.getHttpServer())
      .post(`/churches/${churchId}/regions`)
      .set('Cookie', cookie)
      .send({ name: 'Abuja (FCT)', state: 'FCT' })
      .expect(201);

    const lagosRes = await request(app.getHttpServer())
      .post(`/churches/${churchId}/regions`)
      .set('Cookie', cookie)
      .send({ name: 'Lagos', state: 'Lagos' })
      .expect(201);

    const branch = await request(app.getHttpServer())
      .post(`/churches/${churchId}/branches`)
      .set('Cookie', cookie)
      .send({ name: 'KORU Abuja', regionId: abujaRes.body.id })
      .expect(201);

    const moved = await request(app.getHttpServer())
      .patch(`/churches/${churchId}/branches/${branch.body.id}`)
      .set('Cookie', cookie)
      .send({ regionId: lagosRes.body.id })
      .expect(200);

    expect(moved.body.regionId).toBe(lagosRes.body.id);
    expect(moved.body.name).toBe('KORU Abuja');

    const cleared = await request(app.getHttpServer())
      .patch(`/churches/${churchId}/branches/${branch.body.id}`)
      .set('Cookie', cookie)
      .send({ regionId: null })
      .expect(200);

    expect(cleared.body.regionId).toBeNull();
  });

  it('rejects a duplicate branch name within a church (409), allows across churches', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'KORU Abuja' })
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'KORU Abuja' })
      .expect(409);

    expect(dup.body.error).toBe('CONFLICT');

    await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/branches`)
      .set('Cookie', bob.cookie)
      .send({ name: 'KORU Abuja' })
      .expect(201);
  });

  it('isolates tenants: church B cannot see or update church A branches', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    const branch = await createBranch(app, alice.churchId, alice.cookie);

    const list = await request(app.getHttpServer())
      .get(`/churches/${bob.churchId}/branches`)
      .set('Cookie', bob.cookie)
      .expect(200);

    expect(list.body.items).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/churches/${bob.churchId}/branches/${branch.id}`)
      .set('Cookie', bob.cookie)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('rejects a malformed regionId query param (400, standard shape)', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const res = await request(app.getHttpServer())
      .get(`/churches/${churchId}/branches?regionId=not-a-uuid`)
      .set('Cookie', cookie)
      .expect(400);

    expect(res.body.error).toBe('BAD_REQUEST');
    expect(res.body.errors.regionId).toBeDefined();
  });

  it('scopes a regional_admin to branches inside their region, and rejects an out-of-scope cursor', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const otherRegion = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Lagos', state: 'Lagos' })
      .expect(201);

    const inRegion = await createBranch(app, alice.churchId, alice.cookie, 'Ikeja');
    await request(app.getHttpServer())
      .patch(`/churches/${alice.churchId}/branches/${inRegion.id}`)
      .set('Cookie', alice.cookie)
      .send({ regionId: alice.regionId })
      .expect(200);
    const outOfRegion = await request(app.getHttpServer())
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

    const list = await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .expect(200);

    const ids = list.body.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(inRegion.id);
    expect(ids).not.toContain(outOfRegion.body.id);

    await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/branches`)
      .query({ cursor: outOfRegion.body.id })
      .set('Cookie', alice.cookie)
      .expect(400);
  });

  it('scopes a branch_admin to only their own branch, not a peer branch in the same region', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const own = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Ikeja', regionId: alice.regionId })
      .expect(201);
    const peer = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Surulere', regionId: alice.regionId })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'branch_admin',
        scopes: { create: [{ scopeType: 'branch', scopeRefId: own.body.id }] },
      },
    });

    const list = await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/branches`)
      .set('Cookie', alice.cookie)
      .expect(200);

    const ids = list.body.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(own.body.id);
    expect(ids).not.toContain(peer.body.id);
  });

  it('walks a real roster forward then backward with no repeats or skips', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    for (const name of ['Ikeja', 'Abuja Central', 'Garki']) {
      await request(app.getHttpServer())
        .post(`/churches/${churchId}/branches`)
        .set('Cookie', cookie)
        .send({ name })
        .expect(201);
    }

    const first = await request(app.getHttpServer())
      .get(`/churches/${churchId}/branches`)
      .query({ limit: 2 })
      .set('Cookie', cookie)
      .expect(200);

    expect(first.body.hasNextPage).toBe(true);
    expect(first.body.hasPreviousPage).toBe(false);

    const second = await request(app.getHttpServer())
      .get(`/churches/${churchId}/branches`)
      .query({ limit: 2, cursor: first.body.endCursor })
      .set('Cookie', cookie)
      .expect(200);

    const firstIds = first.body.items.map((b: { id: string }) => b.id);
    const secondIds = second.body.items.map((b: { id: string }) => b.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
    expect(second.body.hasPreviousPage).toBe(true);

    const walkedNames = [...first.body.items, ...second.body.items].map(
      (b: { name: string }) => b.name,
    );
    expect(walkedNames).toEqual(['Abuja Central', 'Garki', 'Ikeja']);

    const back = await request(app.getHttpServer())
      .get(`/churches/${churchId}/branches`)
      .query({ limit: 2, direction: 'backward', cursor: second.body.startCursor })
      .set('Cookie', cookie)
      .expect(200);

    expect(back.body.items.map((b: { id: string }) => b.id)).toEqual(firstIds);
  });
});
