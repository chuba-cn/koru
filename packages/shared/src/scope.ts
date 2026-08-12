import { z } from 'zod';

/**
 * Info: This must list exactly the values of the Prisma enum ScopeLevel in
 * apps/api/prisma/schema.prisma, if you change the enum make sure it is changed here as well.
 */
export const SCOPE_LEVELS = ['church', 'region', 'branch'] as const;

export const ScopeLevelSchema = z.enum(SCOPE_LEVELS);

export const ScopeRefShape = z.object({
  scopeType: ScopeLevelSchema,
  scopeRefId: z.uuid().nullable().optional(),
});

export const ScopeRefSchema = ScopeRefShape.refine(
  (scope) => (scope.scopeType === 'church') === (scope.scopeRefId == null),
  { message: 'ScopeRefId must be null for a church scope, and a uuid for a region or branch' },
);

export type ScopeLevel = z.infer<typeof ScopeLevelSchema>;
export type ScopeRef = z.infer<typeof ScopeRefSchema>;
