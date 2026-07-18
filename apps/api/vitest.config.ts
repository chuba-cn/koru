import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No `globals`. Unit specs live under src/, which is type-checked and built,
    // so ambient test globals there would let a stray expect() or vi.fn() in a
    // service compile and ship, failing only at runtime. Specs import from
    // 'vitest' explicitly instead. (e2e lives in test/, outside both, so its
    // config can keep globals.)
    include: ['src/**/*.spec.ts'],
    root: './',
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
