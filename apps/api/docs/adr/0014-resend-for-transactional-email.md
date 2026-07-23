# Resend for transactional email

KORU has no mail provider. `MailSender` (`apps/api/src/notifications/mail-sender.ts`) is the same
shape `SmsSender` already established: a small interface, a `ConsoleMailSender` that logs to stdout
and refuses to run in production, and a real sender behind the same interface, chosen at boot by
`requireEnvPairOrNone('RESEND_API_KEY', 'MAIL_FROM')` — set both to send for real, set neither to
keep developing against the console, setting exactly one is a boot-time error rather than a silent
fallback.

**We chose Resend.** It is a plain HTTPS API call, not a BaaS: KORU's own domain is verified with
KORU's own DNS records (SPF/DKIM/DMARC), so nothing about KORU's data or domain model lives inside
Resend — it is a pipe email is sent *through*, the same relationship Paystack has to money movement
(ADR-0002). It has a workable free tier for pre-launch volume (invites, password resets — not bulk
sending), and the SDK accepts an idempotency key as a second argument on every send, which
`ResendMailSender` forwards whenever a caller supplies one — a retried send only becomes *provably*
rather than merely probably safe once every caller actually passes a key. Nothing forces that yet;
`idempotencyKey` is optional on `MailSender.send` because nothing in this ticket generates one.
`MailService` (planned, #66) will retry a failed send through a queue, and that is where the
guarantee becomes structural — this ticket only makes sure `ResendMailSender` doesn't need to change
to carry it through.

**"Nigeria-first" does not change this call the way it does for SMS.** `SmsSender`'s eventual real
implementation matters on local telco routing and cost per message, because an OTP has to reach a
Nigerian handset reliably. A staff member's email address is realistically a Gmail, Outlook, or
Yahoo mailbox regardless of where they live — there is no "African" deliverability advantage for
email the way there is for SMS. Cost and a clean, verifiable Node SDK are what actually distinguish
providers here.

**Rejected alternatives:**

- **Hand-rolled SMTP.** Bounce handling, IP reputation, and DKIM key rotation are real, ongoing
  operational burden for no benefit over a provider that already solves them.
- **AWS SES.** Cheaper at real scale, but requires a manual sandbox-to-production access request and
  more bounce/complaint-handling plumbing than a pre-launch product with a handful of pilot churches
  needs today.
- **A provider marketed specifically as "African."** Checked; none had comparable API ergonomics or
  a Node SDK verifiable against live docs the way Resend's is.

**Verified against Resend's current Node SDK**, not assumed: `resend.emails.send({ from, to,
subject, html }, { idempotencyKey })` — the idempotency key is a *second* argument object, not a
field inside the first — and the SDK returns `{ data, error }` rather than throwing on a
provider-side failure (a network-level failure, or a malformed API key, still throws normally).
`ResendMailSender.send` treats a non-null `error` as the only signal that a send failed; there is no
other way to notice.
