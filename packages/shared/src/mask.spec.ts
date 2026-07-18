import { describe, expect, it } from 'vitest';
import { maskTail } from './mask.js';

describe('maskTail', () => {
  it('hides everything except the last four characters', () => {
    expect(maskTail('0123456789')).toBe('******6789');
  });

  it('returns the value untouched when it is not longer than the visible part', () => {
    expect(maskTail('1234')).toBe('1234');
    expect(maskTail('123')).toBe('123');
  });

  it('honours a custom visible length', () => {
    expect(maskTail('0123456789', 2)).toBe('********89');
  });

  it('handles an empty string without throwing', () => {
    expect(maskTail('')).toBe('');
  });
});
