import { config } from 'dotenv';

// The one dotenv load auth.ts needs, incl. the Better Auth CLI (which loads
// auth.ts standalone but still imports requireEnv from here). Skipped under
// Vitest, which always sets this: a test run's env is already fully owned by
// test/global-setup.ts or vitest.config.ts's inline `env` block, and a second
// load would silently fill gaps from a developer's real .env, since dotenv's
// plain load never overrides. See #102.
if (!process.env.VITEST) {
  config();
}

/**
 * Reads a required environment variable and throws at boot when it is absent.
 *
 * Failing at boot is deliberate. A missing auth origin or database URL that is
 * merely cast away surfaces much later as an opaque runtime rejection, in
 * production, for a real user.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See apps/api/.env.example`);
  }
  return value;
}

/** Reads a required comma-separated environment variable into a non-empty list. */
export function requireEnvList(name: string): string[] {
  const values = requireEnv(name)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`Environment variable ${name} must list at least one value`);
  }
  return values;
}

/**
 * Reads a comma-separated list of web origins, rejecting anything that is not a
 * bare http(s) origin and normalising each one.
 *
 * Presence alone is not enough here. Better Auth compares origins by exact
 * match, so "localhost:3000" (no scheme) or "https://app.koru.ng/" (trailing
 * slash) would pass a presence check, boot cleanly, and then silently reject
 * every sign-in in production — the same failure this validation exists to
 * prevent, one typo away.
 */
export function requireOriginList(name: string): string[] {
  return requireEnvList(name).map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(
        `Environment variable ${name} contains "${value}", which is not a valid URL. Expected an origin like http://localhost:3000`,
      );
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `Environment variable ${name} contains "${value}", which is not http or https`,
      );
    }

    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error(
        `Environment variable ${name} contains "${value}", which has a path. Expected an origin only, like https://app.koru.ng`,
      );
    }

    return parsed.origin;
  });
}

/**
 * Reads two environment variables that only make sense together.
 *
 * Returns null when both are absent, which means the feature is deliberately not
 * configured for this environment. Throws when exactly one is present, because
 * that is always a mistake rather than an intentional opt-out — and a silent
 * half-configured provider is precisely the failure this guards against.
 */
export function requireEnvPairOrNone(
  firstName: string,
  secondName: string,
): { first: string; second: string } | null {
  const first = process.env[firstName]?.trim();
  const second = process.env[secondName]?.trim();

  if (!first && !second) return null;

  if (!first || !second) {
    const present = first ? firstName : secondName;
    const missing = first ? secondName : firstName;
    throw new Error(
      `${present} is set but ${missing} is missing. Set both, or neither to disable the feature.`,
    );
  }

  return { first, second };
}

export const SUPPORT_EMAIL = requireEnv('SUPPORT_EMAIL');
export const SUPPORT_PHONE = requireEnv('SUPPORT_PHONE');
export const LOGO_URL = requireEnv('LOGO_URL');
