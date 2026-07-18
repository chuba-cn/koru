# Staff invitations

How a super admin adds a colleague to their church, before any email infrastructure exists.

Part of the [architecture map](../architecture.md).

The short version: creating a staff member also mints a **single-use token**. The super admin sees that token exactly once and passes it on by hand, over WhatsApp or in person. Accepting it gives that person a real login and switches their staff record on.

---

## The cast

Five files, each with one job.

| File | Its one job |
|---|---|
| [`staff.controller.ts`](../../apps/api/src/staff/staff.controller.ts) | The front door for super admins. Checks who you are, then delegates. |
| [`staff.service.ts`](../../apps/api/src/staff/staff.service.ts) | Church rules. Creates the staff record, decides pending vs active. |
| [`staff-invite.service.ts`](../../apps/api/src/staff/staff-invite.service.ts) | The token expert. Mints them, hashes them, decides if one is still good. |
| [`accept-invite.controller.ts`](../../apps/api/src/staff/accept-invite.controller.ts) | A separate **public** front door, for the invited person. |
| [`accept-invite.service.ts`](../../apps/api/src/staff/accept-invite.service.ts) | Turns an accepted invite into a real login. |

```mermaid
graph TB
    SC["staff.controller<br/><i>super admin only</i>"]
    AC["accept-invite.controller<br/><i>public</i>"]
    SS["staff.service"]
    AS["accept-invite.service"]
    IS["<b>staff-invite.service</b><br/>no controller of its own"]
    BA["Better Auth<br/>auth.api.signUpEmail"]

    SC --> SS
    AC --> AS
    SS --> IS
    AS --> IS
    AS --> BA

    style IS stroke-width:3px
```

Note that **`staff-invite.service.ts` has no controller.** It never talks to the outside world directly. Both journeys reach it through another service, which is why all the token rules stay in one place.

---

## Journey A: a super admin adds a colleague

```mermaid
sequenceDiagram
    actor Admin as Super admin
    participant Guards
    participant Ctrl as staff.controller
    participant Svc as staff.service
    participant Inv as staff-invite.service
    participant DB as Postgres

    Admin->>Guards: POST /churches/{id}/staff
    Note over Guards: AuthGuard → TenantGuard → RolesGuard<br/>logged in? your church? super_admin?
    Guards->>Ctrl: all three pass
    Ctrl->>Svc: create(churchId, body)
    Svc->>DB: does the church exist?
    Svc->>DB: are the scopes in this church?
    Svc->>DB: INSERT Staff
    Note over DB: userId is NULL → "pending"
    Svc->>Inv: issue(staff.id)
    Inv->>Inv: randomBytes(32) → raw token
    Inv->>DB: INSERT StaffInvite (hash only)
    Inv-->>Svc: { token, expiresAt }
    Svc-->>Admin: staff + invite token
    Note over Admin: The ONLY time the raw<br/>token is ever visible
```

**Step by step, with the code:**

1. The three guards run before any of our code, because they sit on the controller class at [`staff.controller.ts:37-38`](../../apps/api/src/staff/staff.controller.ts). That is why there is no permission check inside `create` itself.
2. `StaffService.create` checks the church exists and the scopes belong to it.
3. The `Staff` row is inserted with **`userId` left empty**. Nothing links this person to a login yet, and filling that gap is what the whole invite system exists to do.
4. `StaffInviteService.issue` mints the token and stores only its hash.
5. The raw token comes back in the response, once.

### Where `status` comes from

`status` is **not stored in the database.** It is worked out fresh on every read, in `withStatus` at [`staff.service.ts:19-22`](../../apps/api/src/staff/staff.service.ts), by asking a single question:

```mermaid
flowchart LR
    Q{"Is userId set?"}
    Q -->|"NULL"| P["<b>pending</b><br/>invited, cannot log in"]
    Q -->|"set"| A["<b>active</b><br/>accepted, can log in"]
```

Because it is derived rather than stored, the status can never disagree with reality.

---

## How the token works

The token exists in two different forms, and only one of them is ever written down.

```mermaid
flowchart TB
    Gen["randomBytes(32)"] --> Raw["<b>RAW token</b><br/>xK9mP2vLq8..."]
    Raw -->|"returned ONCE<br/>in the response"| Admin["Super admin<br/>→ WhatsApp → colleague"]
    Raw -->|"sha256()"| Hash["<b>HASH</b><br/>a3f9c1..."]
    Hash -->|"stored"| DB[("StaffInvite.tokenHash")]

    style Raw stroke-width:3px
    style DB stroke-width:3px
```

The raw token leaves the server exactly once. Open the `StaffInvite` table and you will find only a hash, which cannot be turned back into the token.

So how is it verified later, if the real thing was never stored? By hashing whatever arrives and looking for a row with that hash:

```ts
// staff-invite.service.ts:47-50
const invite = await this.prisma.staffInvite.findUnique({
  where: { tokenHash: this.hash(rawToken) },
  include: { staff: true },
});
```

A correct token hashes to the stored value and the row is found. A wrong one hashes to something else and the lookup returns nothing. **We never compare the secret ourselves**, which is why there is no string comparison anywhere in that file.

### Why SHA-256 and not bcrypt

For user passwords the answer would be the opposite, so this is worth understanding rather than copying.

Slow hashes like bcrypt exist to protect **low-entropy** secrets. A human password might carry 30 bits of entropy, so an attacker holding the hash can guess their way in, and bcrypt's job is to make each guess expensive.

This token carries **256 bits from a cryptographic random source**. There is nothing to guess. Bcrypt would add real cost to every acceptance and buy nothing. What we still need from SHA-256 is that it is one-way, so a leaked database hands over no usable tokens, and it gives us that.

---

## Journey B: the colleague accepts

```mermaid
sequenceDiagram
    actor User as Invited person
    participant Ctrl as accept-invite.controller
    participant AS as accept-invite.service
    participant Inv as staff-invite.service
    participant BA as Better Auth
    participant DB as Postgres

    Note over User: No account. No session.<br/>Only the token.
    User->>Ctrl: POST /invites/accept { token, password }
    Note over Ctrl: @AllowAnonymous()<br/>guards step aside
    Ctrl->>AS: accept(body)
    AS->>Inv: peek, then claim(token)
    Inv->>DB: find by hash
    Inv->>Inv: isUsable? four checks
    alt any check fails
        Inv-->>User: 400 "This invite is no longer valid"
    end
    Inv-->>AS: invite + staff
    alt staff already has a login
        AS-->>User: 409 "already has a login"
    end
    AS->>BA: signUpEmail(name, email, password)
    Note over BA: creates user, hashes password,<br/>starts a session
    BA-->>AS: user + session cookie
    AS->>DB: UPDATE Staff SET userId
    Note over DB: status flips to "active"
    AS->>DB: UPDATE StaffInvite SET acceptedAt
    Note over DB: token is now spent
    AS-->>Ctrl: staff + cookies
    Ctrl-->>User: 201 + Set-Cookie
    Note over User: Logged in immediately
```

### Why this endpoint is public

Every other church route sits under `/churches/{churchId}/...` behind `TenantGuard`. That guard works by taking your session, finding your staff row, and checking it belongs to the church in the URL.

But this person has **no session and no staff link** — obtaining them is the entire point of accepting. Behind the guard, they would need to already be what the invite is trying to make them. So the route lives at the top level and is marked `@AllowAnonymous()` at [`accept-invite.controller.ts:17`](../../apps/api/src/staff/accept-invite.controller.ts).

**The token is the credential here**, which is exactly what an invite is.

### Why Better Auth creates the login

[`accept-invite.service.ts:20`](../../apps/api/src/staff/accept-invite.service.ts) hands the password to `auth.api.signUpEmail` rather than hashing it ourselves. Password hashing and session creation are precisely what we adopted Better Auth to avoid hand-rolling ([ADR-0009](../../apps/api/docs/adr/0009-better-auth-over-workos-and-handrolled.md)).

`asResponse: true` makes it hand back a full HTTP response including the session cookie, which the controller forwards. That is why accepting logs you straight in, instead of dropping you on a login page to retype the password you chose ten seconds earlier.

---

## When the email is already taken

Because signup is public and unverified, anyone can create a login holding a staff member's email before that person accepts. Left alone, that locks them out permanently, since `signUpEmail` refuses a duplicate.

```mermaid
flowchart TD
    A["accept() pre-flight"] --> B{"Does a login already<br/>hold this email?"}
    B -->|no| C["claim the token,<br/>provision, link"]
    B -->|yes| D["409 — ask an admin to reclaim"]

    D --> E["super_admin calls<br/>POST /staff/{id}/invite/reclaim"]
    E --> F{"Does that login own<br/>a Staff or Member?"}
    F -->|yes| G["409 — refuse, it is a real person"]
    F -->|no| H{"Created less than<br/>an hour ago?"}
    H -->|yes| I["409 — may be a founder mid-signup"]
    H -->|no| J["delete the Orphan Login,<br/>issue a fresh invite"]
    J --> C
```

Three guards make deleting someone's login defensible: it must own nothing, it must be older than the grace period, and the caller must be an authenticated super_admin of that church. **Linking the existing login instead would be privilege escalation** — an unverified email proves nothing about who controls it, so that would hand the squatter a finance-role account whose password they chose. See [ADR-0012](../../apps/api/docs/adr/0012-unverified-email-reserves-nothing.md).

## The gatekeeper: one function, four questions

The same four rules decide every rejection, and they are encoded twice in [`staff-invite.service.ts`](../../apps/api/src/staff/staff-invite.service.ts): once in `isUsable`, which the read-only `peek` uses, and once in the `where` clause of `claim`'s conditional `UPDATE`. Those two must stay in step.

```mermaid
flowchart TD
    S["claim(token)"] --> Q1{"Row with<br/>this hash?"}
    Q1 -->|no| R["❌ 400<br/><i>This invite is no longer valid</i>"]
    Q1 -->|yes| Q2{"acceptedAt<br/>still empty?"}
    Q2 -->|no| R
    Q2 -->|yes| Q3{"revokedAt<br/>still empty?"}
    Q3 -->|no| R
    Q3 -->|yes| Q4{"expiresAt in<br/>the future?"}
    Q4 -->|no| R
    Q4 -->|yes| OK["✓ usable"]

    style OK stroke-width:3px
    style R stroke-width:3px
```

Keeping all four in one place matters. Spread across the accept path, the re-issue path and the revoke path, one of the three would eventually be updated and the others forgotten.

**Every failure returns the same message.** Saying "this invite expired" would confirm to a stranger that the token they guessed was real. Saying the same thing in all four cases gives nothing away.

---

## The four scenarios

### Accepting twice

```mermaid
flowchart LR
    A1["First attempt"] --> S1["✓ acceptedAt: null → timestamp<br/>userId: null → user_abc"]
    A2["Second attempt"] --> S2["❌ acceptedAt is set<br/>→ 400"]
```

This is what makes the token single-use, and it matters because invites travel over WhatsApp, and WhatsApp messages get forwarded. Once the real person accepts, that message is worthless to anyone else.

Single-use is enforced by the claim itself: one conditional `UPDATE` that sets `acceptedAt` only while it is still null. Two concurrent accepts cannot both win, because the loser blocks on the row lock and then matches nothing. A separate check that the staff member has no login yet runs before the claim, so a burnt token only ever means a genuine fault.

### Re-issuing

```mermaid
sequenceDiagram
    actor Admin as Super admin
    participant Svc as staff.service
    participant Inv as staff-invite.service
    participant DB as Postgres

    Admin->>Svc: POST /staff/{id}/invite
    Svc->>DB: findById — scoped to THIS church
    alt already active
        Svc-->>Admin: 409 already accepted
    end
    Svc->>Inv: issue(id)
    rect rgb(240, 240, 240)
        Note over Inv,DB: ONE transaction
        Inv->>DB: revoke every live invite
        Inv->>DB: create the new one
    end
    Inv-->>Admin: new token
```

The transaction at [`staff-invite.service.ts:25`](../../apps/api/src/staff/staff-invite.service.ts) is the interesting part. Both statements succeed together or neither happens. If the revoke worked and the create failed, the person would be left with no usable invite and no clue why.

The ordering means **the old token dies the instant a new one is issued**. So if an invite goes to the wrong number, the fix is simply to re-issue.

The `findById` call is doing quiet security work: it scopes the lookup to the church in the URL, so a super admin of one church cannot re-issue invites for another church's staff.

### Revoking

```mermaid
flowchart LR
    D["DELETE /staff/{id}/invite"] --> R["revokedAt = now<br/>on every live invite"]
    R --> N["204 No Content"]
    R -.-> T["The token still exists<br/>in someone's WhatsApp,<br/>but gate 3 now rejects it"]
```

The staff record survives. The person stays in the list as `pending` with no working way in. To remove them entirely, use `DELETE /staff/{id}` instead.

### Expiring

Nobody does anything. One week after it was created, `expiresAt` slips into the past and the fourth gate starts rejecting it.

There is **no cleanup job** deleting old rows, on purpose. When someone asks "why can't Ada log in?", the table answers it: accepted, revoked, or expired.

---

## The whole thing on one page

```mermaid
stateDiagram-v2
    [*] --> Pending: super admin creates staff
    note right of Pending
        Staff row exists, userId is NULL
        Raw token shown once
    end note

    Pending --> Pending: re-issue<br/><i>old token dies</i>
    Pending --> Revoked: revoke
    Pending --> Expired: 7 days pass
    Pending --> Active: accept with valid token

    Revoked --> Pending: re-issue
    Expired --> Pending: re-issue

    note right of Active
        userId is set
        Login works, session issued
        Token is spent
    end note

    Active --> [*]
```

---

## Related decisions

- [ADR-0009](../../apps/api/docs/adr/0009-better-auth-over-workos-and-handrolled.md) — why Better Auth handles the password
- [ADR-0010](../../apps/api/docs/adr/0010-better-auth-boundary-and-identity.md) — why the invite lives in our table and not Better Auth's
- [ADR-0011](../../apps/api/docs/adr/0011-tenant-crossing-403-not-404.md) — why re-issuing across churches gives 404, not 403

## Deliberately not built

**Accepting with Google.** The invitee has no session, so Better Auth's `/link-social` is unavailable to them — it requires one. Supporting it would mean carrying the invite token through Google's OAuth round trip inside the `state` parameter, which is real complexity in the most security-sensitive path we have.

It is unnecessary, because the journey already works: accept with a password, which gives you a session, then use `POST /api/auth/link-social` to connect Google and sign in with it from then on. One extra step, once, and no new code.
