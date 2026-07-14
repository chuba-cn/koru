# Better Auth boundary: it owns authentication, KORU owns the domain

Better Auth owns **authentication only**: login identities (its `user`/`account` tables),
sessions, OAuth provider links (Google), email/password credentials, and phone-number OTP. It is
the source of truth for "who is logging in and how."

KORU keeps its **entire domain model** unchanged: `Church`, `Region`, `Branch`, `Staff`,
`StaffScope`, `Member`, and the giving cluster. These have no Better Auth equivalent, and our
hierarchy (two grouping levels + polymorphic scopes) is richer than Better Auth's organization/
teams model.

**We deliberately do NOT adopt Better Auth's organization plugin.** Our `Church → Region → Branch`
+ `StaffScope` model already expresses multi-tenancy and authorization more precisely than
org/member/teams, and it is already built and tested. Mapping Church↔organization and
Staff↔member would create a parallel structure and rework shipped, passing code for no net gain. A
contributor should not "add the org plugin" expecting simplification — it would fight our domain.

**The link:** every KORU person references a Better Auth `user` by id. `Staff.userId` is the
staff member's login identity; `Member.userId` is optional (set only when a giver logs in via
phone OTP). **Dual identity falls out naturally:** one Better Auth `user` can be pointed at by both
a `Staff` row and a `Member` row — the same human, two KORU roles, one login identity — so a staff
member who gives needs no special-case code. Tenant context is resolved from the authenticated
user's `Staff.churchId` (the tenant guard); staff **roles/scopes stay KORU's**, layered over
Better Auth's session by our own guards.
