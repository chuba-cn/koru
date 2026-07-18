import { describe, expect, it } from 'vitest';
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
