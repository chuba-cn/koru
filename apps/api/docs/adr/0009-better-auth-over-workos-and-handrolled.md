# Authentication via Better Auth (self-hosted), not WorkOS or hand-rolled

We use **Better Auth** — a self-hosted, MIT-licensed TypeScript auth library — for authentication,
running in our own infrastructure against our own Postgres via its Prisma adapter, integrated into
NestJS through the community `@thallesp/nestjs-better-auth` module.

**Why not hand-rolled (the original plan):** security-critical crypto and session management
(hashing, session rotation, CSRF, rate limiting, OAuth, timing-attack resistance) are the most
common place a solo backend gets breached. Better Auth is maintained by a community focused solely
on this, and our chosen frontend (TanStack Start) has first-class Better Auth client support — so
hand-rolling would also mean hand-rolling the frontend session/refresh/OAuth handling.

**Why not WorkOS:** WorkOS is an excellent *hosted* identity vendor, but (a) it violates ADR-0002
(self-managed, portable, no managed-vendor except Paystack) by storing user identities on external
infrastructure and putting a third party in the login path; (b) its differentiated value is
enterprise identity — SAML SSO, SCIM directory sync, audit logs — which Nigerian churches (our
actual customers) will not use; (c) it adds transatlantic login latency/availability risk for a
Nigeria-first product; (d) our phone-OTP givers ("Members") fit a hosted enterprise IdP even worse
than they fit Better Auth. WorkOS would be the right call only if KORU later sells to large
enterprise/denominational buyers who mandate SSO/SCIM — which is speculative and post-MVP, and not
foreclosed: enterprise SSO can be added later via WorkOS or Better Auth's own SSO plugin.
