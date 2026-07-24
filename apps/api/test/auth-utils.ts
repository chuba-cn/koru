import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mailSender } from '../src/notifications/mail-sender';

export type AuthedChurch = {
  cookie: string;
  churchId: string;
  staffId: string;
  userId: string;
  email: string;
};

export type AuthedChurchWithRegion = AuthedChurch & { regionId: string };

type Options = {
  emailPrefix?: string;
  churchName?: string;
  fullName?: string;
  regionName?: string;
  regionState?: string;
};

/**
 * Reads the verification link ConsoleMailSender captured for `email`, follows it,
 * and returns the resulting session cookie. Needed everywhere a test used to type cookies
 * straight off the sign-up response. `requireEmailVerification` in @auth.ts makes sign-up
 * itself return no session
 */
export async function verifyEmailAndGetCookie(
  app: INestApplication,
  email: string,
): Promise<string> {
  const sent = mailSender.lastSentTo?.(email);
  if (!sent) throw new Error(`No verification email captured for ${email}`);

  const href = sent.html.match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error('Verification email had no link to follow');

  const url = new URL(href);
  const res = await request(app.getHttpServer())
    .get(url.pathname)
    .query(Object.fromEntries(url.searchParams))
    .redirects(0);

  const rawCookies = res.headers['set-cookie'];
  if (!rawCookies) throw new Error('Verifying the email did not set a session cookie');
  return Array.isArray(rawCookies) ? rawCookies.join('; ') : String(rawCookies);
}

export async function createAuthedChurch(
  app: INestApplication,
  opts: Options = {},
): Promise<AuthedChurch> {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${opts.emailPrefix ?? 'user'}-${uniq}@example.test`;
  const fullName = opts.fullName ?? 'Test User';

  const signup = await request(app.getHttpServer())
    .post('/api/auth/sign-up/email')
    .send({ name: fullName, email, password: 'correct horse battery' })
    .expect(200);

  const userId = signup.body?.user?.id;
  if (!userId) throw new Error('Sign-up response missing user.id');
  const cookie = await verifyEmailAndGetCookie(app, email);

  const bootstrap = await request(app.getHttpServer())
    .post('/onboarding/church')
    .set('Cookie', cookie)
    .send({ churchName: opts.churchName ?? `Church-${uniq}`, fullName })
    .expect(201);

  return {
    cookie,
    churchId: bootstrap.body.id,
    staffId: bootstrap.body.staff[0].id,
    userId,
    email,
  };
}

export async function createAuthedChurchWithRegion(
  app: INestApplication,
  opts: Options = {},
): Promise<AuthedChurchWithRegion> {
  const church = await createAuthedChurch(app, opts);

  const region = await request(app.getHttpServer())
    .post(`/churches/${church.churchId}/regions`)
    .set('Cookie', church.cookie)
    .send({ name: opts.regionName ?? 'Abuja (FCT)', state: opts.regionState ?? 'FCT' })
    .expect(201);

  return { ...church, regionId: region.body.id };
}
