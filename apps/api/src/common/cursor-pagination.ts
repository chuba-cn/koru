import type { PaginationQuery } from '@koru/shared';
import { BadRequestException } from '@nestjs/common';

export function assertValidDirection(query: PaginationQuery) {
  if (query.direction === 'backward' && !query.cursor) {
    throw new BadRequestException(
      'direction=backward requires a cursor (send a previous response\'s "startCursor" value as "cursor")',
    );
  }
}

export async function assertCursorVisible(
  cursor: string | undefined,
  findCursorRow: (cursor: string) => Promise<{ id: string } | null>,
) {
  if (!cursor) return;

  const row = await findCursorRow(cursor);
  if (!row) {
    throw new BadRequestException('cursor not found');
  }
}

export function buildCursorPage<T extends { id: string }>(
  rows: T[],
  totalCount: number,
  query: PaginationQuery,
) {
  const backward = query.direction === 'backward';
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const items = backward ? page.reverse() : page;

  const hasNextPage = backward ? Boolean(query.cursor) : hasMore;
  const hasPreviousPage = backward ? hasMore : Boolean(query.cursor);

  return {
    items,
    totalCount,
    hasNextPage,
    hasPreviousPage,
    startCursor: items[0]?.id ?? (hasPreviousPage ? (query.cursor ?? null) : null),
    endCursor: items[items.length - 1]?.id ?? (hasNextPage ? (query.cursor ?? null) : null),
  };
}
