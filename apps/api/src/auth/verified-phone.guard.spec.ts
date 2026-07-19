import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { VerifiedPhoneGuard } from './verified-phone.guard';

function contextWith(session: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ session }) }),
  } as unknown as ExecutionContext;
}

describe('VerifiedPhoneGuard', () => {
  const guard = new VerifiedPhoneGuard();

  it('allows a session with a verified phone', () => {
    const context = contextWith({ user: { id: 'user-1', phoneNumberVerified: true } });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a session whose phone is unverified', () => {
    const context = contextWith({ user: { id: 'user-1', phoneNumberVerified: false } });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a session that never verified a phone at all', () => {
    const context = contextWith({ user: { id: 'user-1' } });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('fails loudly when AuthGuard has not populated a session', () => {
    const context = contextWith(undefined);
    expect(() => guard.canActivate(context)).toThrow(InternalServerErrorException);
  });
});
