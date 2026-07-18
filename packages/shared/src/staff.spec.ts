import { describe, expect, it } from 'vitest';
import {
  AcceptInviteSchema,
  CreateStaffSchema,
  ReplaceScopesSchema,
  STAFF_ROLES,
} from './staff.js';

const REGION = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

const validStaff = {
  fullName: 'Ada Obi',
  email: 'ada@example.test',
  role: 'finance' as const,
};

describe('CreateStaffSchema', () => {
  it('accepts a staff member with no scopes', () => {
    expect(CreateStaffSchema.safeParse(validStaff).success).toBe(true);
  });

  it.each(STAFF_ROLES)('accepts the role %s', (role) => {
    expect(CreateStaffSchema.safeParse({ ...validStaff, role }).success).toBe(true);
  });

  it('rejects a role outside the enum', () => {
    expect(CreateStaffSchema.safeParse({ ...validStaff, role: 'owner' }).success).toBe(false);
  });

  it('accepts mixed region and branch scopes', () => {
    const result = CreateStaffSchema.safeParse({
      ...validStaff,
      scopes: [
        { scopeType: 'region', scopeRefId: REGION },
        { scopeType: 'branch', scopeRefId: BRANCH },
      ],
    });
    expect(result.success).toBe(true);
  });

  /**
   * The same pair twice would create duplicate StaffScope rows that no unique
   * index prevents, so the refinement is the only thing stopping it.
   */
  it('rejects the same scope pair appearing twice', () => {
    const result = CreateStaffSchema.safeParse({
      ...validStaff,
      scopes: [
        { scopeType: 'region', scopeRefId: REGION },
        { scopeType: 'region', scopeRefId: REGION },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('allows the same id under different scope types', () => {
    const result = CreateStaffSchema.safeParse({
      ...validStaff,
      scopes: [
        { scopeType: 'region', scopeRefId: REGION },
        { scopeType: 'branch', scopeRefId: REGION },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a scope id that is not a uuid', () => {
    const result = CreateStaffSchema.safeParse({
      ...validStaff,
      scopes: [{ scopeType: 'region', scopeRefId: 'not-a-uuid' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(CreateStaffSchema.safeParse({ ...validStaff, email: 'ada@' }).success).toBe(false);
  });
});

describe('ReplaceScopesSchema', () => {
  it('accepts an empty array, which clears every scope', () => {
    expect(ReplaceScopesSchema.safeParse({ scopes: [] }).success).toBe(true);
  });

  it('rejects duplicates the same way create does', () => {
    const scopes = [
      { scopeType: 'branch', scopeRefId: BRANCH },
      { scopeType: 'branch', scopeRefId: BRANCH },
    ];
    expect(ReplaceScopesSchema.safeParse({ scopes }).success).toBe(false);
  });
});

describe('AcceptInviteSchema', () => {
  it('accepts a token and a password of at least eight characters', () => {
    const result = AcceptInviteSchema.safeParse({ token: 'abc', password: 'correct horse' });
    expect(result.success).toBe(true);
  });

  it('rejects a password shorter than eight characters', () => {
    expect(AcceptInviteSchema.safeParse({ token: 'abc', password: 'short' }).success).toBe(false);
  });

  /**
   * Better Auth rejects anything over 128 characters. Without this bound the
   * request reaches provisioning, burns the single-use invite, and reports a
   * misleading reason. See ADR-0012.
   */
  it('rejects a password longer than Better Auth accepts', () => {
    const result = AcceptInviteSchema.safeParse({ token: 'abc', password: 'a'.repeat(129) });
    expect(result.success).toBe(false);
  });

  it('accepts a password of exactly 128 characters', () => {
    const result = AcceptInviteSchema.safeParse({ token: 'abc', password: 'a'.repeat(128) });
    expect(result.success).toBe(true);
  });

  it('rejects an empty token', () => {
    expect(AcceptInviteSchema.safeParse({ token: '', password: 'correct horse' }).success).toBe(
      false,
    );
  });
});
