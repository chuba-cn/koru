# KORU API

Backend concerns: persistence, money movement through Paystack, reconciliation, reminders, and
imports. Speaks the [Core Domain language](../../packages/shared/CONTEXT.md) and adds the terms
below. Pure glossary — no implementation details.

## Language

### Money movement

**Settlement Account**:
A Church's real bank account, registered with Paystack, into which a Campaign's money settles.
_Avoid_: Wallet, Purse, Bank Account (the domain term is Settlement Account)

**Settlement Account Scope**:
A Settlement Account's [Scope Level](../../packages/shared/CONTEXT.md), deciding who may register
or relabel it and who can see it at all.
_Avoid_: Branch account, Account owner, Staff Scope (a Staff Scope is where a *person* may act; a
Settlement Account Scope is where an *account* reaches)

**Settlement Routing**:
Which Settlement Account a Campaign's money lands in. Valid only when the account's Scope Level
covers or equals the Campaign's — upward is allowed (a Branch Campaign may bank into its Region's
or the Church's account), downward never is. Locked once the Campaign has any Payment, so a
Campaign's history stays explainable.
_Avoid_: Payout routing, Disbursement, Fulfilment (a Pledge is fulfilled; money is settled)

**Subaccount**:
The Paystack-side representation of a Settlement Account, used to route funds to it.
_Avoid_: Split account

**Settlement**:
Money actually landing in a Settlement Account. Strictly a banking term — never a synonym for
Pledge Fulfilment.
_Avoid_: using this word for a Pledge being fully paid (that is Fulfilment)

**Pay-with-Transfer**:
The payment flow where Paystack issues a one-time virtual account number for a single Payment;
the Member transfers to it and a Webhook Event confirms receipt.
_Avoid_: Virtual account (that names the mechanism, not the flow); Dedicated Virtual Account (a
distinct, permanent, per-customer Paystack product KORU does not use — ADR-0002)

**Payment Gateway**:
The port every call to a payment provider goes through — Paystack today, and any future provider
behind the same interface without the rest of the codebase knowing which one. `PaystackAdapter` is
its only implementation.
_Avoid_: Provider, Processor (Payment Gateway is specifically the interface; the concrete provider
is an Adapter)

**Charge Facts**:
The confirmed, fetched record of what actually happened to a charge — the only source a Ledger
posting is allowed to read amounts from. A Webhook Event is a trigger to go fetch Charge Facts, not
a source of truth on its own.
_Avoid_: Webhook payload, Transaction data (Charge Facts is specifically the fetched, normalized
shape — never the raw provider response)

**Reconciliation**:
Automatically matching an incoming Payment to its Member, Campaign, and Pledge from webhook
metadata.
_Avoid_: Matching, Clearing

**Offline Payment**:
A Payment recorded by Staff for money that did not flow through Paystack (cash, POS, or import).
_Avoid_: Manual payment, Cash entry

**Webhook Event**:
A signed notification from Paystack, deduplicated so Reconciliation stays idempotent.
_Avoid_: Callback, Hook

**Ledger Entry**:
One append-only debit or credit line in KORU's double-entry ledger, the source of truth for money
raised. Never updated or deleted — a correction posts a new, compensating entry instead.
_Avoid_: Transaction row, Log entry (a Ledger Entry is specifically one side of a balanced posting)

**Domain Event**:
A durable record of something that happened (a Donation Intent created, a Payment settled),
written in the same transaction as the fact it describes, and relayed onward by a worker. KORU's
transactional outbox.
_Avoid_: Event, Message (too generic — Domain Event is specifically the outbox row)

**Refund Request**:
A staff-initiated request to reverse a settled Payment, requiring separate requesting and approving
Staff — never the same person.
_Avoid_: Refund (Refund Request is the request; the actual reversal is a compensating Ledger Entry)

**Audit Log**:
The durable record of a money-affecting action and who took it, kept for every Church.
_Avoid_: Activity log, History (Audit Log is specifically the money-accountability record)

### Operations

**Nudge**:
An automated, system-sent reminder to a Member about a Pledge (SMS, or optional email).
_Avoid_: Reminder, Notification, Chase

**Follow-up**:
A manual, human contact (call or visit) that Staff log against a Pledge.
_Avoid_: Nudge (a Nudge is automated; a Follow-up is a person reaching out)

**Staff Scope**:
The Region(s) or Branch(es) a Staff member may act within.
_Avoid_: Permission, Role (a Role is *what* they may do; a Scope is *where*)

**Import Batch**:
A single spreadsheet upload of members/pledges/payments, previewed before it is committed.
_Avoid_: Upload, Job

**Email Log**:
The durable record of one outbound email KORU attempted to send — who, what, delivery status, and
(if it failed) why. Every email sent goes through this, queued and processed asynchronously so a
slow or down mail provider never blocks the action that triggered it.
_Avoid_: Notification (too broad — an Email Log is specifically the record of an email attempt)

### Identity

**Orphan Login**:
A Better Auth `user` that no `Staff` and no `Member` points at. It holds an email address but owns
no KORU data. Historical term from before email verification (ADR-0012) — the check for "owns
nothing" still exists, inside Clear.
_Avoid_: Ghost account, Unclaimed user

**Link** (staff onboarding):
A super_admin or delegated admin attaching an existing, **verified** Better Auth login to a pending
`Staff` record, instead of the person accepting an invite token. Safe because the tenant is vouching
for an identity it can actually check (ADR-0012 amendment).
_Avoid_: Reclaim, Attach, Merge

**Clear** (staff onboarding):
A super_admin deleting an **unverified** login squatting on a staff member's email address, then
issuing a fresh invite. The narrowed, grace-period-free successor to the old Reclaim mechanism —
`emailVerified` replaces the time-based guess Reclaim used to make.
_Avoid_: Reclaim, Release, Free, Take over
