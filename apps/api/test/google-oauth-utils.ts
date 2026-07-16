import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

function fakeGoogleIdToken(claims: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode(header)}.${encode(claims)}.fake-signature`;
}

type FakeGoogleProfile = {
  sub: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
};

type FakeGoogleOptions = {
  callbackURL?: string;
  errorCallbackURL?: string;
  brokenTokenExchange?: boolean;
};

function extractState(authorizeUrl: string): string {
  const state = new URL(authorizeUrl).searchParams.get('state');
  if (!state) throw new Error('Better Auth did not return a state param in the authorize URL');

  return state;
}

function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return '';
  const jar = Array.isArray(setCookie) ? setCookie : [setCookie];
  return jar.map((c) => c.split(';')[0]).join('; ');
}

function mergeCookies(...headers: Array<string | undefined>): string {
  return headers.filter(Boolean).join('; ');
}

async function runFakeGoogleCallback(
  app: INestApplication,
  state: string,
  requestCookie: string,
  profile: FakeGoogleProfile,
  opts: FakeGoogleOptions,
): Promise<{ location: string | undefined; cookie: string | undefined }> {
  const idToken = fakeGoogleIdToken({
    sub: profile.sub,
    email: profile.email,
    email_verified: profile.emailVerified ?? true,
    name: profile.name ?? 'Test Staff',
    picture: 'https://example.test/avatar.png',
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInit | URL) => {
    const url = String(input);
    if (!url.startsWith('https://oauth2.googleapis.com/token')) {
      throw new Error(`Unexpected fetch during faked Google flow: ${url}`);
    }
    if (opts.brokenTokenExchange) {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        access_token: 'fake-access-token',
        id_token: idToken,
        token_type: 'Bearer',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const callback = await request(app.getHttpServer())
      .get(`/api/auth/callback/google?code=fake-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', requestCookie)
      .redirects(0);

    const rawCookies = callback.headers['set-cookie'];
    const cookie = rawCookies
      ? Array.isArray(rawCookies)
        ? rawCookies.join('; ')
        : String(rawCookies)
      : undefined;

    return { location: callback.headers.location, cookie };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function signInWithFakeGoogle(
  app: INestApplication,
  profile: FakeGoogleProfile,
  opts: FakeGoogleOptions = {},
): Promise<{ location: string | undefined; cookie: string | undefined }> {
  const callbackURL = opts.callbackURL ?? 'http://localhost:3000/dashboard';
  const errorCallbackURL = opts.errorCallbackURL ?? 'http://localhost:3000/auth-error';

  const start = await request(app.getHttpServer())
    .post('/api/auth/sign-in/social')
    .send({ provider: 'google', callbackURL, errorCallbackURL })
    .expect(200);

  const stateCookie = toCookieHeader(start.headers['set-cookie']);

  return runFakeGoogleCallback(app, extractState(start.body.url), stateCookie, profile, opts);
}

export async function linkFakeGoogleAccount(
  app: INestApplication,
  cookie: string,
  profile: FakeGoogleProfile,
  opts: FakeGoogleOptions = {},
): Promise<{ location: string | undefined }> {
  const callbackURL = opts.callbackURL ?? 'http://localhost:3000/account/connections';
  const errorCallbackURL =
    opts.errorCallbackURL ?? 'http://localhost:3000/account/connections/error';

  const start = await request(app.getHttpServer())
    .post('/api/auth/link-social')
    .set('Cookie', cookie)
    .send({ provider: 'google', callbackURL, errorCallbackURL })
    .expect(200);

  const stateCookie = toCookieHeader(start.headers['set-cookie']);

  const { location } = await runFakeGoogleCallback(
    app,
    extractState(start.body.url),
    mergeCookies(cookie, stateCookie),
    profile,
    opts,
  );
  return { location };
}
