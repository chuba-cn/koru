import { describe, expect, it } from 'vitest';
import { EmailLogItemSchema, EmailLogPageSchema } from './email-log.js';

const VALID_ITEM = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'staff_invite',
  recipientEmail: 'ada@example.test',
  recipientStaffId: null,
  recipientMemberId: null,
  subject: 'You have been invited',
  status: 'delivered',
  failureReason: null,
  sentAt: '2026-08-01T00:00:00.000Z',
  deliveredAt: '2026-08-01T00:05:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('EmailLogItemSchema', () => {
  it('accepts a fully populated item', () => {
    expect(EmailLogItemSchema.safeParse(VALID_ITEM).success).toBe(true);
  });

  it('accepts null for recipientStaffId, recipientMemberId, failureReason, sentAt, deliveredAt', () => {
    const result = EmailLogItemSchema.safeParse({
      ...VALID_ITEM,
      recipientStaffId: null,
      recipientMemberId: null,
      failureReason: null,
      sentAt: null,
      deliveredAt: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-email recipientEmail', () => {
    expect(
      EmailLogItemSchema.safeParse({ ...VALID_ITEM, recipientEmail: 'not-an-email' }).success,
    ).toBe(false);
  });

  it('rejects a missing createdAt', () => {
    const { createdAt: _createdAt, ...withoutCreatedAt } = VALID_ITEM;
    expect(EmailLogItemSchema.safeParse(withoutCreatedAt).success).toBe(false);
  });
});

describe('EmailLogPageSchema', () => {
  it('wraps items in the shared pagination envelope', () => {
    const result = EmailLogPageSchema.safeParse({
      items: [VALID_ITEM],
      totalCount: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: VALID_ITEM.id,
      endCursor: VALID_ITEM.id,
    });
    expect(result.success).toBe(true);
  });
});
