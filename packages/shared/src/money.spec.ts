import { describe, expect, it } from 'vitest';
import { bigintToKobo, koboToBigint, koboToNaira, nairaToKobo } from './index.js';

describe('nairaToKobo', () => {
  it('converts whole naira', () => {
    expect(nairaToKobo(1)).toBe(100);
    expect(nairaToKobo(1500)).toBe(150_000);
  });

  it('converts kobo-precision amounts', () => {
    expect(nairaToKobo(0.01)).toBe(1);
    expect(nairaToKobo(19.99)).toBe(1999);
  });

  /**
   * 19.99 * 100 is 1998.9999999999998 in IEEE 754. Without the rounding this
   * returns a fractional Kobo, which ADR-0003 forbids and which would silently
   * lose money once it reached the database as an integer column.
   */
  it('never returns a fraction, even where float multiplication drifts', () => {
    for (const naira of [19.99, 0.29, 1.005, 8.7, 1234.56, 0.07]) {
      expect(Number.isInteger(nairaToKobo(naira))).toBe(true);
    }
  });

  it('handles zero and negative amounts', () => {
    expect(nairaToKobo(0)).toBe(0);
    expect(nairaToKobo(-5.5)).toBe(-550);
  });

  it('rounds a sub-kobo amount to the nearest kobo rather than truncating', () => {
    expect(nairaToKobo(0.006)).toBe(1);
    expect(nairaToKobo(0.004)).toBe(0);
  });
});

describe('koboToNaira', () => {
  it('is the inverse of nairaToKobo for kobo-precision values', () => {
    for (const naira of [0, 1, 19.99, 1500, 1234.56]) {
      expect(koboToNaira(nairaToKobo(naira))).toBeCloseTo(naira, 10);
    }
  });

  it('converts back to a fractional naira', () => {
    expect(koboToNaira(1999)).toBe(19.99);
    expect(koboToNaira(1)).toBe(0.01);
  });
});

describe('bigintToKobo', () => {
  it('converts a normal amount to a number', () => {
    expect(bigintToKobo(10_000_00n)).toBe(1_000_000);
  });

  it('handles zero', () => {
    expect(bigintToKobo(0n)).toBe(0);
  });

  it('round-trips with koboToBigint', () => {
    expect(koboToBigint(bigintToKobo(50_000_00n))).toBe(50_000_00n);
  });

  /**
   * The guard the whole design rests on: Number() would silently return the
   * nearest double here, so bigintToKobo must throw instead.
   */
  it('throws rather than silently rounding above the safe integer range', () => {
    const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() => bigintToKobo(tooBig)).toThrow(RangeError);
  });

  it('throws on a value far below the negative safe integer range', () => {
    const tooSmall = -BigInt(Number.MAX_SAFE_INTEGER) - 1n;
    expect(() => bigintToKobo(tooSmall)).toThrow(RangeError);
  });
});

describe('koboToBigint', () => {
  it('converts a number to a BigInt', () => {
    expect(koboToBigint(1_000_000)).toBe(10_000_00n);
  });

  it('rejects a non-integer, which can never be valid kobo', () => {
    expect(() => koboToBigint(12.5)).toThrow(RangeError);
  });

  /**
   * Number.isInteger alone isn't enough: doubles above the safe range can
   * still look integer-valued while no longer representing every integer
   * exactly, so the check must be isSafeInteger.
   */
  it('rejects a number above the safe integer range, even though it looks like an integer', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 2;
    expect(() => koboToBigint(unsafe)).toThrow(RangeError);
  });
});
