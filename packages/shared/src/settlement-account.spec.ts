import { describe, expect, it } from 'vitest';
import { CreateSettlementAccountSchema } from './settlement-account.js';

const valid = {
  label: 'General Offering',
  accountNumber: '0123456789',
  bankName: 'Wema Bank',
};

describe('CreateSettlementAccountSchema', () => {
  it('accepts a church-wide account', () => {
    expect(CreateSettlementAccountSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a branch-level account', () => {
    const result = CreateSettlementAccountSchema.safeParse({
      ...valid,
      branchId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result.success).toBe(true);
  });

  /**
   * NUBAN account numbers are exactly ten digits. A shorter or longer value
   * reaching Paystack fails late and opaquely, so it is rejected here.
   */
  it.each([
    ['123', 'too short'],
    ['01234567890', 'too long'],
    ['012345678a', 'contains a letter'],
    ['012 456789', 'contains a space'],
    ['', 'empty'],
  ])('rejects account number %s (%s)', (accountNumber) => {
    expect(CreateSettlementAccountSchema.safeParse({ ...valid, accountNumber }).success).toBe(
      false,
    );
  });

  it('names the offending field when the account number is wrong', () => {
    const result = CreateSettlementAccountSchema.safeParse({ ...valid, accountNumber: '123' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['accountNumber']);
      expect(result.error.issues[0]?.message).toMatch(/exactly 10 digits/);
    }
  });

  it('rejects a branchId that is not a uuid', () => {
    const result = CreateSettlementAccountSchema.safeParse({ ...valid, branchId: 'nope' });
    expect(result.success).toBe(false);
  });
});
