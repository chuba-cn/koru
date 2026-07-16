import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { requireOriginList } from '../src/config/env';

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

/**
 * Reuses the app's own parser rather than re-implementing it, so the test cannot
 * drift into accepting an origin the app would reject.
 */
function webOrigin(): string {
  return requireOriginList('WEB_ORIGIN')[0];
}

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

/**
 * Fakes only Google's token endpoint — the single call that leaves our process.
 * Everything else (state, cookies, session creation, our guards) runs for real.
 *
 * Two constraints this depends on:
 *
 * 1. `globalThis.fetch` is process-global, so this requires serial execution. It
 *    breaks the moment anyone adds `test.concurrent` or flips `fileParallelism`
 *    in vitest.e2e.config.ts.
 * 2. The fake id token is signed with the literal string "fake-signature" and
 *    Better Auth accepts it, because the authorization-code flow deliberately
 *    does not verify the signature — it trusts the TLS-authenticated token
 *    endpoint. These helpers therefore prove callback plumbing, NOT token
 *    authenticity. Do not extend them to cover a direct id-token sign-in flow:
 *    they would happily green-light a forged token.
 */
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
  const callbackURL = opts.callbackURL ?? `${webOrigin()}/dashboard`;
  const errorCallbackURL = opts.errorCallbackURL ?? `${webOrigin()}/auth-error`;

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
  const callbackURL = opts.callbackURL ?? `${webOrigin()}/account/connections`;
  const errorCallbackURL = opts.errorCallbackURL ?? `${webOrigin()}/account/connections/error`;

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
