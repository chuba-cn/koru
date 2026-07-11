# Payment is the single source of truth for money raised

Campaign progress and Pledge Fulfilment are always **derived** by summing successful Payments
(`SUM(amount) WHERE status = 'success'`); we never maintain a mutable running total such as
`amount_raised`. This trades read performance for correctness — a cached balance can silently
drift from reality, a derived one cannot. We may add a cached or materialised total later if reads
become a bottleneck, but the Payment ledger remains authoritative.
