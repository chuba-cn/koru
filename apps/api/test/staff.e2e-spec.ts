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

async function createBranch(app: INestApplication, churchId: string, name = 'KORU Abuja') {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/branches`)
    .send({ name })
    .expect(201);
  return res.body as { id: string };
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
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers staff without scopes and never exposes passwordHash', async () => {
    const church = await createChurch(app);
    const res = await request(app.getHttpServer())
      .post(`/churches/${church.id}/staff`)
      .send({ fullName: 'Ada Obi', email: 'ada@example.com', role: 'finance' })
      .expect(201);

    expect(res.body.fullName).toBe('Ada Obi');
    expect(res.body.role).toBe('finance');
    expect(res.body.scopes).toEqual([]);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('registers staff with mixed region + branch scopes in one call', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);
    const branch = await createBranch(app, church.id);

    const res = await request(app.getHttpServer())
      .post(`/churches/${church.id}/staff`)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'regional_admin',
        scopes: [
          { scopeType: 'region', scopeRefId: region.id },
          { scopeType: 'branch', scopeRefId: branch.id },
        ],
      })
      .expect(201);

    expect(res.body.scopes).toHaveLength(2);
    const types = res.body.scopes.map((s: { scopeType: string }) => s.scopeType).sort();
    expect(types).toEqual(['branch', 'region']);
  });

  it('rejects duplicate email within a church (409), allows it in another church', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    const staff = { fullName: 'Ada Obi', email: 'ada@example.com', role: 'finance' };

    await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/staff`)
      .send(staff)
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/staff`)
      .send(staff)
      .expect(409);
    expect(dup.body.error).toBe('CONFLICT');

    await request(app.getHttpServer())
      .post(`/churches/${churchB.id}/staff`)
      .send(staff)
      .expect(201);
  });

  it('rejects scopes referencing another church or nothing at all (400, names the culprits)', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    const branchB = await createBranch(app, churchB.id);

    const res = await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/staff`)
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
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);

    const res = await request(app.getHttpServer())
      .post(`/churches/${church.id}/staff`)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'regional_admin',
        scopes: [
          { scopeType: 'region', scopeRefId: region.id },
          { scopeType: 'region', scopeRefId: region.id },
        ],
      })
      .expect(400);
    expect(res.body.errors.scopes).toBeDefined();
  });

  it('lists staff with their scopes', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);
    await request(app.getHttpServer())
      .post(`/churches/${church.id}/staff`)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'regional_admin',
        scopes: [{ scopeType: 'region', scopeRefId: region.id }],
      })
      .expect(201);

    const list = await request(app.getHttpServer()).get(`/churches/${church.id}/staff`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].scopes).toHaveLength(1);
    expect(list.body[0].passwordHash).toBeUndefined();
  });

  it('updates role via PATCH and replaces scopes wholesale via PUT (empty array clears)', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);
    const branch = await createBranch(app, church.id);

    const staff = await request(app.getHttpServer())
      .post(`/churches/${church.id}/staff`)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'branch_admin',
        scopes: [{ scopeType: 'branch', scopeRefId: branch.id }],
      })
      .expect(201);

    const promoted = await request(app.getHttpServer())
      .patch(`/churches/${church.id}/staff/${staff.body.id}`)
      .send({ role: 'regional_admin' })
      .expect(200);
    expect(promoted.body.role).toBe('regional_admin');
    expect(promoted.body.scopes).toHaveLength(1);

    const replaced = await request(app.getHttpServer())
      .put(`/churches/${church.id}/staff/${staff.body.id}/scopes`)
      .send({ scopes: [{ scopeType: 'region', scopeRefId: region.id }] })
      .expect(200);
    expect(replaced.body.scopes).toHaveLength(1);
    expect(replaced.body.scopes[0].scopeType).toBe('region');

    const cleared = await request(app.getHttpServer())
      .put(`/churches/${church.id}/staff/${staff.body.id}/scopes`)
      .send({ scopes: [] })
      .expect(200);
    expect(cleared.body.scopes).toEqual([]);
  });

  it('deletes staff and cascades their scopes at the DB level', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);
    const staff = await request(app.getHttpServer())
      .post(`/churches/${church.id}/staff`)
      .send({
        fullName: 'Ada Obi',
        email: 'ada@example.com',
        role: 'regional_admin',
        scopes: [{ scopeType: 'region', scopeRefId: region.id }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/churches/${church.id}/staff/${staff.body.id}`)
      .expect(204);

    const orphanCount = await prisma.staffScope.count();
    expect(orphanCount).toBe(0);
  });

  it('isolates tenants: church B cannot see, update, or delete church A staff', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    const staff = await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/staff`)
      .send({ fullName: 'Ada Obi', email: 'ada@example.com', role: 'finance' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchB.id}/staff`)
      .expect(200);
    expect(list.body).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/churches/${churchB.id}/staff/${staff.body.id}`)
      .send({ role: 'super_admin' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/churches/${churchB.id}/staff/${staff.body.id}`)
      .expect(404);
  });
});
