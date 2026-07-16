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
    await truncateAll(prisma);
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

    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(regionId);
    expect(list.body[0].name).toBe('Abuja (FCT)');
    expect(list.body[0].state).toBe('FCT');
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

    expect(list.body[0].name).toBe('Abuja Metro');
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

    expect(list.body).toHaveLength(0);
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

    expect(list.body).toHaveLength(0);

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
});
