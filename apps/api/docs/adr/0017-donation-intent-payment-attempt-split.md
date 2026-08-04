# DonationIntent → PaymentAttempt → settled Payment is a three-stage split, not one row

Recorded for the giving & payments epic #104, part of #105's foundation schema. Referenced as a
companion decision in [ADR-0016](0016-double-entry-ledger-source-of-truth.md).

Giving toward a Campaign is now three models, not one:

- **`DonationIntent`** — what the giver wants to happen: a Member giving a specific `amountKobo`
  toward a Campaign, optionally against a Pledge. Carries an `idempotencyKey` so retrying the same
  request (a double-tapped submit, a client-side retry) never creates two intents.
- **`PaymentAttempt`** — one try at fulfilling that intent through a specific channel (Paystack
  transfer, cash, POS). A single intent can have several attempts: a Paystack virtual account that
  expires unpaid, followed by a cash payment that succeeds.
- **`Payment`** — the settled result. One row per succeeded attempt, immutable once written.

## Why not one `Payment` row that changes `status` over time

That was the previous design (`Payment.status: pending → success | failed | reversed`), and it
breaks the moment giving needs any of:

- **Retries.** A Paystack virtual account expires before the giver pays it. The old model has
  nowhere to put a second attempt without either mutating the first row's meaning or creating a
  second `Payment` for money that was never actually given twice.
- **Multiple methods for one intent.** A giver starts a Paystack transfer, abandons it, and a staff
  member records the same amount as cash instead. One intent, two attempts, one eventual payment —
  not representable as a single mutable row.
- **Partial payments.** Not built yet, but the split is what makes it representable later: several
  attempts, several settled `Payment`s, one intent.

A `pending`/`failed` `Payment` row is also a lie about what `Payment` means under
[ADR-0016](0016-double-entry-ledger-source-of-truth.md): the ledger is the source of truth for
money, and `Payment` is a read-optimized *settled* projection. A `Payment` that might still fail
was never actually settled — it was scaffolding for a state machine that belongs on
`PaymentAttempt` instead.

## Why `PaymentAttempt`, not just retrying `DonationIntent` itself

Keeping the attempt/retry state on `DonationIntent` directly would conflate "what the giver wants"
with "what has been tried so far." The intent's own fields (`amountKobo`, `campaignId`,
`idempotencyKey`) don't change across retries; the attempt's fields (`channel`, `providerReference`,
`expiresAt`, `cashApprovalStatus`) are different every time. Splitting them means an intent's
identity — the thing a giver's idempotency key protects — never gets rewritten by attempt-level
churn.

## Why `status` on the in-flight models but `state` on `Payment`

`DonationIntent.status`/`PaymentAttempt.status` name an in-flight lifecycle with room to move
sideways (`pending → processing → failed`, retryable). `Payment.state` names a settled record's
forward-only disposition (`settled → refunded/reversed`, never back) — the same distinction ADR-0016
already draws for `Payment` itself: not a status machine, a one-way record of what happened.

## Consequences

- `Payment.paidAt` is `NOT NULL` and `Payment.state` starts at `settled` — a `Payment` row cannot
  exist in an unsettled state by construction, not by convention.
- `PaymentAttempt.recordedById`/`cashApprovalStatus` exist for the cash/POS path (#109's dual
  approval builds on this), where a Staff member is the one recording the attempt, not a webhook.
- `DonationIntent.idempotencyKey` is the giver-facing idempotency boundary; `PaymentAttempt.
  providerReference` is the provider-facing one (Paystack's own reference for that specific try).
  They are not the same key and must not be conflated.
- Nothing in this schema enforces that a `DonationIntent`'s attempts sum correctly against its
  `amountKobo` — that invariant belongs to the service layer that creates attempts (#107/#109, not
  yet built), the same way #105 is schema only, no behavior.
