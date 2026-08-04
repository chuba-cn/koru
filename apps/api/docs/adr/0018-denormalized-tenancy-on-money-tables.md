# churchId and branchId are denormalized onto every money table

Recorded for the giving & payments epic #104, part of #105's foundation schema.

`DonationIntent`, `PaymentAttempt`, `Payment`, `LedgerEntry`, and `DomainEvent` each carry their own
`churchId` column, and most carry `branchId` too — even though every one of them is already
reachable from `Church` by walking through `Campaign`, `Pledge`, or `Member`. This is deliberate
duplication, not an oversight.

## Why not just join through Campaign

Every tenant-scoped query in this codebase filters by `churchId` first — see
[`docs/architecture.md`](../../../docs/architecture.md#every-tenant-owned-query-is-scoped)'s "every
tenant-owned query is scoped" rule, already enforced this way for `Region`, `Branch`, `Staff`, and
every other tenant-owned model. Without a direct `churchId` column, every money query would need an
extra join (`Payment → Campaign → Church`) just to enforce tenant isolation — the one check that
runs on every single request, for a product whose entire premise is that money never crosses a
Church boundary.

At Celebration Church International's scale (~30,000 members, 500+ branches — see #90's own framing
of this as the real launch, not a future-scale concern), that join cost is not hypothetical:
`LedgerEntry (churchId, createdAt)` is a hot-path index precisely because reconciliation and
dashboards read it constantly, and a joined query can't use a composite index the way a direct
column can.

## Why this doesn't reopen ADR-0001's "totals are always derived" rule

This is a different kind of duplication than a cached balance. `churchId` on a `Payment` row is
copied once, at write time, from data that is itself immutable once the row is settled — it is not
a running total that can drift from reality through concurrent updates. A `Payment`'s `churchId`
can never become stale, because a `Payment` row is never edited after it's written
([ADR-0016](0016-double-entry-ledger-source-of-truth.md)). Denormalizing an immutable fact is safe;
denormalizing a number that changes is what ADR-0001 warned against.

## Consequences

- Every write path that creates one of these rows (a future `DonationIntentService`, the outbox
  relay in #106, the reconciliation sweep in #108) must set `churchId`/`branchId` explicitly from
  the request's own tenant context — never inferred later from a join, and never left to a
  database trigger to backfill.
- `WebhookEvent.churchId` is the one exception, and stays nullable: a Paystack webhook arrives
  before its payload has been parsed against a Settlement Account, so the church isn't known yet at
  the moment the row is written. Every other money table's `churchId` is set at creation and never
  null.
- A future consistency check (not built in #105) could assert a row's denormalized `churchId`
  matches its `Campaign.churchId` — worth having once real write paths exist, not before.
