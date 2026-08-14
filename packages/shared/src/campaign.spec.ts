import { describe, expect, it } from 'vitest';
import {
  CampaignSchema,
  CreateCampaignSchema,
  ListCampaignsQuerySchema,
  UpdateCampaignSchema,
} from './campaign.js';

const UUID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';

const valid = {
  scopeType: 'church' as const,
  title: 'General Offering',
  settlementAccountId: ACCOUNT,
  targetAmountKobo: 500000,
};

describe('CreateCampaignSchema', () => {
  it('accepts a minimal church-wide campaign', () => {
    expect(CreateCampaignSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a branch-level campaign with a scopeRefId', () => {
    const result = CreateCampaignSchema.safeParse({
      ...valid,
      scopeType: 'branch',
      scopeRefId: UUID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a branch-level campaign with no scopeRefId', () => {
    const result = CreateCampaignSchema.safeParse({ ...valid, scopeType: 'branch' });
    expect(result.success).toBe(false);
  });

  it('rejects a title shorter than 2 characters', () => {
    expect(CreateCampaignSchema.safeParse({ ...valid, title: 'A' }).success).toBe(false);
  });

  it('rejects a non-positive targetAmountKobo', () => {
    expect(CreateCampaignSchema.safeParse({ ...valid, targetAmountKobo: 0 }).success).toBe(false);
  });

  it('rejects a settlementAccountId that is not a uuid', () => {
    expect(CreateCampaignSchema.safeParse({ ...valid, settlementAccountId: 'nope' }).success).toBe(
      false,
    );
  });

  it('rejects an endDate before startDate', () => {
    const result = CreateCampaignSchema.safeParse({
      ...valid,
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-05-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an endDate on or after startDate', () => {
    const result = CreateCampaignSchema.safeParse({
      ...valid,
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-06-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('UpdateCampaignSchema', () => {
  it('accepts a label-only update', () => {
    expect(UpdateCampaignSchema.safeParse({ title: 'New title' }).success).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(UpdateCampaignSchema.safeParse({}).success).toBe(false);
  });

  it('accepts scopeType and scopeRefId sent together', () => {
    const result = UpdateCampaignSchema.safeParse({ scopeType: 'branch', scopeRefId: UUID });
    expect(result.success).toBe(true);
  });

  it('rejects scopeType without scopeRefId', () => {
    expect(UpdateCampaignSchema.safeParse({ scopeType: 'branch' }).success).toBe(false);
  });

  it('rejects scopeRefId without scopeType', () => {
    expect(UpdateCampaignSchema.safeParse({ scopeRefId: UUID }).success).toBe(false);
  });

  it('accepts scopeType church with scopeRefId null', () => {
    const result = UpdateCampaignSchema.safeParse({ scopeType: 'church', scopeRefId: null });
    expect(result.success).toBe(true);
  });

  it('rejects scopeType church with a non-null scopeRefId', () => {
    const result = UpdateCampaignSchema.safeParse({ scopeType: 'church', scopeRefId: UUID });
    expect(result.success).toBe(false);
  });
});

describe('ListCampaignsQuerySchema', () => {
  it('accepts an empty query, defaulting pagination', () => {
    const result = ListCampaignsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);
  });

  it('accepts every filter field together', () => {
    const result = ListCampaignsQuerySchema.safeParse({
      status: 'active',
      scopeType: 'branch',
      scopeRefId: UUID,
      settlementAccountId: ACCOUNT,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(ListCampaignsQuerySchema.safeParse({ status: 'cancelled' }).success).toBe(false);
  });
});

describe('CampaignSchema', () => {
  it('parses a full campaign row', () => {
    const result = CampaignSchema.safeParse({
      id: UUID,
      churchId: UUID,
      title: 'General Offering',
      description: null,
      scopeType: 'church',
      scopeRefId: null,
      settlementAccountId: ACCOUNT,
      targetAmountKobo: 500000,
      currency: 'NGN',
      startDate: null,
      endDate: null,
      status: 'draft',
      createdById: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});
