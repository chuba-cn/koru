# Tenant crossings return 403 Forbidden, not 404

When an authenticated Staff member addresses a `:churchId` that is not their own, `TenantGuard`
rejects the request with **403 Forbidden** ("You do not have access to this church") on every
method, rather than disguising the crossing as a 404. The guard resolves the session user's `Staff`
row and compares `Staff.churchId` to the path — a mismatch is a refusal, not a miss.

**Why 403 over 404:** the two codes answer different questions, and the frontend needs the
difference. 403 lets it render a truthful "you don't have access to this church" state; 404 would
collapse "you mistyped a UUID", "this church was deleted", and "this belongs to someone else" into
one indistinguishable response, leaving the UI to guess. The cost is an **existence leak**: an
authenticated Staff member can probe UUIDs and learn which ones name a real church. We accept it —
churches on KORU are not adversarial to each other, a UUID is not guessable in bulk, and knowing a
church id exists reveals nothing about its data (every subsequent request is still refused). This
is a deliberate trade, not an oversight.

**403 and 404 both exist, and mean different things.** 403 comes from the guard: wrong tenant.
404 comes from the service: the resource genuinely isn't in *your* church (`findFirst({ where: { id,
churchId } })` missing). So `PATCH /churches/{mine}/regions/{someone-elses-region}` is a 404 — you
may operate on your own church, that region simply isn't in it — while `PATCH
/churches/{someone-elses}/regions/{anything}` is a 403, refused before the handler runs. A
contributor should not "unify" these; the layer that rejects determines the code.

**Guards run before pipes**, so a malformed `:churchId` on a guarded route yields 403 (tenant
mismatch), not the 400 that `ParseUUIDPipe` would produce — the guard never gets a valid tenant to
match. The malformed-UUID 400 contract is exercised on a nested id inside an owned church instead.

If KORU later sells to buyers who require adversarial-grade tenant isolation (enterprise or
multi-denominational tiers where tenants genuinely distrust each other), revisit with a per-route
404-on-reads policy. Related: ADR-0010 (Better Auth boundary — `Staff.userId` is the link the guard
resolves through).
