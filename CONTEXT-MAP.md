# Context Map

KORU is a **multi-context monorepo**: each workspace package is its own context, speaking a
shared core language.

## Contexts

- [Core Domain](./packages/shared/CONTEXT.md) — the **shared kernel**: the church-giving
  vocabulary and money types every package speaks (`packages/shared`).
- [API](./apps/api/CONTEXT.md) — **backend**: persistence, Paystack money movement,
  reconciliation, nudges, and imports (`apps/api`).
- **Web** (`apps/web`) — frontend member/staff/display experience. _CONTEXT.md to be created
  when the package is scaffolded._

## Relationships

- **Core Domain → API / Web**: `packages/shared` is a shared kernel; both apps import its types
  (`Kobo`, `Campaign`, `Pledge`, `Payment`…) and speak its language.
- **Web → API**: the web app calls the API over REST (via TanStack Query) and subscribes to its
  **SSE** stream for live Campaign progress.
- **API → Paystack**: the API owns all money movement — creating Subaccounts and Pay-with-Transfer
  transactions, and consuming Webhook Events for Reconciliation.

## Decisions

- System-wide ADRs: [`docs/adr/`](./docs/adr/)
- API-scoped ADRs: [`apps/api/docs/adr/`](./apps/api/docs/adr/)
