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

    expect(all.body).toHaveLength(2);

    const filtered = await request(app.getHttpServer())
      .get(`/churches/${churchId}/branches?regionId=${regionId}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].name).toBe('KORU Abuja');
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

    expect(list.body).toHaveLength(0);

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
});
