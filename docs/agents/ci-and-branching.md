# CI and branching

How work gets from a ticket onto `main` in this repo. Applies to humans and agents alike.

## The loop

1. **Pick a ticket.** Every change starts as a GitHub issue (see [issue-tracker.md](./issue-tracker.md)).
2. **Branch.** Never commit to `main` — it is protected and will reject a direct push.
   ```
   <type>/<issue-number>-<short-slug>
   ```
   `feat/23-github-actions-ci`, `fix/21-onboarding-p2002-409`, `chore/22-dead-church-code`, `docs/25-adr-squash-merge`

   `<type>` matches the conventional-commit prefix used on `main`, so the branch name previews the eventual commit subject. The issue number ties branch to ticket without a lookup.
3. **Do the work.** Commit as messily as you like — intermediate commits are squashed away and never reach `main`.
4. **Open a PR** with `Closes #<n>` in the body, so the merge closes the ticket automatically.
   ```bash
   gh pr create --base main --title "<type>: <what changed>" --body "Closes #<n>"
   ```
   **Not `gh pr create --fill`.** `--fill` takes the body from the commit message, so the PR gets no `Closes #<n>`: the merge won't close the ticket, and because `squash_merge_commit_message=PR_BODY` the squash commit loses the ticket link too — breaking the commit → PR → ticket → epic chain that makes `main` navigable. (This is not hypothetical; it's how #23 stayed open after merging.)
5. **CI must be green.** `verify` and `e2e` are required; `main` will not accept the PR otherwise.
6. **Squash-merge.** The branch is deleted automatically.

For an epic with several dependent tickets, don't run that loop once per ticket and wait for each merge. Stack them — see below.

## Stacked PRs, for an epic with dependent tickets

The loop above assumes one ticket at a time: open a PR, wait, merge, branch again. That serialises work that isn't actually serial. When ticket B only needs ticket A's schema (not A's review outcome), waiting for A to merge is dead time.

A stack is a chain of branches where each PR targets the one below it instead of `main`. A is reviewed against `main`; B is reviewed against A, so B's diff shows only B's work.

Requires the `gh-stack` extension, once per machine:

```bash
gh extension install github/gh-stack
```

The loop:

```bash
gh stack init --base main       # start the stack on the current branch
gh stack add feat/108-slug      # next ticket, branched on top of the previous
gh stack submit                 # push everything, create/update every PR
gh stack view                   # see the chain and its PR links
gh stack sync                   # after main moves, or after a lower PR changes
gh stack merge --yes --squash   # merge the whole chain
```

Every PR still needs its own `Closes #<n>`. `gh stack submit` opens an editor per PR for exactly that; don't `--auto` past it, for the same reason step 4 above rejects `gh pr create --fill`.

### Decisions, and what was actually verified

**Each PR keeps its own commit on `main`.** This was the one thing that had to be true before adopting this, because `main` is a one-commit-per-ticket ledger and a stack that collapsed into a single commit would destroy that. GitHub's docs are explicit: *"The resulting commit history is the same as merging each pull request individually, starting from the bottom."* Merging a four-PR stack with `--squash` produces four commits, in order. `gh stack merge`'s own help calls it an "atomic stack merge", which describes all-or-nothing **failure** semantics, not commit count: "if any PR cannot be merged, none are."

**Prefer merging the whole stack over merging part of it.** `gh stack merge <pr-number>` can land just the bottom few, and sometimes that's right. But `strict_required_status_checks_policy` is on in the `main` ruleset, so a PR must be up to date with its base to merge. Partial-merge retargets everything above onto the new `main`, which makes those PRs stale and forces a `gh stack sync` plus a full CI re-run on each. Merging the whole chain in one operation avoids that entirely.

**Unverified, and worth watching on the first real stack:** how strict status checks behave *during* an atomic full-stack merge. The reasoning says it's fine, because the whole chain lands in one operation with no intermediate state where an upper PR is stale against a moved `main`. GitHub's docs do not say so explicitly, and I could not find a primary source either way, so treat the first stacked epic as the experiment and record the answer here.

**`main` moving under you still costs a rebuild.** That's inherent to strict checks, not to stacking: any base advance invalidates the green on every open PR. `gh stack sync` rebases the whole chain and re-pushes in one command, which is strictly better than doing it per branch by hand. A merge queue would remove the cost entirely, and is the thing to reach for if this ever becomes painful.

**Limits that apply here:** every branch in a stack must live in this repo (cross-fork stacks are unsupported), and GitHub Desktop can't drive them. Neither constrains this project.

## What CI runs

One workflow, [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), on every PR and every push to `main`. Two jobs, in parallel:

| Job | Runs | Needs a DB |
|---|---|---|
| `verify` | `prisma generate` → `pnpm lint` → `pnpm check-types` → `pnpm test:unit` → `pnpm build` | no |
| `e2e` | `prisma generate` → write `.env.test` → `pnpm --filter @koru/api test:e2e` | yes — ephemeral `postgres:17` service container |

The unit suite sits in `verify` precisely because it needs no database. That is what keeps the fast job fast, and it is why a unit test that reaches for Postgres is misfiled — see [`testing.md`](./testing.md).

You can run all of it locally; CI runs nothing you can't. Do that before pushing — a red local run is far easier to read than a red CI run.

```bash
docker compose up -d
pnpm --filter @koru/api db:generate
pnpm lint && pnpm check-types && pnpm test:unit && pnpm build
pnpm --filter @koru/api test:e2e
```

## Decisions, and why — don't "fix" these

**Two jobs, not one per task.** `pnpm lint` takes ~1.5s; a dedicated job pays ~40s of checkout + setup + install first. A lint job is a 25x overhead tax on a 1.5-second command. `verify` and `e2e` split only because they have different resource shapes (one needs Postgres), which buys parallel wall-clock, a legible signal, and DB isolation.

**Squash-merge only.** `main` is a **one-commit-per-ticket ledger**, and agents are instructed to read `git log` to learn what has already been tried and decided. Rebase-merge would spray "wip" / "fix review finding" commits onto `main` and turn that ledger into landfill. The cost is real and accepted: `git bisect` lands on a whole ticket, not a single hunk — which is the right granularity for ticket-sized slices anyway.

**CI is the merge gate; there is no required reviewer.** GitHub won't let you approve your own PR, so requiring an approval would deadlock `main` for a solo developer. Code review happens locally via the `code-reviewer` subagent, enforced by [`.claude/hooks/review-gate.sh`](../../.claude/hooks/review-gate.sh). Raise `required_approving_review_count` the day a second human joins.

**`strict_required_status_checks_policy` is on.** A PR must be up to date with `main` before merging. This is what makes squash safe — it stops a PR merging green against a stale `main`. Nearly free for one developer; it's what catches semantic conflicts once two agents work in parallel. It's configured in the **`main` ruleset**, not classic branch protection, so `gh api repos/chuba-cn/koru/branches/main/protection` returns "Branch not protected" — that 404 is expected and means nothing. Read `gh api repos/chuba-cn/koru/rulesets` instead.

**Test credentials live in `ci.yml` in plain sight, not in repo secrets.** A repo secret is for a credential that protects a *real asset*. The CI `BETTER_AUTH_SECRET` signs sessions in a container destroyed minutes later; the Google values are placeholders the suite never sends to Google. Using secrets would make CI unreproducible for contributors, mask the very connection strings you need to debug a CI-only failure, and silently break for fork PRs. Real Paystack keys or a staging `DATABASE_URL` **are** secrets.

**Postgres comes from `services:`, never a shared database.** Issue #22: the e2e suite cannot tolerate two concurrent runs, because `truncateAll` does `TRUNCATE ... CASCADE` on every table and overlapping runs delete each other's in-flight data. A `services:` container gives every job its own database, so two CI runs *cannot* collide — isolation by construction, not by discipline. A shared CI database would import #22 into CI.

**`prisma generate` runs explicitly.** The client is gitignored and `turbo.json` has no `db:generate` task, so Turbo's graph can't see that `build`/`check-types` depend on generated code. On a fresh clone, typecheck fails before typechecking anything.

**`.env.test` is written by CI, not passed as job `env:`.** `test/global-setup.ts` loads it with `override: true`, so the file always wins over job env. The file is gitignored and absent in CI, and dotenv swallows the missing-file error — so job env *appears* to work, but only because the file is absent. Correctness depending on a file's absence is a landmine.

## Two traps that silently break the merge gate

**Don't add a matrix strategy** without updating the required checks. A matrix renders check names as `verify (22)`; a required context of `verify` would then never match, leaving every PR permanently pending.

**Don't add `paths-ignore`.** A workflow skipped by a path filter reports *no status at all* — not success, not "skipped". A required check that never reports blocks the merge forever, making a docs-only PR unmergeable. If path filtering ever becomes necessary, use a `changes` job that always runs and conditionally no-ops while still reporting success.

## When the frontend lands

`apps/web` needs **no workflow change**. `pnpm lint` is `biome check .` from the root and already covers paths that don't exist yet; `build` and `check-types` are `turbo run`, and `pnpm-workspace.yaml` globs `apps/*`, so Turbo picks up a new workspace automatically. `turbo.json` already declares `.output/**` as a build output — the TanStack Start/Nitro directory.

The only additive change is a **third job** when web gets Playwright e2e, because that's another distinct resource shape (browser deps). Add it alongside; don't fold it into `e2e`.
