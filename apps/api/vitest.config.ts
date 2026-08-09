import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    root: './',
    /**
     * auth.ts validates its configuration at import time, and any spec that
     * touches a controller pulls it in transitively. So the unit layer needs
     * these vars *present* — it never opens a connection with them, because
     * PrismaClient does not dial the database until a query is issued.
     *
     * Declared here rather than relying on a local .env, which CI does not
     * have. Without this the suite passes on a developer machine and fails on
     * a clean runner.
     */
    env: {
      DATABASE_URL: 'postgresql://unit:unit@localhost:5432/unit_tests_never_connect',
      BETTER_AUTH_SECRET: 'unit-test-value-never-signs-anything-real',
      BETTER_AUTH_URL: 'http://localhost:3001',
      WEB_ORIGIN: 'http://localhost:3000',
      SUPPORT_EMAIL: 'support@example.test',
      SUPPORT_PHONE: '+234 000 000 0000',
      LOGO_URL: 'https://example.test/logo.png',
      RESEND_WEBHOOK_SECRET: 'unit-test-value-never-verifies-anything-real',
      PAYSTACK_SECRET_KEY: 'unit-test-value-never-calls-paystack',
      PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN: 'giving.koru.ng',
      SETTLEMENT_ACCOUNT_HASH_PEPPER: 'unit-test-pepper-never-hashes-anything-real',
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
