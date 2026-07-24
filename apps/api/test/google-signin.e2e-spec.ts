import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthedChurch } from './auth-utils';
import { truncateAll } from './db-utils';
import { linkFakeGoogleAccount, signInWithFakeGoogle } from './google-oauth-utils';

function requireSessionCookie(result: { cookie?: string }): string {
  if (!result.cookie?.includes('session_token')) {
    throw new Error(`Expected a session cookie, got: ${result.cookie ?? '<none>'}`);
  }
  return result.cookie;
}

describe('Google sign-in (e2e)', () => {
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

  it('valid: a Google signup can bootstrap a church, and a later Google login reuses that staff', async () => {
    const email = 'ada@example-church.test';

    const first = await signInWithFakeGoogle(app, { sub: 'google-ada-1', email, name: 'Ada Obi' });
    expect(first.location).toContain('/dashboard');
    expect(first.cookie).toBeDefined();

    const session = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set('Cookie', requireSessionCookie(first))
      .expect(200);
    expect(session.body.user.email).toBe(email);
    expect(JSON.stringify(session.body)).not.toMatch(/accessToken|idToken|refreshToken/i);

    const bootstrap = await request(app.getHttpServer())
      .post('/onboarding/church')
      .set('Cookie', requireSessionCookie(first))
      .send({ churchName: 'Celebration Church', fullName: 'Ada Obi' })
      .expect(201);
    const churchId = bootstrap.body.id;
    expect(bootstrap.body.staff[0].role).toBe('super_admin');
    expect(JSON.stringify(bootstrap.body)).not.toMatch(/accessToken|idToken|refreshToken/i);

    const second = await signInWithFakeGoogle(app, { sub: 'google-ada-1', email, name: 'Ada Obi' });
    expect(second.cookie).toBeDefined();

    await request(app.getHttpServer())
      .get(`/churches/${churchId}`)
      .set('Cookie', requireSessionCookie(second))
      .expect(200);

    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.staff.count({ where: { email } })).toBe(1);
    expect(await prisma.account.count({ where: { providerId: 'google' } })).toBe(1);
  });

  it('invalid: a failed token exchange never issues a session', async () => {
    const result = await signInWithFakeGoogle(
      app,
      { sub: 'google-bad-1', email: 'bad@example-church.test' },
      { brokenTokenExchange: true },
    );

    expect(result.location).toContain('/auth-error');
    expect(result.location).toContain('error=');
    expect(result.cookie ?? '').not.toContain('session_token');
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it('email-mismatch: an anonymous Google sign-in colliding with an unverified password account is rejected, not linked', async () => {
    // Deliberately a raw sign-up, not createAuthedChurch — this test's whole point is an
    // UNVERIFIED colliding account. createAuthedChurch now completes real email verification
    // (requireEmailVerification, #59), so it would produce a verified account and defeat the
    // scenario this test exists to cover.
    const email = 'alice-imposter-target@example-church.test';
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Alice', email, password: 'correct horse battery' })
      .expect(200);

    const result = await signInWithFakeGoogle(app, { sub: 'google-alice-imposter', email });

    expect(result.location).toContain('/auth-error');
    expect(result.location).toContain('error=account_not_linked');
    expect(result.cookie ?? '').not.toContain('session_token');

    expect(await prisma.account.count({ where: { providerId: 'google' } })).toBe(0);
    expect(await prisma.user.count({ where: { email } })).toBe(1);

    // The correct password still 403s here — the account is deliberately unverified, and that's
    // unrelated to the Google-linking rejection above. Proves the rejected Google attempt didn't
    // silently verify or otherwise touch the real account.
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: 'correct horse battery' })
      .expect(403);
  });

  it('linking: an already-logged-in staff member can connect Google to their existing account, then log in with it', async () => {
    const { cookie, email, churchId } = await createAuthedChurch(app, { emailPrefix: 'bola' });

    const link = await linkFakeGoogleAccount(app, cookie, { sub: 'google-bola-1', email });
    expect(link.location).toContain('/account/connections');
    expect(link.location).not.toContain('error=');
    expect(await prisma.account.count({ where: { providerId: 'google' } })).toBe(1);
    expect(await prisma.user.count({ where: { email } })).toBe(1);

    const googleLogin = await signInWithFakeGoogle(app, { sub: 'google-bola-1', email });
    expect(googleLogin.cookie).toBeDefined();

    await request(app.getHttpServer())
      .get(`/churches/${churchId}`)
      .set('Cookie', requireSessionCookie(googleLogin))
      .expect(200);

    expect(await prisma.staff.count({ where: { email } })).toBe(1);
  });
});
