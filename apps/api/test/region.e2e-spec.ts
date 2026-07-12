import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './db-utils';

async function createChurch(app: INestApplication, name = 'Celebration Church') {
  const res = await request(app.getHttpServer()).post('/churches').send({ name });
  return res.body as { id: string };
}

async function createRegion(
  app: INestApplication,
  churchId: string,
  date: { name: string; state: string } = { name: 'Abuja (FCT)', state: 'FCT' },
) {
  const res = await request(app.getHttpServer())
    .post(`/churches/${churchId}/regions`)
    .send(date)
    .expect(201);

  return res.body as { id: string; name: string; state: string };
}

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
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);

    expect(region.name).toBe('Abuja (FCT)');
    expect(region.state).toBe('FCT');

    const list = await request(app.getHttpServer())
      .get(`/churches/${church.id}/regions`)
      .expect(200);

    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(region.id);
  });

  it('renames a region', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);

    await request(app.getHttpServer())
      .patch(`/churches/${church.id}/regions/${region.id}`)
      .send({ name: 'Abuja Metro' })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/churches/${church.id}/regions`)
      .expect(200);
    expect(list.body[0].name).toBe('Abuja Metro');
  });

  it('rejects a duplicate region name within the same church, allows it in another church', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    await createRegion(app, churchA.id);

    // same name in the same church should fail with a 409 Conflict (unique constraint → P2002 → ConflictException)
    await request(app.getHttpServer())
      .post(`/churches/${churchA.id}/regions`)
      .send({ name: 'Abuja (FCT)', state: 'FCT' })
      .expect(409);

    // same name, DIFFERENT church → fine (constraint is [churchId, name])
    await createRegion(app, churchB.id);
  });

  it('deletes an empty region with 204', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);

    await request(app.getHttpServer())
      .delete(`/churches/${church.id}/regions/${region.id}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get(`/churches/${church.id}/regions`)
      .expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('refuses to delete a region that still has branches', async () => {
    const church = await createChurch(app);
    const region = await createRegion(app, church.id);

    // todo: No Branch endpoints yet (ticket #5) — seed directly via Prisma.
    // Legitimate for entities without an API; switch to the API once #5 lands.
    await prisma.branch.create({
      data: { churchId: church.id, regionId: region.id, name: 'KORU Abuja' },
    });

    const res = await request(app.getHttpServer())
      .delete(`/churches/${church.id}/regions/${region.id}`)
      .expect(409);
    expect(res.body.message).toContain('branch');
  });

  it('isolates tenants: church B cannot see or touch church A regions', async () => {
    const churchA = await createChurch(app, 'Church A');
    const churchB = await createChurch(app, 'Church B');
    const regionA = await createRegion(app, churchA.id);

    const list = await request(app.getHttpServer())
      .get(`/churches/${churchB.id}/regions`)
      .expect(200);
    expect(list.body).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/churches/${churchB.id}/regions/${regionA.id}`)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('404s for a well-formed but unknown church id', async () => {
    await request(app.getHttpServer())
      .get('/churches/6f9619ff-8b86-d011-b42d-00c04fc964ff/regions')
      .expect(404);
  });
});
