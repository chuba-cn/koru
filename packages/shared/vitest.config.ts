import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No `globals` — see apps/api/vitest.config.ts for why.
    include: ['src/**/*.spec.ts'],
  },
});
