# Self-managed stack; Paystack the only vendor dependency

We build on TanStack Start (web), NestJS (API), and self-hosted PostgreSQL rather than a managed
backend such as Convex, Supabase, or Firebase. We accept the extra plumbing this requires —
including hand-rolled real-time (see `apps/api` ADR-0003) — to keep the system portable and
vendor-independent; Paystack is the one unavoidable dependency because it is the money rail.
Chosen deliberately over Convex despite its stronger developer experience, both for control and
as a learning goal.
