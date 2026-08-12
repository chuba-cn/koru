import { describe, expect, it } from 'vitest';
import { ScopeRefSchema } from './scope.js';

const UUID = '22222222-2222-4222-8222-222222222222';

describe('ScopeRefSchema', () => {
  it('accepts a church scope with no scopeRefId', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'church' }).success).toBe(true);
  });

  it('accepts a church scope with scopeRefId explicitly null', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'church', scopeRefId: null }).success).toBe(true);
  });

  it('accepts a region scope with a uuid scopeRefId', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'region', scopeRefId: UUID }).success).toBe(true);
  });

  it('accepts a branch scope with a uuid scopeRefId', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'branch', scopeRefId: UUID }).success).toBe(true);
  });

  it('rejects a church scope that carries a scopeRefId', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'church', scopeRefId: UUID }).success).toBe(false);
  });

  it('rejects a region scope with no scopeRefId', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'region' }).success).toBe(false);
  });

  it('rejects a region scope with scopeRefId explicitly null', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'region', scopeRefId: null }).success).toBe(false);
  });

  it('rejects a branch scope with no scopeRefId', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'branch' }).success).toBe(false);
  });

  it('rejects a branch scope with scopeRefId explicitly null', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'branch', scopeRefId: null }).success).toBe(false);
  });

  it('rejects a scopeRefId that is not a uuid', () => {
    expect(
      ScopeRefSchema.safeParse({ scopeType: 'branch', scopeRefId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects a scopeType outside church, region, branch', () => {
    expect(ScopeRefSchema.safeParse({ scopeType: 'diocese', scopeRefId: UUID }).success).toBe(
      false,
    );
  });
});
