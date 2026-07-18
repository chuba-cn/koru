import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter';

function capture() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  return { host, status, body: () => json.mock.calls[0]?.[0] };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [new NotFoundException('Church not found'), 404, 'NOT_FOUND'],
    [new ConflictException('Already exists'), 409, 'CONFLICT'],
    [new ForbiddenException('Nope'), 403, 'FORBIDDEN'],
  ])('maps %s to the standard shape', (exception, statusCode, error) => {
    const { host, status, body } = capture();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(body()).toMatchObject({ statusCode, error });
  });

  it('passes per-field errors through for a validation failure', () => {
    const { host, body } = capture();

    filter.catch(
      new BadRequestException({ message: 'Validation failed', errors: { name: ['too short'] } }),
      host,
    );

    expect(body()).toEqual({
      statusCode: 400,
      error: 'BAD_REQUEST',
      message: 'Validation failed',
      errors: { name: ['too short'] },
    });
  });

  it('emits only the four ADR-0006 keys, dropping anything else on the exception', () => {
    const { host, body } = capture();

    filter.catch(
      new BadRequestException({ message: 'Validation failed', query: 'select * from staff' }),
      host,
    );

    expect(body()).toEqual({
      statusCode: 400,
      error: 'BAD_REQUEST',
      message: 'Validation failed',
    });
  });

  it('keeps the message when the exception body is a bare string', () => {
    const { host, body } = capture();

    filter.catch(new HttpException('boom', 418), host);

    expect(body().message).toBe('boom');
  });

  it('replaces a message that is neither string nor array, rather than serialising it', () => {
    const { host, body } = capture();

    filter.catch(new BadRequestException({ message: { internal: 'hunter2' } }), host);

    expect(body().message).toBe('Unexpected error');
    expect(JSON.stringify(body())).not.toContain('hunter2');
  });

  it('omits the errors key entirely when there are none', () => {
    const { host, body } = capture();

    filter.catch(new NotFoundException('gone'), host);

    expect(body()).not.toHaveProperty('errors');
  });

  it('joins an array of messages into one string', () => {
    const { host, body } = capture();

    filter.catch(new BadRequestException({ message: ['first', 'second'] }), host);

    expect(body().message).toBe('first; second');
  });

  it('reduces an unexpected error to a 500 that leaks nothing', () => {
    const { host, status, body } = capture();

    filter.catch(new Error('db password is hunter2'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(body()).toEqual({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(body())).not.toContain('hunter2');
  });

  it('records the swallowed detail in the server log, so it is hidden and not lost', () => {
    const { host } = capture();

    filter.catch(new Error('db password is hunter2'), host);

    expect(logged.mock.calls[0]?.[0]).toContain('hunter2');
  });

  it('does not log an expected rejection as a server error', () => {
    const { host } = capture();

    filter.catch(new NotFoundException('gone'), host);

    expect(logged).not.toHaveBeenCalled();
  });

  it('leaks nothing when something other than an Error is thrown', () => {
    const { host, body } = capture();

    filter.catch({ secret: 'hunter2' }, host);

    expect(JSON.stringify(body())).not.toContain('hunter2');
  });
});
