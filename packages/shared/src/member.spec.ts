import { describe, expect, it } from 'vitest';
import {
  BranchDirectoryItemSchema,
  JoinMemberSchema,
  MemberSchema,
  MyProfileSchema,
} from './member.js';

const CHURCH = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

const validMember = {
  id: CHURCH,
  churchId: CHURCH,
  fullName: 'Ada Lovelace',
  phone: '+2348012345678',
  email: null,
  homeBranchId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('JoinMemberSchema', () => {
  it('accepts a fullName with no email or branch', () => {
    expect(JoinMemberSchema.safeParse({ fullName: 'Ada Lovelace' }).success).toBe(true);
  });

  it('accepts email and homeBranchId when present', () => {
    const result = JoinMemberSchema.safeParse({
      fullName: 'Ada Lovelace',
      email: 'ada@example.test',
      homeBranchId: BRANCH,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an explicit null for email and homeBranchId', () => {
    const result = JoinMemberSchema.safeParse({
      fullName: 'Ada Lovelace',
      email: null,
      homeBranchId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a fullName under two characters', () => {
    expect(JoinMemberSchema.safeParse({ fullName: 'A' }).success).toBe(false);
  });

  it('rejects a homeBranchId that is not a UUID', () => {
    const result = JoinMemberSchema.safeParse({ fullName: 'Ada Lovelace', homeBranchId: 'main' });
    expect(result.success).toBe(false);
  });

  /** JoinMemberSchema deliberately has no phone field — see member.service.ts's security boundary. */
  it('does not accept a phone field at all', () => {
    const result = JoinMemberSchema.safeParse({
      fullName: 'Ada Lovelace',
      phone: '+2348012345678',
    });
    expect(result.success && !('phone' in result.data)).toBe(true);
  });
});

describe('MemberSchema', () => {
  it('accepts a full membership record', () => {
    expect(MemberSchema.safeParse(validMember).success).toBe(true);
  });

  it('accepts a local-format phone number, since it validates staff/admin-entered data too', () => {
    expect(MemberSchema.safeParse({ ...validMember, phone: '08012345678' }).success).toBe(true);
  });

  it('rejects a phone number that is not Nigerian', () => {
    expect(MemberSchema.safeParse({ ...validMember, phone: '+447700900000' }).success).toBe(false);
  });

  it('rejects a missing fullName', () => {
    const { fullName, ...rest } = validMember;
    expect(MemberSchema.safeParse(rest).success).toBe(false);
  });
});

describe('BranchDirectoryItemSchema', () => {
  it('accepts an id and a name, nothing else required', () => {
    expect(BranchDirectoryItemSchema.safeParse({ id: BRANCH, name: 'Main Branch' }).success).toBe(
      true,
    );
  });
});

const emptyPage = {
  items: [] as (typeof validMember)[],
  totalCount: 0,
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

describe('MyProfileSchema', () => {
  it('accepts an empty memberships page, for a login with no memberships yet', () => {
    const result = MyProfileSchema.safeParse({
      name: 'Ada Lovelace',
      phoneNumber: '+2348012345678',
      memberships: emptyPage,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null phoneNumber, for a login that never verified a phone', () => {
    const result = MyProfileSchema.safeParse({
      name: 'Ada Lovelace',
      phoneNumber: null,
      memberships: emptyPage,
    });
    expect(result.success).toBe(true);
  });

  it('accepts memberships across multiple churches, inside the pagination envelope', () => {
    const result = MyProfileSchema.safeParse({
      name: 'Ada Lovelace',
      phoneNumber: '+2348012345678',
      memberships: {
        ...emptyPage,
        items: [validMember, { ...validMember, churchId: BRANCH }],
        totalCount: 2,
        endCursor: validMember.id,
      },
    });
    expect(result.success).toBe(true);
  });

  /**
   * #84: memberships is now a paginated envelope, not a bare array — a caller
   * still on the old shape must fail validation, not be silently accepted.
   */
  it('rejects a bare memberships array now that it is a paginated envelope', () => {
    const result = MyProfileSchema.safeParse({
      name: 'Ada Lovelace',
      phoneNumber: '+2348012345678',
      memberships: [validMember],
    });
    expect(result.success).toBe(false);
  });
});
