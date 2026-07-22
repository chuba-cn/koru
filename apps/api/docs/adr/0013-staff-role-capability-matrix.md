# Staff role capability matrix

Five `StaffRole` values exist: `super_admin`, `regional_admin`, `branch_admin`, `finance`, and
`recorder`. This is the first place their capabilities are written down explicitly — until now,
each was defined only by whichever `@StaffRoles(...)` list a controller happened to carry.

**`super_admin`, `regional_admin`, `branch_admin`, and `finance` are admin-tier**: full
create/update/delete on org structure (regions, branches), scoped to what `StaffScope` grants them,
church-wide for `super_admin`. `finance` is admin-tier by design, not narrowed to `recorder`'s
shape — managing money settings is itself administrative, not merely recording transactions.

This does not mean every admin-tier role reaches every admin-tier resource today.
`SettlementAccountController` is deliberately `super_admin`-only, `finance` included — bank details
are the most sensitive data this API holds, and that route was locked down before this ADR existed.
Treat "admin-tier" as the default a new resource should assume for these four roles, not a promise
that every one of them already holds every admin capability; a resource can still be narrowed
further with its own reasoning, the way settlement accounts already are.

**`recorder` is read + one narrow write, nothing destructive.** Broad read across its scope, plus
recording Offline Payments and triggering Nudges once those endpoints exist (they don't yet — see
koru-app/koru#46). No create, no update, no delete, no staff management. It reuses the same
`StaffScope` model as the other scoped roles.

**A route with no `@StaffRoles` decorator is a deliberate open-read default, not an oversight.**
`RolesGuard` admits any tenant-matched staff role when no decorator is present — that's how every
`GET` in this codebase stays open to `recorder` without a second guard mechanism. It is not a gap
to "fix" by adding a decorator to every read route; it only becomes a real gap on a *mutating*
route, which is why `RegionController` and `BranchController`'s POST/PATCH/DELETE routes carry an
explicit admin-tier `@StaffRoles(...)` list (koru-app/koru#47) while their GET routes carry none.

Any future role must be placed on one side of this line explicitly — admin-tier (full CRUD within
scope) or `recorder`-tier (read + specific narrow writes) — rather than left to accumulate whatever
a controller's decorator list happened to admit.

## Amendment: staff creation is no longer super_admin-only

`regional_admin` and `branch_admin` can now create staff too, each capped at their own tier and
confined to their own scope — see
[Delegated staff onboarding](../../../docs/architecture/delegated-staff-onboarding.md)
(koru-app/koru#49). This does not change the role/tier lines drawn above; it changes who may
exercise the "admin-tier" staff-management capability that was previously reserved for
`super_admin` by omission rather than by design.
