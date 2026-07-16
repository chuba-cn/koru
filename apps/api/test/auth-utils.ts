import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

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

  const rawCookies = signup.headers['set-cookie'];
  if (!rawCookies) throw new Error('Better Auth did not set a session cookie on sign-up');

  const cookie = Array.isArray(rawCookies) ? rawCookies.join('; ') : String(rawCookies);
  const userId = signup.body?.user?.id;
  if (!userId) throw new Error('Sign-up response missing user.id');

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
