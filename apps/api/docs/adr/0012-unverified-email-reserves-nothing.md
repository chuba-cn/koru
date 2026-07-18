# An unverified email address reserves nothing; only a super_admin may break a tie

`POST /api/auth/sign-up/email` is public and does not verify email addresses, because KORU has no
mail provider — that absence is the whole reason staff are onboarded by invite token rather than by
emailed link. The consequence is that anyone can create a Better Auth `user` holding any address,
including one a church is about to invite. Accepting the invite then fails, because `signUpEmail`
refuses a duplicate email, and the real staff member could never be onboarded. Re-issuing did not
help, and neither did deleting and recreating the `Staff` row: the blocker is the `user` row, and
nothing in the API could remove it.

**We treat an unverified address as reserving nothing.** A login that holds a staff email but owns
no `Staff` and no `Member` is an *Orphan Login*, and an authenticated super_admin of that church may
**reclaim** it — `POST /churches/:churchId/staff/:id/invite/reclaim` deletes that login through
Better Auth's own `internalAdapter.deleteUser` and issues a fresh invite. We are substituting a
human inside the tenant for a proof we cannot obtain; the super_admin knows who their treasurer is.
Three guards bound it: the login must own nothing, it must be older than a one-hour grace period so
a founder mid-signup is never destroyed, and the caller must be a super_admin of the church that
owns the staff record.

**Staff creation deliberately does not reject an email that already has a login.** Blocking there
looks like helpful fail-fast and is in fact a deadlock: reclaim is addressed by staff id, so
refusing to create the staff row makes the recovery path unreachable for the exact case this ADR
exists to fix — a stranger who registers the address *before* the church adds the person. It also
turned staff creation into an account-existence oracle for any address on the platform, since church
founding is self-serve. The collision surfaces at accept time instead, where the caller is told to
ask an administrator to reclaim.

**Do not "fix" this by linking the existing login when the emails match.** Since signup is
unverified, a matching address proves nothing about who controls it, so linking would hand the
squatter a working finance-role account whose password they chose — turning a denial of service into
privilege escalation. Equally, do not delete the login on the unauthenticated accept path: invite
tokens get forwarded and pasted into chats, so that would make any leaked token an account-deletion
primitive. Deletion requires an authenticated human, deliberately.

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

This is a mitigation, not a cure, and its limits are worth stating plainly. Without verification there
is no technical way to tell the squatter from the invitee. The grace period protects a bystander
mid-signup; it does not deter an attacker, who can re-register and wait, and it hands them a cheap way
to re-block an address for an hour. The ownership check and the delete are not one transaction, so a
holder who founds a church in that window loses their login and leaves a church whose only
super_admin cannot sign in — we detect and log that rather than prevent it. `internalAdapter.deleteUser`
is itself three sequential deletes with no transaction, so an interrupted reclaim can leave a
credential-less user row; it is reclaimable again, and no `verification` rows are touched, which
matters only once verification exists. There is no audit model, so a reclaim leaves only a log line.

All of this is superseded the day a mail provider lands and
`emailAndPassword.requireEmailVerification` becomes available. `disableSignUp` would remove the root
cause outright but would also break church founding, which obtains its session that way.
