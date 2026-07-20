import { describe, expect, it } from 'vitest';
import { MemberController } from './member.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('MemberController wiring', () => {
  it('carries no guard beyond the global session requirement', () => {
    expect(guardsOf(MemberController)).toEqual([]);
    expect(guardsOf(MemberController.prototype.getProfile)).toEqual([]);
  });

  it.each([
    'myPledges',
    'myPayments',
  ] as const)('leaves %s session-only, so isolation comes from the query not a guard', (method) => {
    expect(guardsOf(MemberController.prototype[method])).toEqual([]);
  });
});
