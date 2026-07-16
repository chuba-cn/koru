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

    expect(list.body.every((s: { passwordHash: unknown }) => s.passwordHash === undefined)).toBe(
      true,
    );

    const ada = list.body.find((s: { email: string }) => s.email === 'ada@example.com');
    expect(ada).toBeDefined();
    expect(ada.scopes).toHaveLength(1);
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

    expect(list.body.map((s: { id: string }) => s.id)).not.toContain(ada.body.id);

    await request(app.getHttpServer())
      .patch(`/churches/${bob.churchId}/staff/${ada.body.id}`)
      .set('Cookie', bob.cookie)
      .send({ role: 'super_admin' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/churches/${bob.churchId}/staff/${ada.body.id}`)
      .set('Cookie', bob.cookie)
      .expect(404);
  });
});
