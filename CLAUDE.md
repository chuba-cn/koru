# KORU

Church pledge / project-giving SaaS for Nigeria. pnpm + Turborepo monorepo
(`apps/*`, `packages/*`).

## How work ships

**Never commit to `main`** — it is protected and will reject a direct push. Every ticket gets a
branch (`<type>/<issue>-<slug>`), a PR with `Closes #<n>`, green CI, and a squash-merge. See
`docs/agents/ci-and-branching.md` for the loop, what CI runs, and the decisions behind it.

## How the code works

`docs/architecture.md` is the map: request lifecycle, guard chain, module layout, and the patterns
to follow. **Read it before adding a module, controller or route, and update it in the same PR**
— a stale architecture doc is worse than none, because people trust it.

## How the code is tested

Two layers. **Unit specs sit beside the code** (`src/**/*.spec.ts`) and must pass with Postgres
stopped; **e2e** lives in `apps/api/test/`. Services, guards, pipes and everything in
`packages/shared` need a spec. **Controller specs assert security wiring, never delegation to a
mocked service** — a delegation test would pass even with no guards attached, which is a bug we
have shipped. See `docs/agents/testing.md`.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: a root `CONTEXT-MAP.md` points to a per-package `CONTEXT.md`. See `docs/agents/domain.md`.

### CI and branching

Branch-per-ticket, PR, green CI, squash-merge. See `docs/agents/ci-and-branching.md`.

### Testing

Unit specs beside the code, e2e in `test/`. Controller specs assert wiring, not delegation. See `docs/agents/testing.md`.
