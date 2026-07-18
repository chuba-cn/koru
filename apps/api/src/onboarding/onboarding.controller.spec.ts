import { describe, expect, it } from 'vitest';
import { OnboardingController } from './onboarding.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('OnboardingController wiring', () => {
  /**
   * No churchId exists yet at bootstrap time, so TenantGuard and RolesGuard
   * cannot apply here. The route still requires a session — it relies on the
   * global AuthGuard rather than opting out with @AllowAnonymous.
   */
  it('carries no tenant or role guard, since a church does not exist yet', () => {
    expect(guardsOf(OnboardingController)).toEqual([]);
    expect(guardsOf(OnboardingController.prototype.bootstrap)).toEqual([]);
  });

  it('is not marked public, so the global AuthGuard still requires a session', () => {
    expect(Reflect.getMetadata('PUBLIC', OnboardingController.prototype.bootstrap)).toBeFalsy();
    expect(Reflect.getMetadata('PUBLIC', OnboardingController)).toBeFalsy();
  });
});
