# Members are identified by phone number, with no account required

A Member has no password and needs no account to be given a pledge or make a payment; their phone
number is their identity, and they reach KORU via a link or QR code. This minimises friction for
givers — many of whom will not install or register for anything — at the cost of weaker identity
guarantees. Anonymous Payments (no Member attached at all) are also permitted.

**Amended:** a Member may *optionally* upgrade to a passwordless login, using Better Auth's
phone-number OTP plugin, then join a specific church via `POST /join/:churchId`. Verifying a phone
never creates or links a `Member` by itself — joining is a deliberate, per-church act, because a
same-phone `Member` in one church says nothing about a person's relationship to another. A phone
number can be reassigned (Nigerian SIM recycling); a `Member` row already linked to a different
login is refused with 409, never silently reassigned. Staff, by contrast, are Users with real logins
from the start ([ADR-0009](../apps/api/docs/adr/0009-better-auth-over-workos-and-handrolled.md),
[ADR-0010](../apps/api/docs/adr/0010-better-auth-boundary-and-identity.md)).
