# An immutable double-entry ledger is the source of truth for money

Supersedes [ADR-0001](0001-payment-single-source-of-truth.md). Recorded for the giving & payments
epic #104.

Money raised is no longer authored by a mutable `Payment.status` row. The atom of truth is an
**append-only, double-entry `LedgerEntry`**. Every financial event posts a *balanced set* of
entries — debits and credits that sum to zero — grouped by a `transactionId` and keyed by a unique
`dedupeKey`. A posted entry is never updated and never deleted. A mistake is corrected by posting a
new, compensating transaction, so the full history of every naira stays visible and provable.

Campaign progress, pledge fulfilment, and member giving totals are **projections** derived from
the ledger — rebuildable at any time by replaying it — exactly as ADR-0001 already required for
totals. This ADR keeps that instinct and moves it one level down: ADR-0001 derived totals from a
mutable `Payment` row; we now derive them from immutable ledger entries, and `Payment` becomes a
read-optimized *settled-payment* projection, not the source.

## Why double-entry, not a signed single-entry log

A church-giving platform is not a bank, and full double-entry is more machinery than "sum the
payments." We adopt it anyway because the two things this epic exists to guarantee —
**auditability** and **reconciliation** — are precisely what double-entry gives and a signed log
does not:

- **Reconciliation against reality.** Money does not simply "arrive." A member transfers ₦10,000;
  Paystack takes a fee and later settles the remainder to a bank account. With a balanced ledger,
  *money in = money out + money on hand* holds as an invariant the reconciliation sweep (#108) can
  assert every day: gateway clearing, fees, and settlement payouts are their own accounts, and if
  they don't balance, something is wrong and we know before the church does. A signed single-entry
  log can total giving but cannot prove the money actually landed net of fees.
- **Corrections that don't lie.** A refund or chargeback (#111) posts opposite entries; the
  originals stay untouched. The net is correct *and* the history shows both the gift and its
  reversal. A mutable row would overwrite the truth.

Retrofitting double-entry later means rewriting every posting path and backfilling history from
lossy data — so it is a day-one decision, made now while there are zero payment rows to migrate.

## The chart of accounts

Deliberately small and church-giving-specific, not a general ledger:
`gateway_clearing` · `campaign_giving` · `fees` · `settlement_payout` · `refunds` · `cash_on_hand`.
Each posting names the accounts it debits and credits from this closed set. New accounts are a
schema decision, not something a request can invent.

## Consequences

- No endpoint, worker, or migration ever mutates a `LedgerEntry`. This is enforced in review and
  should be enforced in the data layer (no update/delete path on the ledger repository).
- Every posting carries a unique `dedupeKey`, so a webhook (#107) and the reconciliation sweep
  (#108) posting the same fact cannot double-count it — idempotency is a database constraint, not a
  hope.
- All amounts remain `BigInt` kobo per [ADR-0003](../../../docs/adr/0003-money-as-integer-kobo.md).
- Totals cost a sum or a projection read, never a mutable counter. If live sums get expensive at
  Celebration/Elevation scale (~50k members, hundreds of branches), the answer is the projection
  tables in #113, never a hand-maintained balance — the same trade ADR-0001 named.

## Companion decisions

Two decisions this design depends on are recorded in epic #104 and will be formalized as their own
ADRs when their tickets land, to keep this one focused:

- **Transactional outbox** (#106): the ledger posting and its `DomainEvent` are written in one
  Postgres transaction, so a crash can never post money without its event or vice versa.
- **DonationIntent → PaymentAttempt → settled Payment** (#105): the intent/attempt split that lets
  one intent carry retries, multiple methods, and partial payments.
