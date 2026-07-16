import { auth } from '../src/auth/auth';
import { requireOriginList } from '../src/config/env';

/**
 * These assert the auth configuration itself rather than request behaviour.
 *
 * They exist because the enforcement cannot be tested end to end: Better Auth
 * turns the origin check OFF whenever NODE_ENV is "test", which is exactly what
 * vitest sets —
 *
 *   skipOriginCheck: options.advanced?.disableOriginCheck !== undefined
 *     ? options.advanced.disableOriginCheck
 *     : isTest() ? true : false
 *   (better-auth/dist/context/create-context.mjs)
 *
 * So a request-level test of trustedOrigins would pass no matter what the value
 * was, which is worse than no test. Enforcing the list is Better Auth's job and
 * is covered by their suite. Ours is to hand it the right values, which is what
 * these check.
 */
describe('Auth configuration', () => {
  it('reads trustedOrigins from WEB_ORIGIN instead of a hardcoded value', () => {
    expect(auth.options.trustedOrigins).toEqual(requireOriginList('WEB_ORIGIN'));

    // .env.test deliberately points WEB_ORIGIN at a different port from the
    // literal this replaced, so reintroducing the hardcode fails here.
    expect(auth.options.trustedOrigins).not.toContain('http://localhost:3000');
  });

  it('reads the session secret and base URL from the environment', () => {
    expect(auth.options.secret).toBe(process.env.BETTER_AUTH_SECRET);
    expect(auth.options.baseURL).toBe(process.env.BETTER_AUTH_URL);
  });

  it('enables Google only because both credentials are configured', () => {
    expect(Object.keys(auth.options.socialProviders ?? {})).toEqual(['google']);
  });
});

describe('requireOriginList', () => {
  const VAR = 'KORU_TEST_ORIGIN_FIXTURE';

  afterEach(() => {
    delete process.env[VAR];
  });

  it('accepts and normalises a list of origins', () => {
    process.env[VAR] = 'http://localhost:4000, https://app.koru.ng';
    expect(requireOriginList(VAR)).toEqual(['http://localhost:4000', 'https://app.koru.ng']);
  });

  it('rejects an origin with no scheme, which would silently never match', () => {
    process.env[VAR] = 'localhost:4000';
    expect(() => requireOriginList(VAR)).toThrow(/not http or https|not a valid URL/);
  });

  it('rejects an origin carrying a path, which would silently never match', () => {
    process.env[VAR] = 'https://app.koru.ng/dashboard';
    expect(() => requireOriginList(VAR)).toThrow(/has a path/);
  });

  it('throws when the variable is missing entirely', () => {
    expect(() => requireOriginList(VAR)).toThrow(/Missing required environment variable/);
  });
});
