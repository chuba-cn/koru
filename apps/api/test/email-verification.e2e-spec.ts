import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { getLastEmailLink } from './auth-utils';
import { truncateAll } from './db-utils';

const EMAIL = 'kemi@example.test';
const PASSWORD = 'correct horse battery';

/**
 * Better Auth's own rate limit on POST /api/auth/request-password-reset (3 per
 * 60s, its default, untouched by our customRules) defaults to an in-memory
 * store that truncateAll cannot reset between tests. This file's calls to that
 * route already spend the full budget: 2 in the reset-flow test, 1 in the
 * already-used-token test. Do not add a fourth anywhere in this file — the
 * expired-token test below constructs its Verification row directly instead
 * of calling the route, specifically to stay within budget.
 */
describe('Email verification and password reset (e2e)', () => {
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

  it('a direct sign-up receives a verification email and cannot sign in until it clicks through', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Kemi', email: EMAIL, password: PASSWORD })
      .expect(200);

    const url = getLastEmailLink(EMAIL);
    expect(url.pathname).toBe('/api/auth/verify-email');
    expect(url.searchParams.get('token')).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(403);

    const verify = await request(app.getHttpServer())
      .get(url.pathname)
      .query(Object.fromEntries(url.searchParams))
      .redirects(0);
    expect(String(verify.headers['set-cookie'])).toContain('session_token');

    const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL } });
    expect(user.emailVerified).toBe(true);

    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
  });

  it('request-password-reset sends a reset email and the token changes the password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Kemi', email: EMAIL, password: PASSWORD })
      .expect(200);

    const known = await request(app.getHttpServer())
      .post('/api/auth/request-password-reset')
      .send({ email: EMAIL })
      .expect(200);

    const unknown = await request(app.getHttpServer())
      .post('/api/auth/request-password-reset')
      .send({ email: 'nobody@example.test' })
      .expect(200);

    expect(known.body).toEqual(unknown.body);

    const url = getLastEmailLink(EMAIL);
    expect(url.pathname.startsWith('/api/auth/reset-password/')).toBe(true);
    const token = url.pathname.split('/').pop();
    expect(token).toBeTruthy();

    const NEW_PASSWORD = 'new correct horse battery';
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ newPassword: NEW_PASSWORD, token })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: EMAIL, password: NEW_PASSWORD })
      .expect(403); // still needs the verification from sign-up — unrelated to the reset

    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(401); // old password is dead
  });

  it('rejects an already-used reset token', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Kemi', email: EMAIL, password: PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/request-password-reset')
      .send({ email: EMAIL })
      .expect(200);

    const token = getLastEmailLink(EMAIL).pathname.split('/').pop();

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ newPassword: 'first new password', token })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ newPassword: 'second new password', token })
      .expect(400);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired reset token', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Kemi', email: EMAIL, password: PASSWORD })
      .expect(200);

    const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL } });
    const token = 'test-expired-reset-token';
    await prisma.verification.create({
      data: {
        id: 'test-verification-expired',
        identifier: `reset-password:${token}`,
        value: user.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ newPassword: 'new correct horse battery', token })
      .expect(400);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });
});
