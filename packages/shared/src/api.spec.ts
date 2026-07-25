import { describe, expect, it } from 'vitest';
import { ErrorResponseSchema } from './api.js';

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
