import { describe, expect, it } from 'vitest';
import { VerifiedPhoneGuard } from '../auth/verified-phone.guard';
import { JoinController } from './join.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('JoinController wiring', () => {
  it('leaves the branch directory open to any session', () => {
    expect(guardsOf(JoinController)).toEqual([]);
    expect(guardsOf(JoinController.prototype.listBranches)).toEqual([]);
  });

  it('requires a verified phone to join, on top of the session every route needs', () => {
    expect(guardsOf(JoinController.prototype.join)).toEqual([VerifiedPhoneGuard]);
  });
});
