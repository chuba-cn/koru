# Monorepo with pnpm workspaces + Turborepo

KORU is a single repository with `apps/*` and `packages/*`, managed by pnpm workspaces and
Turborepo. This lets the frontend and backend share TypeScript types and Zod schemas from
`packages/shared` with zero drift, at the cost of a slightly more involved build setup than
separate repositories would need.
