import { afterEach, describe, expect, it, vi } from 'vitest';

const configSpy = vi.fn();
vi.mock('dotenv', () => ({ config: configSpy }));

describe('config/env.ts dotenv gating', () => {
  const originalVitest = process.env.VITEST;

  afterEach(() => {
    if (originalVitest === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = originalVitest;
    }
    configSpy.mockClear();
    vi.resetModules();
  });

  it('does not call dotenv config() when VITEST is set', async () => {
    expect(process.env.VITEST).toBeTruthy();
    vi.resetModules();

    await import('./env.js');

    expect(configSpy).not.toHaveBeenCalled();
  });

  it('calls dotenv config() when VITEST is unset, e.g. the Better Auth CLI', async () => {
    delete process.env.VITEST;
    vi.resetModules();

    await import('./env.js');

    expect(configSpy).toHaveBeenCalledTimes(1);
  });
});
