import { z } from 'zod';
import { paginatedResponseSchema } from './pagination.js';
import { PhoneSchema } from './schemas.js';

export const JoinMemberSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.email().max(160).nullable().optional(),
  homeBranchId: z.uuid().nullable().optional(),
});

export const MemberSchema = z.object({
  id: z.uuid(),
  churchId: z.uuid(),
  fullName: z.string(),
  phone: PhoneSchema,
  email: z.email().nullable(),
  homeBranchId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const BranchDirectoryItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const MyProfileSchema = z.object({
  name: z.string(),
  phoneNumber: z.string().nullable(),
  memberships: paginatedResponseSchema(MemberSchema),
});

export type JoinMemberInput = z.infer<typeof JoinMemberSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type BranchDirectoryItem = z.infer<typeof BranchDirectoryItemSchema>;
export type MyProfile = z.infer<typeof MyProfileSchema>;
