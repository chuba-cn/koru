import { describe, expect, it } from 'vitest';
import { CreateSettlementAccountSchema } from './settlement-account.js';

const valid = {
  label: 'General Offering',
  accountNumber: '0123456789',
  bankCode: '035',
  scopeType: 'church' as const,
};

describe('CreateSettlementAccountSchema', () => {
  it('accepts a church-wide account, with no scopeRefId', () => {
    expect(CreateSettlementAccountSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a church-wide account that carries a scopeRefId anyway', () => {
    const result = CreateSettlementAccountSchema.safeParse({
      ...valid,
      scopeRefId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a region-level account, with a scopeRefId', () => {
    const result = CreateSettlementAccountSchema.safeParse({
      ...valid,
      scopeType: 'region',
      scopeRefId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a branch-level account, with a scopeRefId', () => {
    const result = CreateSettlementAccountSchema.safeParse({
      ...valid,
      scopeType: 'branch',
      scopeRefId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a region-level account with no scopeRefId', () => {
    const result = CreateSettlementAccountSchema.safeParse({ ...valid, scopeType: 'region' });
    expect(result.success).toBe(false);
  });

  it('rejects a branch-level account with no scopeRefId', () => {
    const result = CreateSettlementAccountSchema.safeParse({ ...valid, scopeType: 'branch' });
    expect(result.success).toBe(false);
  });

  it('rejects a scopeRefId that is not a uuid', () => {
    const result = CreateSettlementAccountSchema.safeParse({
      ...valid,
      scopeType: 'branch',
      scopeRefId: 'nope',
    });
    expect(result.success).toBe(false);
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

  it('names the offending field when the account number is wrong, on an otherwise-valid payload', () => {
    const result = CreateSettlementAccountSchema.safeParse({ ...valid, accountNumber: '123' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path)).toContainEqual(['accountNumber']);
      expect(result.error.issues.find((i) => i.path[0] === 'accountNumber')?.message).toMatch(
        /exactly 10 digits/,
      );
    }
  });
});
