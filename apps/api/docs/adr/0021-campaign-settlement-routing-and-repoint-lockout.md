# A Campaign's settlement account must cover its scope, and both lock once giving exists

Recorded for #139. Builds on [ADR-0020](0020-settlement-account-scope-and-delegated-registration.md),
which gave `SettlementAccount` a scope. This ADR is what a `Campaign` does with that scope.

`CampaignService` did not exist before this ticket. Campaign rows were created only by test
fixtures, so two rules with real money consequences had nowhere to live: whether a campaign's
settlement account can actually receive its giving, and whether that account (or the campaign's own
scope) can be changed after giving has started.

## The routing rule, and its direction

A `Campaign`'s settlement account must have a scope that **covers or equals** the campaign's own
scope:

| Campaign scope | Allowed account scope |
|---|---|
| `church` | `church` only |
| `region R` | `region R`, or `church` |
| `branch B` | `branch B`, `region(B)`, or `church` |

This is `ScopeService.covers(churchId, accountScope, campaignScope)` — the account is `outer`, the
campaign is `inner`. Getting that argument order backwards inverts the whole rule into permitting
the misroute it exists to stop, so `CampaignService.assertAccountCoversCampaign` always calls it
with the account first.

The rule is one-directional for the same reason `covers` already is everywhere else it is used.
Upward is a legitimate arrangement: "the branch runs the campaign, head office banks it." Downward
is not: a church-wide campaign settling into one branch's account means every branch's members give
and one branch's bank account receives, with nothing anywhere recording that as unusual.

## Why there is no separate authority check on the account

A reader will expect `assertAccountCoversCampaign` to also check that the caller has authority over
the account's scope, the way `assertMayActOnScope` checks authority over the campaign's scope.
Adding that check would be a bug, not a missing safeguard. `covers` already makes diversion
unrepresentable on its own: a `branch_admin` of branch B can only point a campaign at B's own
account, `region(B)`'s account, or the church's account — all scopes B's containment already reaches
upward into, never a sibling branch's. Requiring authority over the account's scope on top would
break the legitimate "branch runs it, HQ banks it" case this design exists to keep, since a
`branch_admin` has no authority over their own region's or church's `StaffScope` by definition.

## Why the rule lives in `CampaignService`, not `DonationIntentService`

The compatibility check runs once, at `create`/`update` time, not on every donation. Two reasons.
First, cost: a per-donation re-check duplicates the same query on the hot path of every gift. Second,
what each check is actually for. `CampaignService`'s check is a scope rule — an in-tenant routing
decision that can be wrong without any money being unsafe. The cross-*tenant* half of this is
already unbreakable at the database: `Campaign.settlementAccount` is a composite foreign key on
`(settlementAccountId, churchId)`, so a `settlementAccountId` from another church cannot be written
at all, scope check or not. Worst case for a violated scope rule is a wrong account inside one
church; worst case for a violated tenant rule is another church's money. Only the second earns a
database constraint — the first earns an application check, run once, where the campaign is created.

## The repoint lockout, and what it deliberately does not block

`CampaignService.update` refuses to change `settlementAccountId` once any `Payment` row exists for
the campaign — not `state: 'settled'` specifically, any `Payment` at all, since a `Payment` only
ever exists post-settlement ([ADR-0016](0016-double-entry-ledger-source-of-truth.md)) and a `refunded`/`reversed`
row has the same claim on explaining the campaign's history as a clean one does.

It deliberately does **not** block on a pending `PaymentAttempt`. #107's Part 17.1 already made an
in-flight charge safe across a repoint: `PaymentAttempt.settlementAccountId` records the account
each charge was minted against, so an attempt started before a repoint still settles correctly
after one. Blocking repoint on a pending attempt would waste that work for no safety gain — the
thing that needs to stay explainable is settled history, not an attempt still in flight.

## The scope lockout, and why it is stricter

`CampaignService.update` also refuses to change `scopeType`/`scopeRefId` once any `DonationIntent`
**or** `Payment` exists — a lower bar than the repoint lockout's "`Payment` only." A `DonationIntent`
is the giver's side of the campaign's identity: a member decided to give to *this* campaign, at the
scope it presented itself as, before any charge succeeded or even started. Letting the scope move
out from under an intent that already exists would make "which campaign did this member give to"
answerable differently depending on when you ask. The repoint lockout only has to protect settled
history; the scope lockout has to protect what the giver already committed to.

When a scope change is allowed, it requires authority over **both** the current scope and the
requested one, mirroring `BranchService.update`'s region-move check
(`apps/api/src/branch/branch.service.ts`). Without the current-scope side, a `branch_admin` could
pull a region-scoped campaign down into their own branch — they would never gain reach they did not
have, but a resource they had no authority over would change identity under them.

## Why the composite FK still needs a service pre-check

`Campaign.settlementAccount` being a composite FK on `(settlementAccountId, churchId)` guarantees a
cross-tenant `settlementAccountId` can never be written — but that guarantee shows up to the caller
as whatever Postgres does with a foreign-key violation, and `GlobalExceptionFilter`
(`apps/api/src/common/global-exception.filter.ts`) has exactly one branch: `instanceof
HttpException`. An unmapped Prisma `P2003` is not one, so it falls through to a flat 500 — a tenant
probe answered with a stack-shaped error instead of a clean 400. This is a general lesson about
`GlobalExceptionFilter`, not a campaign-specific one: any service relying on a database constraint
for its safety guarantee still owes callers a `findFirst({ where: { id, churchId } })` pre-check for
the response shape, the same pattern `SettlementAccountService.create` already uses for its `P2002`.
`CampaignService.assertAccountCoversCampaign` does this before ever reaching `campaign.create`.

## `CampaignBalance` is dead and must stay dead

Nothing in `apps/api/src` references the `CampaignBalance` model. `CampaignService.create` does not
create one. Campaign totals are derived, per ADR-0016 and the API's ADR-0001 before it — summed from
`Payment` rows, never hand-maintained as a running counter that can drift from the ledger it is
supposed to summarise. If live sums become expensive at scale, the answer is a read-side projection
(#113), never reviving this model.

## No `@@unique([churchId, title])`

Campaign titles legitimately repeat — the same name across different years, or the same fundraiser
run independently by two branches. A partial unique index would not even catch the church-scoped
case: Postgres treats `NULL`s as distinct in a unique index, and `scopeRefId` is `NULL` for every
church-scoped campaign, so two church-wide campaigns named identically would never collide anyway.
This is a deliberate absence, not an oversight — nobody should "fix" it later.

## Settlement-account scope mutation

`SettlementAccountService.update` was label-only when ADR-0020 shipped it; ADR-0020's own Part 8
said scope mutation would land in this ticket. It now accepts `scopeType`/`scopeRefId` the same way
`CampaignService.update` does: two-sided authority (current scope and requested scope both), and a
`409` if any `Campaign` currently settling into the account would stop being covered by the
requested scope — checked as a negated Prisma query
(`SettlementAccountService.assertCampaignsStillCovered`) rather than a loop over `covers`, since a
loop would be one round-trip per linked campaign. It must stay behaviourally equivalent to calling
`covers(newScope, campaignScope)` per campaign — checked by hand against every case, including the
three-valued-logic edge case where a church-scoped campaign's `scopeRefId IS NULL` short-circuits
the `AND` to `FALSE` inside the `NOT`, correctly flagging it as orphaned. No dedicated spec proves
the two formulations agree against arbitrary inputs; `settlement-account.service.spec.ts` asserts
the exact `where` shape built for the region and branch cases instead. No
Paystack call is involved — scope decides who may manage and see the account, never where money
lands, so re-scoping never touches the subaccount.

## Consequences

- `apps/api/src/campaign/` exists for the first time: `CampaignController`, `CampaignService`,
  `CampaignModule`, and `packages/shared/src/campaign.ts`'s schemas.
- `Campaign.createdById` is now set from the caller on create. `Campaign.updatedAt` is a new
  `@updatedAt` column, backfilled to migration-run time for existing rows.
- Two new indexes replace the old ones: `@@index([churchId, status, scopeType, scopeRefId])` for
  the list path's filters, `@@index([churchId, title, id])` for its cursor ordering.
- `SettlementAccountService.update` grows scope mutation, documented above.
- The settlement attribution join #141 asked this ticket to record —
  `Payment.paymentAttemptId → PaymentAttempt.settlementAccountId → SettlementAccount.scopeType/scopeRefId`
  — is written up in
  [`docs/architecture/campaign-scope-and-settlement-routing.md`](../../../docs/architecture/campaign-scope-and-settlement-routing.md),
  alongside its caveat: both foreign keys in that chain are nullable, so the join attributes online
  giving only.
