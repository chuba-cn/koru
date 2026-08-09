# The payment gateway is a port; Paystack is its only adapter

Recorded for the giving & payments epic #104, ahead of #107. Amends one sentence in
[ADR-0002](0002-paystack-subaccounts-pay-with-transfer.md).

Every call to Paystack's API — creating a charge, verifying a webhook signature, fetching a
transaction, initiating a refund — goes through a small `PaymentGateway` interface in
`apps/api/src/payments/gateway/`, never called directly from a service. Paystack becomes one
adapter behind that interface, `PaystackAdapter`. No second provider is being built. This ADR is
about where the seam goes, not about adding Korapay or anyone else.

## Why a port, when there is only one provider

This is not speculative generality. Three of the port's shape decisions already fix problems only
Paystack has. Each is cheap now on empty schema but expensive later on live money data.

**The webhook is a trigger, not a fact.** Paystack's webhook body is untrusted input. Its `fees`
field is sometimes a string, sometimes a number. Nothing stops a forged or replayed body from
reaching the handler. The port's `fetchCharge()` is the *only* source a posting is allowed to read
from — the webhook's job is to say "go check," not to report what happened. This also collapses
the webhook path and the reconciliation sweep (#108) onto one code path: both produce a
`ChargeFacts` and call the same `postCharge(facts)`. A late webhook and a sweep that independently
found the same charge cannot disagree with each other, because there is only one place that turns
provider data into a ledger posting.

**Dedupe keys are derived, not assumed.** Paystack gives no event id anywhere in a webhook payload
or its headers — not for charges, not for refunds. `WebhookEvent.paystackEventId String @unique`
describes a field Paystack does not send. The key has to be derived per event family (a charge
event keys on the transaction id; a refund event, which carries no id at all, keys on
`transaction_reference` + `status`). Name the column `providerEventKey` and make derivation an
adapter responsibility. This stops developers from wrongly assuming Paystack supplies an event id.

**The provider touches three things, not the whole codebase.** `LedgerService`, `OutboxService`,
the relay, and every consumer built on #106 already only ever see `DomainEventPayload` and
`LedgerEntry` — these components never depended on Paystack. The port formalizes that boundary at
the one place that *was* implicitly Paystack-shaped: the webhook receiver and the charge-creation
call.

## What changes in the schema

- `WebhookEvent.paystackEventId` → `provider` (enum) + `providerEventKey` (string), unique
  together. A provider-agnostic name for a value we already knew had to be derived, not supplied.
- `PaymentAttempt.provider` (nullable enum) — records which channel this specific try used.
  [ADR-0017](0017-donation-intent-payment-attempt-split.md) already puts channel-specific fields on
  `PaymentAttempt`, not `DonationIntent`, because they "are different every time." Provider is one
  more such field, not a new concept.
- `LedgerEntry.provider` (nullable enum) — a filter dimension, not a new account.
  [ADR-0016](0016-double-entry-ledger-source-of-truth.md)'s chart of accounts stays exactly as
  written; `WHERE account = 'gateway_clearing' AND provider = 'paystack'` proves a provider's
  clearing balance without forking the account taxonomy.
- `Payment.paystackReference` → `providerReference`, plus `Payment.provider` (nullable enum) —
  `Payment` already carries `providerReference`; a reference with no provider beside it is
  ambiguous the moment it needs disambiguating, the same ambiguity the other four changes remove.
- `PaymentAttempt.failureReason` (nullable string) and `@@index([status, expiresAt])` — needed by
  #107's expiry sweep and `bank.transfer.rejected` handling, added in the same migration as the
  provider columns rather than as a second one.
- `SettlementAccount.bankCode`, `.accountName`, and `@unique` on `.paystackSubaccountCode` — #107's
  subaccount registration needs a bank code (Paystack requires one, not a name) and a
  provider-resolved account name; the `@unique` constraint is load-bearing for
  `PaymentSettlementService`'s cross-tenant subaccount check, not just hygiene.

All these changes land on tables with zero rows today. This ADR exists so they land once, now,
instead of as a migration on live money data later.

## What does not change

[ADR-0002](0002-paystack-subaccounts-pay-with-transfer.md)'s actual decision — subaccounts,
pay-with-transfer, `charge.success` — is untouched and still the only implementation. This ADR
amends only that ADR's closing sentence, "money movement is locked to Paystack." The *choice*
stays Paystack; what changes is that the rest of the codebase no longer has to know that.

## Consequences

- `apps/api/src/payments/gateway/` holds the `PaymentGateway` interface, its normalized result
  types (`ChargeFacts`, `RefundFacts`, …), and `PaystackAdapter`. The normalized Zod schemas live
  in `packages/shared`, per [ADR-0005](0005-zod-single-source-openapi.md). Developers can test
  them without running Postgres.
- `POST /webhooks/paystack` verifies the signature and persists to the `WebhookEvent` inbox; it
  never posts a ledger entry directly. The worker that does the posting calls `fetchCharge()`
  first, always — the worker never trusts the webhook body's amount.
- A second provider, if one is ever added, would implement the same interface and declare which
  capabilities it lacks (Paystack's `GET /settlement` has no guaranteed equivalent elsewhere, for
  instance) rather than forcing the interface down to the smallest common set. We do not schedule
  a second provider; we shape the interface this way because it is already right for one.
