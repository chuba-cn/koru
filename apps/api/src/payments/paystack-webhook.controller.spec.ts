import { describe, expect, it } from 'vitest';
import { PaystackWebhookController } from './paystack-webhook.controller';

const guardsOf = (target: object) => (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

describe('PaystackWebhookController wiring', () => {
  it('is marked public, so the global AuthGuard does not require a session', () => {
    expect(Reflect.getMetadata('PUBLIC', PaystackWebhookController.prototype.handle)).toBeTruthy();
  });

  it('carries no tenant or role guard — trust comes from the HMAC signature, not a session', () => {
    expect(guardsOf(PaystackWebhookController)).toEqual([]);
    expect(guardsOf(PaystackWebhookController.prototype.handle)).toEqual([]);
  });
});
