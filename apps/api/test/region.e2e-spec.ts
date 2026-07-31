import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch, createAuthedChurchWithRegion } from './auth-utils';
import { truncateAll } from './db-utils';

describe('Region (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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

  it('creates a region and lists it', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchId}/regions`)
      .set('Cookie', cookie)
      .expect(200);

    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(regionId);
    expect(list.body.items[0].name).toBe('Abuja (FCT)');
    expect(list.body.items[0].state).toBe('FCT');
    expect(list.body.totalCount).toBe(1);
  });

  it('renames a region', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    await request(app.getHttpServer())
      .patch(`/churches/${churchId}/regions/${regionId}`)
      .set('Cookie', cookie)
      .send({ name: 'Abuja Metro' })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchId}/regions`)
      .set('Cookie', cookie)
      .expect(200);

    expect(list.body.items[0].name).toBe('Abuja Metro');
  });

  it('rejects a duplicate region name within the same church, allows it in another church', async () => {
    const alice = await createAuthedChurch(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Abuja (FCT)', state: 'FCT' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Abuja (FCT)', state: 'FCT' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/churches/${bob.churchId}/regions`)
      .set('Cookie', bob.cookie)
      .send({ name: 'Abuja (FCT)', state: 'FCT' })
      .expect(201);
  });

  it('deletes an empty region with 204', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    await request(app.getHttpServer())
      .delete(`/churches/${churchId}/regions/${regionId}`)
      .set('Cookie', cookie)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchId}/regions`)
      .set('Cookie', cookie)
      .expect(200);

    expect(list.body.items).toHaveLength(0);
  });

  it('refuses to delete a region that still has branches', async () => {
    const { cookie, churchId, regionId } = await createAuthedChurchWithRegion(app);

    await prisma.branch.create({
      data: { churchId, regionId, name: 'KORU Abuja' },
    });

    const res = await request(app.getHttpServer())
      .delete(`/churches/${churchId}/regions/${regionId}`)
      .set('Cookie', cookie)
      .expect(409);

    expect(res.body.message).toContain('branch');
  });

  it('isolates tenants: church B cannot see or touch church A regions', async () => {
    const alice = await createAuthedChurchWithRegion(app, { emailPrefix: 'alice' });
    const bob = await createAuthedChurch(app, { emailPrefix: 'bob' });

    const list = await request(app.getHttpServer())
      .get(`/churches/${bob.churchId}/regions`)
      .set('Cookie', bob.cookie)
      .expect(200);

    expect(list.body.items).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/churches/${bob.churchId}/regions/${alice.regionId}`)
      .set('Cookie', bob.cookie)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('404s when patching a well-formed but unknown region id', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    await request(app.getHttpServer())
      .patch(`/churches/${churchId}/regions/6f9619ff-8b86-d011-b42d-00c04fc964ff`)
      .set('Cookie', cookie)
      .send({ name: 'Ghost' })
      .expect(404);
  });

  it('scopes a regional_admin to their own region, and rejects an out-of-scope cursor', async () => {
    const alice = await createAuthedChurchWithRegion(app);
    const otherRegion = await request(app.getHttpServer())
      .post(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .send({ name: 'Lagos', state: 'Lagos' })
      .expect(201);

    await prisma.staff.update({
      where: { id: alice.staffId },
      data: {
        role: 'regional_admin',
        scopes: { create: [{ scopeType: 'region', scopeRefId: alice.regionId }] },
      },
    });

    const list = await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .expect(200);

    const ids = list.body.items.map((r: { id: string }) => r.id);
    expect(ids).toContain(alice.regionId);
    expect(ids).not.toContain(otherRegion.body.id);

    await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/regions`)
      .query({ cursor: otherRegion.body.id })
      .set('Cookie', alice.cookie)
      .expect(400);
  });

  it('lets a branch-scoped caller see the region containing their branch', async () => {
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

    const list = await request(app.getHttpServer())
      .get(`/churches/${alice.churchId}/regions`)
      .set('Cookie', alice.cookie)
      .expect(200);

    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(alice.regionId);
  });
});
