import { describe, expect, it } from 'vitest';
import { PhoneSchema } from './schemas.js';

describe('PhoneSchema', () => {
  it.each([
    '+2348012345678',
    '+2347012345678',
    '+2349112345678',
    '08012345678',
    '07112345678',
  ])('accepts %s', (phone) => {
    expect(PhoneSchema.safeParse(phone).success).toBe(true);
  });

  it.each([
    ['+2346012345678', 'network code 6 is not issued in Nigeria'],
    ['+2348212345678', 'second digit must be 0 or 1'],
    ['0801234567', 'one digit short'],
    ['080123456789', 'one digit long'],
    ['2348012345678', 'missing the leading plus'],
    ['+44 7700 900000', 'not a Nigerian number'],
    ['080 1234 5678', 'spaces are not stripped for us'],
    ['', 'empty'],
  ])('rejects %s (%s)', (phone) => {
    expect(PhoneSchema.safeParse(phone).success).toBe(false);
  });

  it('explains itself when it rejects', () => {
    const result = PhoneSchema.safeParse('nonsense');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Nigerian phone number/);
    }
  });
});
