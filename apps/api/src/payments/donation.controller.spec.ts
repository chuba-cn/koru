import { describe, expect, it } from 'vitest';
import { VerifiedPhoneGuard } from '../auth/verified-phone.guard';
import { DonationController } from './donation.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('DonationController wiring', () => {
  it('carries no class-level guard', () => {
    expect(guardsOf(DonationController)).toEqual([]);
  });

  it('requires VerifiedPhoneGuard on create — the same guard POST /join/:churchId uses', () => {
    expect(guardsOf(DonationController.prototype.create)).toEqual([VerifiedPhoneGuard]);
  });

  it('carries no PUBLIC metadata — a session is required', () => {
    expect(Reflect.getMetadata('PUBLIC', DonationController.prototype.create)).toBeFalsy();
  });

  it('requires VerifiedPhoneGuard on findOne too, declared per-route not on the class', () => {
    expect(guardsOf(DonationController.prototype.findOne)).toEqual([VerifiedPhoneGuard]);
  });

  it('carries no PUBLIC metadata on findOne — a donation is never readable anonymously', () => {
    expect(Reflect.getMetadata('PUBLIC', DonationController.prototype.findOne)).toBeFalsy();
  });
});
