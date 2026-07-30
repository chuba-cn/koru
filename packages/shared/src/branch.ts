import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

export const CreateBranchSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().max(240).optional(),
  regionId: z.uuid().nullable().optional(),
});

/**
 *  PATCH Semantics: Every field can be either of 3 possible states.
 * 1. absent = leave
 * 2. value present = set the field
 * 3. null = clear/delete the field (regionId & address only)
 */

export const UpdateBranchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  address: z.string().max(240).nullable().optional(),
  regionId: z.uuid().nullable().optional(),
});

export const ListBranchesQuerySchema = PaginationQuerySchema.extend({
  regionId: z.uuid().optional(),
});

export const BranchSchema = z.object({
  id: z.uuid(),
  churchId: z.uuid(),
  regionId: z.uuid().nullable(),
  name: z.string(),
  address: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type CreateBranchInput = z.infer<typeof CreateBranchSchema>;
export type UpdateBranchInput = z.infer<typeof UpdateBranchSchema>;
export type ListBranchesQuery = z.infer<typeof ListBranchesQuerySchema>;
export type Branch = z.infer<typeof BranchSchema>;
