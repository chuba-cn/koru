import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  // Not z.uuid(): cursors are just "some model's id", and ids in this codebase
  // aren't all UUIDs (StaffInvite uses ulid()). The cursor's only real
  // constraint is "non-empty" — Prisma rejects anything that doesn't match an
  // existing unique row regardless of shape.
  cursor: z.string().min(1).optional(),
  direction: z.enum(['forward', 'backward']).default('forward'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const paginatedResponseSchema = <TItem extends z.ZodType>(item: TItem) =>
  z.object({
    items: z.array(item),
    totalCount: z.number().int().min(0),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
    startCursor: z.string().min(1).nullable(),
    endCursor: z.string().min(1).nullable(),
  });

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
