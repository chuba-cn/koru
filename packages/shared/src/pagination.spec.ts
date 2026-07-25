import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PaginationQuerySchema, paginatedResponseSchema } from './pagination.js';

describe('PaginationQuerySchema', () => {
  it('applies defaults when nothing is supplied', () => {
    const result = PaginationQuerySchema.parse({});
    expect(result).toEqual({ direction: 'forward', limit: 50 });
  });

  it('coerces a query-string limit into a number', () => {
    const result = PaginationQuerySchema.parse({ limit: '30' });
    expect(result.limit).toBe(30);
  });

  it('rejects a limit below 1 or above 100', () => {
    expect(PaginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects a non-numeric limit', () => {
    expect(PaginationQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
  });

  it('accepts either direction and rejects anything else', () => {
    expect(PaginationQuerySchema.safeParse({ direction: 'forward' }).success).toBe(true);
    expect(PaginationQuerySchema.safeParse({ direction: 'backward' }).success).toBe(true);
    expect(PaginationQuerySchema.safeParse({ direction: 'sideways' }).success).toBe(false);
  });

  it('accepts a non-UUID cursor, since not every model in this codebase uses UUIDs', () => {
    const result = PaginationQuerySchema.safeParse({ cursor: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty-string cursor', () => {
    expect(PaginationQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
  });

  it('leaves cursor absent (not null) when the caller omits it', () => {
    const result = PaginationQuerySchema.parse({});
    expect(result.cursor).toBeUndefined();
  });
});

describe('paginatedResponseSchema', () => {
  const StaffPageSchema = paginatedResponseSchema(z.object({ id: z.string() }));

  it('accepts a full page', () => {
    const result = StaffPageSchema.safeParse({
      items: [{ id: 'staff-1' }],
      totalCount: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: 'staff-1',
      endCursor: 'staff-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty page with null cursors', () => {
    const result = StaffPageSchema.safeParse({
      items: [],
      totalCount: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative totalCount', () => {
    const result = StaffPageSchema.safeParse({
      items: [],
      totalCount: -1,
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an item that does not match the item schema', () => {
    const result = StaffPageSchema.safeParse({
      items: [{ notAnId: 'oops' }],
      totalCount: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
    expect(result.success).toBe(false);
  });
});
