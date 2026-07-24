# Redis + BullMQ for background email jobs

Outbound email (koru-app/koru#64) is sent from a durable job queue, not inline in the request path
and not as unawaited fire-and-forget. `MailService.send` writes an `EmailLog` row and enqueues
`{ emailLogId }` onto a BullMQ `email` queue; a separate `EmailProcessor` worker is the only thing
that calls the real mail provider, updating `EmailLog` to `sent`/`failed` based on the outcome.
BullMQ's built-in exponential backoff (5 attempts, 10s base) rides out a short provider outage; a
send that exhausts every attempt is recorded as `EmailLog.status: failed`, which is KORU's
dead-letter signal — BullMQ has no separate DLQ concept, and this codebase does not invent one. The
staff-facing resend action (koru-app/koru#68) is the recovery path.

This reopens a call made in koru-app/koru#64's first draft — "no queue, sends stay inline,
mirroring how the staff-invite email is sent today" — on reliability grounds: an inline, awaited
send can hang or fail an unrelated core action (staff removal 500ing on a dead mail API), and an
unawaited one is silently lost on a crash or redeploy between responding and the send completing.
Both are unacceptable for a product handling real churches' money and staff changes.

**This closes the hang/500 failure mode outright, and narrows the silent-loss one — it does not
fully close it.** `MailService.send` writes the `EmailLog` row and enqueues the job as two separate
awaited calls, not one transaction. A crash in that narrow window leaves a row stuck at `status:
queued` forever, with no reconciliation sweep today to notice and re-enqueue it — accepted for now,
pre-launch and at this volume, and tracked as its own ticket (koru-app/koru#76) rather than solved
here. See [Email queue and delivery logging](../../../docs/architecture/email-queue-and-logging.md)
for the full picture.

`@nestjs/bullmq`
is the standard NestJS integration for BullMQ (not the older `@nestjs/bull`, which wraps the
deprecated Bull library); Redis is required, wired via one required `REDIS_URL`, no optional/disabled
state, because every email send now depends on it.

Redis runs alongside Postgres in the local `docker-compose.yml` for dev (`redis:7-alpine`,
`--appendonly yes` so in-flight jobs survive a container restart). In production, a managed Redis
add-on is used, not a hand-rolled server — the same test ADR-0002 already applies to Resend: a
managed instance is a pipe we talk to over the standard protocol, not a BaaS that owns any of
KORU's domain data. Job payloads are deliberately minimal (`{ emailLogId }` only); `EmailLog` in
Postgres stays the durable, tenant-scoped system of record, and nothing tenant-sensitive lives in
Redis even transiently. This does not reopen ADR-0002 — it is the same shape of exception Paystack
already is for money movement.

Consequence: this is the first background-job infrastructure in the codebase. The `email` queue
(koru-app/koru#73) is deliberately the only queue for now; a future job type (e.g. a Nudge-epic SMS
queue) should reuse the same `QueueModule`/Redis connection pattern rather than stand up a second
one, but that is that epic's own decision to make when it exists. Do not read this ADR as
authorizing a general-purpose task-queue free-for-all — every new queue is still a deliberate
architectural choice, not a default.
