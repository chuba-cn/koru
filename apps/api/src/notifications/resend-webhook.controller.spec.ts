import { describe, expect, it } from 'vitest';
import { ResendWebhookController } from './resend-webhook.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('ResendWebhookController wiring', () => {
  it('is marked public, so the global AuthGuard does not require a session', () => {
    expect(Reflect.getMetadata('PUBLIC', ResendWebhookController.prototype.handle)).toBeTruthy();
  });

  it('carries no tenant or role guard — Resend has no session to present', () => {
    expect(guardsOf(ResendWebhookController)).toEqual([]);
    expect(guardsOf(ResendWebhookController.prototype.handle)).toEqual([]);
  });
});
