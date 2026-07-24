import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { mailSender } from '../src/notifications/mail-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './db-utils';

const EMAIL = 'kemi@example.test';
const PASSWORD = 'correct horse battery';

function linkFor(email: string) {
  const sent = mailSender.lastSentTo?.(email);
  if (!sent) throw new Error(`No email captured for ${email}`);
  const href = sent.html.match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error('Email had no link');
  return new URL(href);
}

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

    const url = linkFor(EMAIL);
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

    const url = linkFor(EMAIL);
    // Better Auth's own link is the GET redirect-callback route, not the POST
    // endpoint we call below — confirmed in dist/api/routes/password.mjs:
    // `${baseURL}/reset-password/${token}?callbackURL=${callbackURL}`. The
    // token is a path segment, and since this test never passes `redirectTo`,
    // `callbackURL` is an empty string — there is no `token` query param at all.
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
});
