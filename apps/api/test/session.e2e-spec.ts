import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';

describe('Session lifecycle (e2e)', () => {
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

  it('logout ends the current session', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    await request(app.getHttpServer()).post('/api/auth/sign-out').set('Cookie', cookie).expect(200);

    await request(app.getHttpServer())
      .get(`/churches/${churchId}`)
      .set('Cookie', cookie)
      .expect(401);
  });

  it('a revoked session 401s the very next request (not just after logout)', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    const session = await prisma.session.findFirstOrThrow();
    await request(app.getHttpServer())
      .post('/api/auth/revoke-session')
      .set('Cookie', cookie)
      .send({ token: session.token })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/churches/${churchId}`)
      .set('Cookie', cookie)
      .expect(401);
  });

  it('revoke-other-sessions kills every other device but keeps the caller logged in', async () => {
    const { churchId } = await createAuthedChurch(app);
    const email = (await prisma.staff.findFirstOrThrow()).email;

    // Simulate a second device: sign in again with the same credentials.
    const secondSignIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: 'correct horse battery' })
      .expect(200);
    const cookieB = secondSignIn.headers['set-cookie'];
    const secondCookie = Array.isArray(cookieB) ? cookieB.join('; ') : String(cookieB);

    await request(app.getHttpServer())
      .post('/api/auth/revoke-other-sessions')
      .set('Cookie', secondCookie)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/churches/${churchId}`)
      .set('Cookie', secondCookie)
      .expect(200);

    const remaining = await prisma.session.count();
    expect(remaining).toBe(1);
  });

  it('revoke-sessions logs out every device, including the caller', async () => {
    const { cookie, churchId } = await createAuthedChurch(app);

    await request(app.getHttpServer())
      .post('/api/auth/revoke-sessions')
      .set('Cookie', cookie)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/churches/${churchId}`)
      .set('Cookie', cookie)
      .expect(401);

    const remaining = await prisma.session.count();
    expect(remaining).toBe(0);
  });

  it('list-sessions surfaces the active session for a freshly-authenticated user', async () => {
    const { cookie } = await createAuthedChurch(app);

    const res = await request(app.getHttpServer())
      .get('/api/auth/list-sessions')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toHaveLength(1);
  });
});
