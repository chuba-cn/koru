# KORU API

Backend concerns: persistence, money movement through Paystack, reconciliation, reminders, and
imports. Speaks the [Core Domain language](../../packages/shared/CONTEXT.md) and adds the terms
below. Pure glossary — no implementation details.

## Language

### Money movement

**Settlement Account**:
A Church's real bank account, registered with Paystack, into which a Campaign's money settles.
_Avoid_: Wallet, Purse, Bank Account (the domain term is Settlement Account)

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
_Avoid_: Virtual account (that names the mechanism, not the flow)

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
