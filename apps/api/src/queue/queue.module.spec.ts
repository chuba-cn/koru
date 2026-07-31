import { describe, expect, it } from 'vitest';
import { parseRedisUrl } from './queue.module';

describe('parseRedisUrl', () => {
  it('parses host and port with no credentials', () => {
    expect(parseRedisUrl('redis://localhost:6379')).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
      db: 0,
    });
  });

  it('parses credentials when present', () => {
    expect(parseRedisUrl('redis://user:pass@redis-host:6380')).toEqual({
      host: 'redis-host',
      port: 6380,
      username: 'user',
      password: 'pass',
      db: 0,
    });
  });

  it('defaults to the standard Redis port when the URL omits one, rather than silently producing port 0', () => {
    expect(parseRedisUrl('redis://localhost').port).toBe(6379);
  });

  it('parses the db index from the path, so test and dev can use separate keyspaces on the same Redis', () => {
    expect(parseRedisUrl('redis://localhost:6379/1').db).toBe(1);
  });

  it('defaults to db 0 when the URL has no path', () => {
    expect(parseRedisUrl('redis://localhost:6379').db).toBe(0);
  });
});
