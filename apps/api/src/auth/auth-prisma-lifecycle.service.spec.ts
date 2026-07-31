import { describe, expect, it, vi } from 'vitest';
import * as authModule from './auth';
import { AuthPrismaLifecycle } from './auth-prisma-lifecycle.service';

describe('AuthPrismaLifecycle', () => {
  it('disconnects the Better Auth Prisma client on module destroy', async () => {
    const disconnectSpy = vi.spyOn(authModule, 'disconnectAuthPrisma').mockResolvedValue();
    const lifecycle = new AuthPrismaLifecycle();

    await lifecycle.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});
