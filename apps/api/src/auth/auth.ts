import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { BetterAuthOptions } from 'better-auth';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI } from 'better-auth/plugins';
import { requireEnv, requireEnvPairOrNone, requireOriginList } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

/** Better Auth reads both of these as SECONDS, not milliseconds. */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/**
 * We setup Better Auth with its own prisma client (same database, different pool).
 * We do this because it can't reuse the Nest managed PrismaService because this file
 * must always be loadable by the Better Auth CLI outside of Nestjs. Two small pools is fine.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});

/**
 * Google is optional. Both set enables it, neither disables it, and exactly one
 * is treated as an error because that is a typo rather than a choice.
 *
 * Annotated rather than spread inline so TypeScript still catches a misspelled
 * option key — an object spread drops excess-property checking.
 */
const googleCredentials = requireEnvPairOrNone('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
const socialProviders: BetterAuthOptions['socialProviders'] = googleCredentials
  ? { google: { clientId: googleCredentials.first, clientSecret: googleCredentials.second } }
  : undefined;

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  /**
   * Passed explicitly rather than left to Better Auth's own env lookup. Its
   * fallback is a publicly known constant, and it only refuses to boot when
   * NODE_ENV is exactly "production" — so an unset or differently-named
   * NODE_ENV would sign every session with a secret published on npm.
   */
  secret: requireEnv('BETTER_AUTH_SECRET'),
  baseURL: requireEnv('BETTER_AUTH_URL'),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders,
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  plugins: [openAPI()],
  /**
   * Better Auth checks this for both CSRF/origin validation and for the OAuth
   * callbackURL, so a hardcoded value fails closed in every deployed environment.
   * Comma-separated to allow more than one frontend origin.
   */
  trustedOrigins: requireOriginList('WEB_ORIGIN'),
});
