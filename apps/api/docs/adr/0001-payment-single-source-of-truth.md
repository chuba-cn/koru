# Payment is the single source of truth for money raised

> **Superseded by [ADR-0016](0016-double-entry-ledger-source-of-truth.md).** The instinct here —
> totals are always *derived*, never a mutable cached balance — is kept. What changed: the atom of
> truth is no longer the mutable `Payment` row but an immutable, append-only double-entry
> `LedgerEntry`. Totals now derive from the ledger; `Payment` becomes a settled-payment projection.
> Read ADR-0016 for the current model.

Campaign progress and Pledge Fulfilment are always **derived** by summing successful Payments
(`SUM(amount) WHERE status = 'success'`); we never maintain a mutable running total such as
`amount_raised`. This trades read performance for correctness — a cached balance can silently
drift from reality, a derived one cannot. We may add a cached or materialised total later if reads
become a bottleneck, but the Payment ledger remains authoritative.
