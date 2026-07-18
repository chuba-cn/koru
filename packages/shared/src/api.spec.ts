import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPaginatedSchema, ErrorResponseSchema, PaginationMetaSchema } from './api.js';

describe('ErrorResponseSchema', () => {
  it('accepts the shape the global filter produces', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'Church not found',
    });
    expect(result.success).toBe(true);
  });

  it('accepts per-field validation errors', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 400,
      error: 'BAD_REQUEST',
      message: 'Validation failed',
      errors: { name: ['must be at least 2 characters'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a success status, since this shape is only ever a failure', () => {
    const base = { error: 'X', message: 'y' };
    expect(ErrorResponseSchema.safeParse({ ...base, statusCode: 200 }).success).toBe(false);
    expect(ErrorResponseSchema.safeParse({ ...base, statusCode: 600 }).success).toBe(false);
  });

  it('rejects errors that are not arrays of strings', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 400,
      error: 'BAD_REQUEST',
      message: 'Validation failed',
      errors: { name: 'must be at least 2 characters' },
    });
    expect(result.success).toBe(false);
  });
});

describe('PaginationMetaSchema', () => {
  it('accepts a first page with no results', () => {
    const result = PaginationMetaSchema.safeParse({
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a zero page or page size, which are one-based', () => {
    const base = { pageSize: 20, totalItems: 0, totalPages: 0 };
    expect(PaginationMetaSchema.safeParse({ ...base, page: 0 }).success).toBe(false);
    expect(PaginationMetaSchema.safeParse({ ...base, page: 1, pageSize: 0 }).success).toBe(false);
  });

  it('rejects a negative total', () => {
    const result = PaginationMetaSchema.safeParse({
      page: 1,
      pageSize: 20,
      totalItems: -1,
      totalPages: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('createPaginatedSchema', () => {
  const schema = createPaginatedSchema(z.object({ id: z.string() }));

  it('wraps the item schema in data and meta', () => {
    const result = schema.safeParse({
      data: [{ id: 'a' }],
      meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects items that do not match the wrapped schema', () => {
    const result = schema.safeParse({
      data: [{ id: 42 }],
      meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
    expect(result.success).toBe(false);
  });
});
