import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { assertCursorVisible, assertValidDirection, buildCursorPage } from './cursor-pagination';

describe('assertValidDirection', () => {
  it('rejects direction=backward with no cursor', () => {
    expect(() => assertValidDirection({ direction: 'backward', limit: 50 })).toThrow(
      BadRequestException,
    );
  });

  it('allows direction=backward when a cursor is supplied', () => {
    expect(() =>
      assertValidDirection({ direction: 'backward', limit: 50, cursor: 'row-1' }),
    ).not.toThrow();
  });

  it('allows direction=forward with no cursor — that is just "start from the top"', () => {
    expect(() => assertValidDirection({ direction: 'forward', limit: 50 })).not.toThrow();
  });
});

describe('assertCursorVisible', () => {
  it('does nothing, and never calls the lookup, when no cursor is supplied', async () => {
    const findCursorRow = vi.fn(() => Promise.resolve(null));

    await assertCursorVisible(undefined, findCursorRow);

    expect(findCursorRow).not.toHaveBeenCalled();
  });

  it('resolves when the lookup finds the row', async () => {
    const findCursorRow = vi.fn(() => Promise.resolve({ id: 'row-1' }));

    await expect(assertCursorVisible('row-1', findCursorRow)).resolves.toBeUndefined();
    expect(findCursorRow).toHaveBeenCalledWith('row-1');
  });

  it('400s when the lookup comes back empty, instead of silently paging past an invalid cursor', async () => {
    const findCursorRow = vi.fn(() => Promise.resolve(null));

    await expect(assertCursorVisible('someone-elses-row', findCursorRow)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('buildCursorPage', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `row-${i}` }));

  it('reports hasNextPage and slices off the lookahead row when more rows exist than the limit', () => {
    // list() always fetches limit+1 rows: 3 rows back for a limit of 2 means
    // there is one more page after this one.
    const page = buildCursorPage(rows(3), 3, { direction: 'forward', limit: 2 });

    expect(page.items.map((r) => r.id)).toEqual(['row-0', 'row-1']);
    expect(page.hasNextPage).toBe(true);
    expect(page.hasPreviousPage).toBe(false);
    expect(page.startCursor).toBe('row-0');
    expect(page.endCursor).toBe('row-1');
  });

  it('reports hasNextPage false when exactly limit rows come back, with none left over', () => {
    const page = buildCursorPage(rows(2), 2, { direction: 'forward', limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.hasNextPage).toBe(false);
  });

  it('reports hasPreviousPage true whenever a cursor was supplied, regardless of hasMore', () => {
    const page = buildCursorPage(rows(1), 1, {
      direction: 'forward',
      limit: 2,
      cursor: 'row-before',
    });

    expect(page.hasPreviousPage).toBe(true);
  });

  it('reverses a backward page back into ascending order', () => {
    // The service fetches backward pages in descending order, then this
    // function must undo that so the client always reads oldest-to-newest.
    const page = buildCursorPage(rows(2).reverse(), 2, {
      direction: 'backward',
      limit: 2,
      cursor: 'row-2',
    });

    expect(page.items.map((r) => r.id)).toEqual(['row-0', 'row-1']);
  });

  it('treats a supplied cursor as proof a forward page exists, when walking backward', () => {
    const page = buildCursorPage(rows(3).reverse(), 2, {
      direction: 'backward',
      limit: 2,
      cursor: 'row-3',
    });

    expect(page.hasPreviousPage).toBe(true);
    expect(page.hasNextPage).toBe(true);
  });

  it('falls back startCursor to the supplied cursor on an empty forward page', () => {
    const page = buildCursorPage([], 0, {
      direction: 'forward',
      limit: 50,
      cursor: 'still-valid-row',
    });

    expect(page.items).toEqual([]);
    expect(page.hasPreviousPage).toBe(true);
    expect(page.startCursor).toBe('still-valid-row');
    expect(page.hasNextPage).toBe(false);
    expect(page.endCursor).toBeNull();
  });

  it('falls back endCursor to the supplied cursor on an empty backward page', () => {
    const page = buildCursorPage([], 0, {
      direction: 'backward',
      limit: 50,
      cursor: 'still-valid-row',
    });

    expect(page.items).toEqual([]);
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBe('still-valid-row');
    expect(page.hasPreviousPage).toBe(false);
    expect(page.startCursor).toBeNull();
  });

  it('returns null cursors on an empty page with no cursor at all — a genuinely empty list', () => {
    const page = buildCursorPage([], 0, { direction: 'forward', limit: 50 });

    expect(page.startCursor).toBeNull();
    expect(page.endCursor).toBeNull();
    expect(page.hasNextPage).toBe(false);
    expect(page.hasPreviousPage).toBe(false);
  });

  it('reports the true totalCount independent of the page size', () => {
    const page = buildCursorPage(rows(2), 4321, { direction: 'forward', limit: 2 });

    expect(page.totalCount).toBe(4321);
  });
});
