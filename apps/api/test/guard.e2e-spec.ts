import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

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
});
