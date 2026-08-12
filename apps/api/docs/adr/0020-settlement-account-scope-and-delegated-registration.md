# Settlement Account scope is polymorphic, not a foreign key; registration is delegated by scope level

Recorded for #138. Amends [ADR-0013](0013-staff-role-capability-matrix.md)'s statement that
`SettlementAccountController` is `super_admin`-only.

`SettlementAccount` no longer carries a nullable `branchId`. It carries `scopeType` (`church` |
`region` | `branch`) and `scopeRefId`, the same pair `Campaign` already uses. Registering an
account is no longer `super_admin`-only at every level: a `regional_admin`, `branch_admin`, or
`finance` officer can register an account at the level their own `StaffScope` covers. `church`
level stays `super_admin`-only.

## Losing the foreign key is the benefit, not the price

The old shape, `branchId String? @relation(..., onDelete: SetNull)`, looked safer than it was.
Deleting a branch converted its settlement account to church-wide, silently, because `SetNull` has
no other behaviour to fall back to. `SettlementAccountService.list`'s old `{ branchId: null }` arm
then exposed that account's bank details to every delegated role in the church, not just the ones
who used to be able to see the branch's own account. Nothing about that deletion mentioned bank
accounts at all; a `super_admin` cleaning up an empty region would trigger it without knowing.

The new `scopeRefId` is a plain `String?`, deliberately with no foreign key, because a foreign key
is what produced that failure. Delete a branch now and the account's row is untouched: `scopeType`
still says `branch`, `scopeRefId` still names an id that no branch carries anymore. That dangling
id matches nobody's `coveredBranchIds`, so the account becomes visible to `super_admin` only. A
referential assumption failing now narrows access instead of widening it. Fail-closed replaced
fail-open, and that inversion, not "dangling refs are fine," is the actual design decision. An
earlier draft of this ticket described losing the foreign key as a cost to be accepted. It is the
opposite: it is what makes the resource-containment check unable to fail open.

The database still enforces the one invariant a foreign key would have: `scopeRefId` is null if and
only if `scopeType` is `church`. Prisma's schema language has no `CHECK`, so this is hand-written
SQL in the migration, on both `SettlementAccount` and `Campaign`. Verified empirically before
relying on it: a hand-written `CHECK`, once applied, survives a later `prisma migrate dev` with no
schema change and is reported as "already in sync," because Prisma's introspection does not read
`CHECK` constraints and the shadow database used for drift detection replays the same hand-edited
migration file. A `CHECK` added this way is not something a routine migration can silently drop.

## Why `church` stays `super_admin`-only

A church-scoped account is the one every church-wide campaign settles into. Nothing about `region`
or `branch` scoping narrows it, because there is nothing under "the whole church" to narrow to.
Widening `region` and `branch` registration to delegated roles is safe specifically because the
one account that can capture everything is still gated behind the role with church-wide authority
by definition. Loosen that one line and the rest of this design stops being safe to reason about.

## Why `ScopeType` was not widened to include `church`

The alternative to keeping `church` `super_admin`-only was adding a `church` value to `ScopeType`,
the enum `StaffScope` rows use, so a church-wide `finance` officer could be represented directly.
Considered and rejected, closed as
[#140](https://github.com/koru-app/koru/issues/140): `scopeCovers` treats a covering scope as
authority over everything inside it, so a church-scoped `StaffScope` would hand a non-`super_admin`
`regional_admin` church-wide reach through the exact same containment check that today correctly
stops a branch scope from reaching its own region. `ScopeType` stays `{ region, branch }`. Anyone
tempted to add `church` there should read #140 first.

## Two covering relations, and why they must not merge

`ScopeService.covers(churchId, outer, inner)` answers one question: does one `ScopeLevel` (the
reach of a resource, `church` | `region` | `branch`) contain another. `ScopeService.scopeCovers`
answers a different one: does a caller's `StaffScope` (the reach of a *person*, `region` | `branch`
only) grant authority over a target. `scopeCovers` is implemented on top of `covers`, so there is
exactly one containment rule underneath both, but that is the only coupling they are allowed to
have. `covers` will happily say a `church` scope contains anything; `scopeCovers` can never reach
that branch, because no `StaffScope` row is ever `church`-typed. Collapsing the two into one method
would either let a resource's reach stand in for a person's authority, or force `ScopeType` to grow
a `church` value it was just kept from growing. Keep them separate on purpose.

## The read/write asymmetry on church-scoped accounts

`SettlementAccountController.list` is readable by all four admin-tier roles. `create` and `update`
narrow `church`-level accounts to `super_admin` alone. This is not an inconsistency: a
`branch_admin` legitimately needs to see the church-wide account to pick it as the settlement
target for a branch-scoped campaign that settles upward ("the branch runs it, head office banks
it"), without ever being able to create or relabel that account themselves.

## The accepted disclosure

Widening `list` means `bankName`, `accountNumberMasked`, and `accountName` are now visible to
`regional_admin`, `branch_admin`, and `finance` for accounts within their own scope, and for the
church-wide account regardless of scope. `providerSubaccountCode` and `accountNumberHash` are never
returned to anyone, at any role. ADR-0013 called settlement-account data the most sensitive the API
holds; naming the three fields here, rather than pointing at the `publicShape` constant and leaving
the reader to go check it, is deliberate.

The disclosure is wider than "their own scope" alone: `list` resolves a branch-scoped caller's
visibility *up* to their containing region as well (`ScopeService.coveredRegionIds`), so a
`branch_admin` sees any region-scoped account over their branch's region too, not only
branch-scoped and church-wide accounts. This is the same read/write asymmetry as the section
above — visibility resolves upward, authority never does. A `branch_admin` cannot create, relabel,
or otherwise act on that region-scoped account; they can only see it, on the same "head office
banks it" reasoning as the church-wide case.

## What a future branch-delete endpoint owes

No `DELETE` exists on `BranchController` today. `RegionService.remove` now blocks on branches,
campaigns, and settlement accounts scoped to that region before it will delete one. A branch-delete
endpoint, whenever it is built, owes the identical check for campaigns and settlement accounts
scoped to that branch, or must explicitly re-scope them first. Skipping it reintroduces the exact
failure this ADR closes, one level down.

## Consequences

- `SettlementAccount.scopeType`/`scopeRefId` replace `branchId`. `CampaignScopeType` is renamed
  `ScopeLevel`, since it now describes a settlement account's reach as much as a campaign's.
- `ScopeService` gains `covers`, `assertScopeRefInChurch`, and threads `churchId` through
  `branchInRegion` and `scopeCovers`, all documented above.
- `SettlementAccountController` is `@StaffRoles('super_admin', 'regional_admin', 'branch_admin',
  'finance')` at the class level; `SettlementAccountService` narrows further per scope level and
  runs every authorization check before the first call to the payment gateway, since a subaccount
  registered at Paystack has no sweeper if the request is rejected afterward.
- `RegionService.remove` blocks on the same three counts a future branch-delete endpoint must
  also check.
