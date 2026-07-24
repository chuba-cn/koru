import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController wiring', () => {
  /**
   * A health check must answer even when Better Auth or the session store is
   * down, which is exactly the situation an uptime monitor calls this for.
   */
  it('is public at the class level, so both routes work without a session', () => {
    expect(Reflect.getMetadata('PUBLIC', HealthController)).toBe(true);
  });

  it('carries no tenant or role guard', () => {
    const guardsOf = (target: object) =>
      (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

    expect(guardsOf(HealthController)).toEqual([]);
  });
});

describe('HealthController.checkRedis', () => {
  it('reports ok when the queue client pings successfully', async () => {
    const emailQueue = { client: Promise.resolve({ info: vi.fn().mockResolvedValue('# Server') }) };
    const controller = new HealthController({} as never, emailQueue as never);

    await expect(controller.checkRedis()).resolves.toEqual({ status: 'ok', redis: 'reachable' });
  });

  it('reports error when the ping itself fails, not just an unresolved client', async () => {
    const emailQueue = {
      client: Promise.resolve({ info: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }),
    };
    const controller = new HealthController({} as never, emailQueue as never);

    await expect(controller.checkRedis()).resolves.toEqual({
      status: 'error',
      redis: 'unreachable',
    });
  });
});
