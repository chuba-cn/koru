import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './db-utils';

async function createChurch(app: INestApplication, name = 'Celebration Church') {
  const res = await request(app.getHttpServer()).post('/churches').send({ name }).expect(201);
  return res.body as { id: string };
}

async function createRegion(app: INestApplication, churchId: string, name = 'Abuja (FCT)') {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/regions`)
    .send({ name, state: 'FCT' })
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
    const church = await createChurch(app);
    const res = await request(app.getHttpServer())
      .post(`/churches/${church.id}/branches`)
      .send({ name: 'KORU Abuja', address: '12 Aguiyi Ironsi St' })
      .expect(201);

    expect(res.body.name).toBe('KORU Abuja');
    expect(res.body.regionId).toBeNull();
  });

  it('creates a branch inside a region', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);
    const res = await request(app.getHttpServer())
      .post(`/churches/${church.id}/branches`)
      .send({ name: 'KORU Abuja', regionId: region.id })
      .expect(201);

    expect(res.body.regionId).toBe(region.id);
  });

  it('rejects a regionId belonging to another church (400, standard shape)', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    const regionB = await createRegion(app, churchB.id);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/branches`)
      .send({ name: 'KORU Abuja', regionId: regionB.id })
      .expect(400);

    expect(res.body.error).toBe('BAD_REQUEST');
    expect(res.body.message).toContain('region');
  });

  it('lists all branches and filters by region', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);
    await request(app.getHttpServer())
      .post(`/churches/${church.id}/branches`)
      .send({ name: 'KORU Abuja', regionId: region.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/churches/${church.id}/branches`)
      .send({ name: 'Usai' })
      .expect(201);

    const all = await request(app.getHttpServer())
      .get(`/churches/${church.id}/branches`)
      .expect(200);
    expect(all.body).toHaveLength(2);

    const filtered = await request(app.getHttpServer())
      .get(`/churches/${church.id}/branches?regionId=${region.id}`)
      .expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].name).toBe('KORU Abuja');
  });

  it('moves a branch to another region, then clears the region with null', async () => {
    const church = await createChurch(app);
    const abuja = await createRegion(app, church.id, 'Abuja (FCT)');
    const lagos = await createRegion(app, church.id, 'Lagos');
    const branch = await request(app.getHttpServer())
      .post(`/churches/${church.id}/branches`)
      .send({ name: 'KORU Abuja', regionId: abuja.id })
      .expect(201);

    // move: regionId present with a value
    const moved = await request(app.getHttpServer())
      .patch(`/churches/${church.id}/branches/${branch.body.id}`)
      .send({ regionId: lagos.id })
      .expect(200);
    expect(moved.body.regionId).toBe(lagos.id);
    expect(moved.body.name).toBe('KORU Abuja'); // absent field untouched

    // clear: regionId explicitly null
    const cleared = await request(app.getHttpServer())
      .patch(`/churches/${church.id}/branches/${branch.body.id}`)
      .send({ regionId: null })
      .expect(200);
    expect(cleared.body.regionId).toBeNull();
  });

  it('rejects a duplicate branch name within a church (409), allows across churches', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/branches`)
      .send({ name: 'KORU Abuja' })
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/branches`)
      .send({ name: 'KORU Abuja' })
      .expect(409);
    expect(dup.body.error).toBe('CONFLICT');

    await request(app.getHttpServer())
      .post(`/churches/${churchB.id}/branches`)
      .send({ name: 'KORU Abuja' })
      .expect(201);
  });

  it('isolates tenants: church B cannot see or update church A branches', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    const branch = await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/branches`)
      .send({ name: 'KORU Abuja' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchB.id}/branches`)
      .expect(200);
    expect(list.body).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/churches/${churchB.id}/branches/${branch.body.id}`)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('rejects a malformed regionId query param (400, standard shape)', async () => {
    const church = await createChurch(app);
    const res = await request(app.getHttpServer())
      .get(`/churches/${church.id}/branches?regionId=not-a-uuid`)
      .expect(400);
    expect(res.body.error).toBe('BAD_REQUEST');
    expect(res.body.errors.regionId).toBeDefined();
  });
});
