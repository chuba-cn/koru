import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { BetterAuthOptions } from 'better-auth';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI, phoneNumber } from 'better-auth/plugins';
import { requireEnv, requireEnvPairOrNone, requireOriginList } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { smsSender } from '../notifications/sms-sender';

export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/** Nigerian E.164 only — the format every client must send before requesting an OTP. */
const NIGERIAN_E164 = /^\+234[789][01]\d{8}$/;

/**
 * We setup Better Auth with its own prisma client (same database, different pool).
 * We do this because it can't reuse the Nest managed PrismaService because this file
 * must always be loadable by the Better Auth CLI outside of Nestjs. Two small pools is fine.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});

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
  plugins: [
    openAPI(),
    phoneNumber({
      phoneNumberValidator: (phoneNumber) => NIGERIAN_E164.test(phoneNumber),
      expiresIn: 300,
      allowedAttempts: 3,
      sendOTP: ({ phoneNumber, code }) =>
        smsSender.send(phoneNumber, `Your Koru OTP code is: ${code}`),
      signUpOnVerification: {
        getTempEmail: (phoneNumber) => `${phoneNumber.replace('+', '')}@members.koru.invalid`,
        getTempName: (phoneNumber) => phoneNumber,
      },
    }),
  ],
  /**
   * Disabled outside production by default — explicit here so the e2e rate-limit
   * test (and every deployed environment) actually exercises it. The sign-up and
   * sign-in overrides exist only to neutralise Better Auth's own built-in 3-per-10s
   * rule on those paths.
   */
  rateLimit: {
    enabled: true,
    customRules: {
      '/sign-up/*': { window: 10, max: 1000 },
      '/sign-in/*': { window: 10, max: 1000 },
      '/phone-number/send-otp': { window: 60, max: 3 },
    },
  },
  /**
   * Better Auth checks this for both CSRF/origin validation and for the OAuth
   * callbackURL, so a hardcoded value fails closed in every deployed environment.
   * Comma-separated to allow more than one frontend origin.
   */
  trustedOrigins: requireOriginList('WEB_ORIGIN'),
});
