import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({
  name: z.string().min(2, 'must be at least 2 characters'),
  nested: z.object({ count: z.number() }).optional(),
});

function errorsFrom(pipe: ZodValidationPipe, value: unknown) {
  try {
    pipe.transform(value);
  } catch (e) {
    return (e as BadRequestException).getResponse() as {
      message: string;
      errors: Record<string, string[]>;
    };
  }
  throw new Error('expected the pipe to reject');
}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value when it is valid', () => {
    expect(pipe.transform({ name: 'Ada' })).toEqual({ name: 'Ada' });
  });

  it('strips keys the schema does not declare', () => {
    expect(pipe.transform({ name: 'Ada', sneaky: true })).toEqual({ name: 'Ada' });
  });

  it('rejects invalid input as a 400', () => {
    expect(() => pipe.transform({ name: 'A' })).toThrow(BadRequestException);
  });

  it('groups messages under the field path, which is the ADR-0006 error shape', () => {
    const body = errorsFrom(pipe, { name: 'A' });

    expect(body.message).toBe('Validation failed');
    expect(body.errors.name).toEqual(['must be at least 2 characters']);
  });

  it('joins a nested path with dots so the client can locate the field', () => {
    const body = errorsFrom(pipe, { name: 'Ada', nested: { count: 'not a number' } });

    expect(Object.keys(body.errors)).toContain('nested.count');
  });

  it('collects several messages for one field rather than reporting only the first', () => {
    const strict = new ZodValidationPipe(
      z.object({ code: z.string().min(5, 'too short').regex(/^\d+$/, 'digits only') }),
    );

    const body = errorsFrom(strict, { code: 'ab' });

    expect(body.errors.code).toHaveLength(2);
  });

  /**
   * A top-level failure has an empty issue path, which would otherwise produce
   * an empty-string key and read as a field named "".
   */
  it('labels a top-level failure rather than emitting a blank key', () => {
    const body = errorsFrom(new ZodValidationPipe(z.string()), 42);

    expect(Object.keys(body.errors)).toEqual(['(root)']);
  });
});
