import { describe, expect, it } from 'vitest';
import { parseRedisUrl } from './queue.module';

describe('parseRedisUrl', () => {
  it('parses host and port with no credentials', () => {
    expect(parseRedisUrl('redis://localhost:6379')).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
    });
  });

  it('parses credentials when present', () => {
    expect(parseRedisUrl('redis://user:pass@redis-host:6380')).toEqual({
      host: 'redis-host',
      port: 6380,
      username: 'user',
      password: 'pass',
    });
  });

  it('defaults to the standard Redis port when the URL omits one, rather than silently producing port 0', () => {
    expect(parseRedisUrl('redis://localhost').port).toBe(6379);
  });
});
