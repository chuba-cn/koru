# An unverified email address reserves nothing; only a super_admin may break a tie

> **Superseded in part by #59/#62/#63.** Email verification landed, which is exactly the trigger this
> ADR's own closing line named ("superseded the day... `requireEmailVerification` becomes
> available"). **Reclaim itself — the `invite/reclaim` route, the Orphan Login concept, the one-hour
> grace period — is retired** and this document is kept as the historical record of why it existed
> and the constraints that shaped it, not as a description of current behavior. The core rule below
> — an unverified address proves nothing, so linking on an unverified match is privilege escalation
> — is **still current** and still enforced, just by a different, narrower mechanism. See
> "What replaced reclaim" at the end of this document for what actually runs today.

`POST /api/auth/sign-up/email` is public and does not verify email addresses, because KORU has no
mail provider — that absence is the whole reason staff are onboarded by invite token rather than by
emailed link. The consequence is that anyone can create a Better Auth `user` holding any address,
including one a church is about to invite. Accepting the invite then fails, because `signUpEmail`
refuses a duplicate email, and the real staff member could never be onboarded. Re-issuing did not
help, and neither did deleting and recreating the `Staff` row: the blocker is the `user` row, and
nothing in the API could remove it.

**(Historical — reclaim itself is gone.) We treated an unverified address as reserving nothing.** A
login that held a staff email but owned no `Staff` and no `Member` was an *Orphan Login*, and an
authenticated super_admin of that church could **reclaim** it — `POST
/churches/:churchId/staff/:id/invite/reclaim` deleted that login through Better Auth's own
`internalAdapter.deleteUser` and issued a fresh invite. We were substituting a human inside the
tenant for a proof we could not obtain; the super_admin knows who their treasurer is. Three guards
bounded it: the login had to own nothing, it had to be older than a one-hour grace period so a
founder mid-signup was never destroyed, and the caller had to be a super_admin of the church that
owned the staff record. The narrower `clear-login` route that replaced it, below, keeps the
owns-nothing check and drops the grace period, now that `emailVerified` answers the question the
grace period could only approximate.

**Staff creation deliberately does not reject an email that already has a login — this part is still
true.** Blocking there looks like helpful fail-fast and is in fact a deadlock: the recovery routes
are addressed by staff id, so refusing to create the staff row makes recovery unreachable for the
exact case this ADR exists to fix — a stranger who registers the address *before* the church adds the
person. It also turned staff creation into an account-existence oracle for any address on the
platform, since church founding is self-serve. The collision still surfaces at accept time instead,
where the caller is now told whether to ask an administrator to link or to clear, depending on
whether the colliding login is verified.

**Do not "fix" this by linking the existing login when the emails match — still true, with one
qualifier that only became meaningful once verification existed.** An *unverified* matching address
proves nothing about who controls it, so linking on the unauthenticated accept path would hand the
squatter a working finance-role account whose password they chose — turning a denial of service into
privilege escalation. That reasoning never applied to a *verified* address, it simply had no way to
distinguish one from the other before #59. Once `emailVerified` is a real fact, linking a **verified**
login through an **authenticated admin route** (`link-login`, #63) is a different, safe operation:
the tenant is vouching for an identity it can actually check, on a route only a super_admin or a
delegated admin with authority over that staff record can reach — not the public, unauthenticated
accept path this paragraph was written about. Equally, do not delete the login on the unauthenticated
accept path: invite tokens get forwarded and pasted into chats, so that would make any leaked token an
account-deletion primitive. Deletion (`clear-login`, #62) still requires an authenticated human,
deliberately, and only for a login that remains unverified.

**We rejected Better Auth's admin plugin.** Its `createUser` is callable without a session, but
`removeUser` and `setUserPassword` are not — `adminMiddleware` throws `UNAUTHORIZED` unconditionally,
even server-side, which the library's docs do not make clear. The only way to satisfy it would be to
grant church super_admins a Better Auth `admin` role, which also grants `listUsers` and
`impersonateUser` across **every tenant**. That is a multi-tenancy breach, so we call
`internalAdapter.deleteUser` directly instead, wrapped in `AuthUsersService` so an upgrade breaks one
file. It is a semi-public API and the e2e suite pins it.

Accepting an invite now claims the token with a single conditional `UPDATE` before any provisioning,
so single-use is a property of the invite row rather than an accident of `user.email` being unique in
another subsystem. Cheap validations run before the claim, because claiming burns the token whatever
happens next, and a provisioning failure that is *not* a duplicate email releases the claim so the
invitee can retry. The two Prisma writes that follow are one transaction, and
`StaffInvite.provisionedUserId` records which login was provisioned — forensic only today, so that a
crash between Better Auth's commit and ours leaves a recognisable signature (`acceptedAt` set,
`provisionedUserId` null) rather than an inexplicable state.

**(Historical.)** Reclaim was a mitigation, not a cure, and its limits were worth stating plainly.
Without verification there was no technical way to tell the squatter from the invitee. The grace
period protected a bystander mid-signup; it did not deter an attacker, who could re-register and
wait, and it handed them a cheap way to re-block an address for an hour. The ownership check and the
delete were not one transaction, so a holder who founded a church in that window lost their login and
left a church whose only super_admin could not sign in — detected and logged rather than prevented.
`internalAdapter.deleteUser` is itself three sequential deletes with no transaction, so an interrupted
delete can still leave a credential-less user row today, in `clear-login` exactly as it could in
reclaim; that part of the risk did not change. There is no audit model beyond a log line.

---

## What replaced reclaim (#59, #62, #63)

`emailVerified` turned "is this login provably the invitee's" from an unanswerable question into a
plain boolean read off the `User` row. That collapses the old three-way grace-period/ownership dance
into one branch:

- **Verified → link it.** `POST /churches/:churchId/staff/:id/link-login` attaches the login to the
  pending staff record. Available to a super_admin or any delegated admin with authority over that
  staff record — the same roles that could already onboard this person by invite.
- **Unverified → clear it.** `POST /churches/:churchId/staff/:id/invite/clear-login` deletes the
  login (still via `AuthUsersService`/`internalAdapter.deleteUser`, still bounded by "owns nothing")
  and issues a fresh invite. Super_admin-only: deleting another person's account is irreversible and
  reaches outside the tenant's own data, even when that account is confirmed to own nothing — a
  materially different action than attaching a `userId` column, which is why it keeps the narrower
  role than linking does.

Full detail, sequence diagrams, and the acceptance-time error messages for both paths live in
[`docs/architecture/staff-invitations.md`](../../../docs/architecture/staff-invitations.md#when-the-email-is-already-taken).
