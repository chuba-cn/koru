import { describe, expect, it } from 'vitest';
import { ResendWebhookEventSchema } from './resend-webhook.js';

describe('ResendWebhookEventSchema', () => {
  it('parses an email lifecycle event', () => {
    const result = ResendWebhookEventSchema.safeParse({
      type: 'email.delivered',
      data: { email_id: 'msg-1' },
    });

    expect(result.success).toBe(true);
    expect(result.data?.data.email_id).toBe('msg-1');
  });

  /**
   * #67: Resend sends 19 event types, not just the 6 this receiver acts on —
   * a closed enum here would throw on every other one, and Resend retries
   * forever on a non-2xx response.
   */
  it.each([
    'email.opened',
    'email.clicked',
    'email.scheduled',
    'email.suppressed',
    'email.received',
  ])('accepts an unrecognized email event type (%s) rather than rejecting it', (type) => {
    const result = ResendWebhookEventSchema.safeParse({ type, data: { email_id: 'msg-1' } });
    expect(result.success).toBe(true);
  });

  /**
   * domain.*, contact.*, and suppressions.* events carry a completely
   * different data shape with no email_id at all.
   */
  it.each([
    'domain.created',
    'contact.created',
    'suppressions.added',
  ])('accepts a non-email event (%s) with no email_id present', (type) => {
    const result = ResendWebhookEventSchema.safeParse({ type, data: { id: 'dom_1' } });
    expect(result.success).toBe(true);
    expect(result.data?.data.email_id).toBeUndefined();
  });

  it('rejects a payload with no type at all', () => {
    expect(ResendWebhookEventSchema.safeParse({ data: {} }).success).toBe(false);
  });
});
