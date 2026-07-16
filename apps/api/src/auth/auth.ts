import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI } from 'better-auth/plugins';
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
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  plugins: [openAPI()],
  trustedOrigins: ['http://localhost:3000'],
});
