import { z } from 'zod';

/**
 * Single source of the role values. The Prisma enum StaffRole (schema.prisma)
 * must list exactly these — if you change one, change both.
 */
export const STAFF_ROLES = [
  'super_admin',
  'regional_admin',
  'branch_admin',
  'finance',
  'recorder',
] as const;

export const StaffRoleSchema = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

export const SCOPE_TYPES = ['region', 'branch'] as const;

export const ScopeInputSchema = z.object({
  scopeType: z.enum(SCOPE_TYPES),
  scopeRefId: z.uuid(),
});

/** Reject the same (scopeType, scopeRefId) pair appearing twice in a payload */
const uniqueScopes = (scopes: { scopeType: string; scopeRefId: string }[]) =>
  new Set(scopes.map((scope) => `${scope.scopeType}:${scope.scopeRefId}`)).size === scopes.length;

export const CreateStaffSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.email().max(160),
  role: StaffRoleSchema,
  scopes: z
    .array(ScopeInputSchema)
    .max(50)
    .refine(uniqueScopes, 'scopes must not contain duplicates')
    .optional(),
});

export const UpdateStaffSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  role: StaffRoleSchema.optional(),
});

export const ReplaceScopesSchema = z.object({
  scopes: z
    .array(ScopeInputSchema)
    .max(50)
    .refine(uniqueScopes, 'scopes must not contain duplicates'),
});

export const StaffScopeSchema = z.object({
  id: z.uuid(),
  scopeType: z.enum(SCOPE_TYPES),
  scopeRefId: z.uuid(),
});

export const StaffInviteSchema = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});

export const StaffSchema = z.object({
  id: z.uuid(),
  churchId: z.uuid(),
  fullName: z.string(),
  email: z.email(),
  role: StaffRoleSchema,
  status: z.enum(['pending', 'active']),
  createdAt: z.iso.datetime(),
  scopes: z.array(StaffScopeSchema),
});

export const StaffWithInviteSchema = StaffSchema.extend({
  invite: StaffInviteSchema,
});

export const AcceptInviteResponseSchema = StaffSchema.extend({
  emailVerificationRequired: z.literal(true),
});

/** Bounds mirror Better Auth's minPasswordLength and its 128-char default max. */
export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

export const LinkLoginSchema = z.object({
  email: z.email().max(160),
});

export type StaffInvite = z.infer<typeof StaffInviteSchema>;
export type StaffWithInvite = z.infer<typeof StaffWithInviteSchema>;
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;
export type ScopeInput = z.infer<typeof ScopeInputSchema>;
export type CreateStaffInput = z.infer<typeof CreateStaffSchema>;
export type UpdateStaffInput = z.infer<typeof UpdateStaffSchema>;
export type ReplaceScopesInput = z.infer<typeof ReplaceScopesSchema>;
export type Staff = z.infer<typeof StaffSchema>;
export type LinkLoginInput = z.infer<typeof LinkLoginSchema>;
