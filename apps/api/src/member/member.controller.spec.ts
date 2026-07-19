import { describe, expect, it } from 'vitest';
import { MemberController } from './member.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('MemberController wiring', () => {
  it('carries no guard beyond the global session requirement', () => {
    expect(guardsOf(MemberController)).toEqual([]);
    expect(guardsOf(MemberController.prototype.getProfile)).toEqual([]);
  });
});
