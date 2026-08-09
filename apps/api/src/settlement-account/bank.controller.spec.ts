import { describe, expect, it } from 'vitest';
import { BankController } from './bank.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('BankController wiring', () => {
  it('carries no TenantGuard or role guard — every session sees the same list', () => {
    expect(guardsOf(BankController)).toEqual([]);
    expect(guardsOf(BankController.prototype.list)).toEqual([]);
  });

  it('carries no PUBLIC metadata — a session is required, this route calls out to Paystack on a cache miss', () => {
    expect(Reflect.getMetadata('PUBLIC', BankController.prototype.list)).toBeFalsy();
  });
});
