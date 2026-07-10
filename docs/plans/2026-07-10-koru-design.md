# KORU — Church Pledge & Project-Giving Platform

**Date:** 2026-07-10
**Status:** Design agreed (pre-implementation)
**Author:** Chinemelum Chuba-Nwene

---

## 1. Problem & Vision

Nigerian churches raise money for projects (rent, building funds, buses, camps) through
**pledges**. Today the flow is manual and painful:

- Paper pledge cards are handed out; a welfare/finance team member later **chases** each
  person as their pledged date nears. It feels like *pursuing a debt* — awkward for both sides.
- Giving is mostly by **bank transfer** (sometimes cash or church POS), so someone has to
  **manually check the bank account and reconcile** each payment.
- There's **no live view** of a project's progress to show the congregation ("we've raised
  ₦18M of ₦25M").

**KORU** turns pledge campaigns into a **self-reconciling, dignified giving loop**. One cohesive
product serving three roles:

| Role | What KORU gives them |
|---|---|
| **Member** (giver) | Pledge and pay without ever being chased; see their own progress |
| **Finance / welfare team** | Auto-tracked payments, no manual reconciliation, follow-up logging |
| **Leadership / pastor** | Live public progress to broadcast (big screen, QR) |

**Positioning:** Global tools (Pushpay, Tithe.ly, Givelify, Planning Center) are card-first,
US-centric, tax-receipt-driven. Nigeria-aware suites (e.g. ChMeetings) bury pledges inside a
heavy admin suite. There is **no sharp, standalone "pledge campaign that reconciles itself"**
built for the Nigerian transfer-first reality. That's the gap KORU fills.

---

## 2. Scope

**In scope (MVP):**
- Multi-tenant SaaS, **Nigeria only**
- Church hierarchy with scoped campaigns
- Paystack-based collection, auto-reconciliation, direct-to-branch settlement
- No-account member flow (phone number + link + QR)
- Automated gentle nudges + manual follow-up logging
- Aggregate public progress display
- **CSV / Excel import** of existing campaign & pledge data (onboard a church mid-campaign)
- Two AI features: forecasting + natural-language finance queries

**Explicitly OUT of scope for MVP:**
- International branches / multi-currency (church has ~20 countries — deferred)
- Full member accounts / mobile app
- Donor walls / individual recognition on screen
- General church management (attendance, events, etc.)

---

## 3. Domain Model

```
Church (tenant)          e.g. Celebration Church — one KORU account, one Paystack business
 └─ Region / State        e.g. "Abuja (FCT)", "Lagos" — grouping layer
     └─ Branch            e.g. KORU Abuja, Usai, Garike
         └─ Member        belongs to a home branch; identity = phone number
```

- **Church** is the SaaS **tenant** boundary and owns the single Paystack business.
- **Region/State** is a grouping layer so campaigns can target "all of Abuja" without listing branches.
- **Member's home branch** determines which campaigns they see and are nudged for.

### Campaign scoping

A **Campaign** (e.g. "KORU Rent 2026") has a **scope**:

| Scope | Audience | Example |
|---|---|---|
| **Church-wide** | every member, all branches | "New national HQ" |
| **Region/State** | all branches in that state | "Abuja regional camp" |
| **Branch** | one branch only | "KORU Abuja rent" (Usai & Garike never see it) |

Same engine, one `scope` field. Branch-scoped campaigns are invisible to (and don't nudge)
members outside the scope.

### Permissions follow the tree

- **Branch admin** → manages their branch's campaigns only
- **Regional admin** → sees/manages their state
- **Church super-admin** → everything, owns church-wide campaigns

---

## 4. Payment Architecture (Paystack)

**Mental model: Paystack is a layer *on top of* the church's existing bank accounts — no new
bank accounts are opened.**

- **One Paystack business per church** (the tenant).
- Each existing purpose/branch bank account (offering, rent, building, per branch) is registered
  as a Paystack **subaccount** — a named **settlement destination**.
- **Settlement is direct-to-branch:** money for the KORU Rent campaign settles straight into
  KORU's rent bank account. (Decision: direct-to-branch, *not* central-then-allocate.)

### Reconciliation — Pay-with-Transfer

Because Nigerians pay mostly by **bank transfer**, the core flow is:

1. Member taps "Pay" (from a link or QR) toward a campaign.
2. Paystack generates a **one-time virtual account** for that transaction, stamped with
   **metadata** (`memberId`, `campaignId`, `branchId`).
3. Member transfers from their normal bank app to that account number.
4. Paystack fires a **`charge.success` webhook** → KORU records *who*, *how much*, *which
   campaign* → progress auto-updates and settlement routes to the correct subaccount.

**No manual bank-checking. No "confirm you paid" dance.**

- **Cash / church POS** gifts: admin records a **manual "offline payment"** against the pledge.
- **Webhooks are the backbone** → must be **idempotent** and verified (signature check),
  with a reconciliation/retry job for missed events.

> Note: exact Paystack routing config (split payment vs. subaccount, DVA vs. per-transaction
> transfer account) to be verified against live Paystack docs at build time. Shape is settled.

### Constraint

Paystack subaccounts / transfer features require a **registered Nigerian business + completed
Paystack go-live** per church. This is a real **onboarding gate** for each tenant.

---

## 5. Member Experience

- **No account required.** Identity = **phone number**.
- **Entry points (all the same pay flow):**
  - **WhatsApp / SMS link**
  - **QR code** — on the big screen during announcements, on bulletins/banners, and
    digitizing the old paper pledge cards. Scanning a campaign's QR drops the member straight
    into *that* scoped campaign, pre-tagged for reconciliation.
- **Optional phone + OTP** to view pledge history across campaigns (the system grows toward a
  light hybrid login later; not required to give).

---

## 6. Nudges & Follow-up

- **Automated, gentle, system-sent** (WhatsApp/SMS) — the reminder comes *from the system,
  not a person*, so no one feels like a debt collector and no member feels hunted.
- **Member-controlled rhythm** — member picks their cadence (e.g. "remind me on payday /
  monthly"); can pay anytime via their link/QR.
- **Manual follow-up + logging** — welfare team can still make a personal call/visit and
  **log that follow-up**, so there's a record, no double-chasing, and leadership can see who's
  had human contact.

---

## 7. Public Progress Display

- **Aggregate only:** "₦18.2M raised of ₦25M · 73% · 214 givers" + live progress bar + campaign QR.
- **No individual names** (dignified; avoids shaming; sidesteps privacy).
- (Deferred: anonymized momentum ticker, donor recognition — decided against for now.)

---

## 8. AI — Phased

Honest principle: AI must earn its place, not be bolted on.

| Phase | Feature | Why here |
|---|---|---|
| **MVP** | **Forecasting for leadership** — "at current rate, ₦18M of ₦25M by December; these campaigns are stalling" | Almost free once payment data flows; the "serious product" signal no NG competitor has |
| **MVP** | **Natural-language finance queries** — "Who pledged for the bus but hasn't paid?" / "How much came in this week?" (English/Pidgin) | High utility, low infra once data model exists |
| **v1.1** | **Smart nudge timing & tone** — learns each member's real pattern, warm non-pushy copy | Needs weeks of real history to be good |
| **v1.1** | **Milestone thank-you / encouragement** messages | Delight, low risk |
| **v1.2** | **Fuzzy reconciliation** — suggest a match when a transfer's name/account doesn't match the pledge | Highest risk (money-matching); add once volume exists |

---

## 8b. Data Import (CSV / Excel)

Many churches already track a running campaign in a spreadsheet. KORU must let them **import**
that data instead of re-entering it manually — critical for onboarding a campaign that's already
in progress.

- **Upload** a `.csv` / `.xlsx` of members and/or existing pledges/payments.
- **Column mapping UI** — map their columns (name, phone, pledged amount, amount paid so far,
  branch) to KORU fields, since every church's sheet is different.
- **Validation + preview + dry-run** — show what will be created/updated and flag errors
  (bad phone numbers, duplicate members, unknown branch) before committing.
- **Idempotent import** — re-importing an updated sheet updates existing records rather than
  duplicating (match on phone number within a church).
- Imported payments are recorded as **offline/manual** contributions (they didn't flow through
  Paystack), keeping the reconciliation source-of-truth honest.

---

## 9. Tech Stack

Chosen deliberately for **control, portability, and learning** (explicitly *not* a managed BaaS
like Convex/Supabase — the only unavoidable vendor dependency is Paystack, the money rail).

| Layer | Choice | Notes |
|---|---|---|
| **Frontend** | **TanStack Start** (React) + **TanStack Query** | Vite-based full-stack React; TanStack Router = type-safe routing; Query handles caching/refetch. **New to the team — learning goal.** |
| **Backend** | **NestJS** (self-managed) | Owns business logic, Paystack integration, webhooks. **Learning goal.** |
| **Database** | **PostgreSQL** (self-hosted/managed by us) | |
| **ORM** | **Prisma** (proposed) | Best learning material/DX; Drizzle/TypeORM are alternatives — revisit. |
| **Real-time** | **Server-Sent Events (SSE)** from NestJS | KORU's live needs (progress bar, dashboard counts) are one-directional → SSE is enough; WebSockets only if truly bidirectional need appears. Replaces Convex's sync engine. |
| **Payments** | **Paystack** | Subaccounts, pay-with-transfer, webhooks. |
| **Repo** | **Monorepo** — pnpm workspaces + Turborepo | Share types & Zod schemas across web + api (no drift). |
| **Lint/format** | **Biome** | Explicitly NOT ESLint/Prettier. Root-level, one config. |
| **Pre-commit** | **Husky + lint-staged** | Run Biome on staged files before commit. |
| **File parsing** | CSV/XLSX parser (backend) | For the data-import feature. |

### Monorepo layout

```
koru/
├─ apps/
│  ├─ web/          # TanStack Start frontend
│  └─ api/          # NestJS backend
├─ packages/
│  └─ shared/       # shared TS types + Zod schemas (Campaign, Pledge, Payment…)
├─ biome.json
├─ turbo.json
├─ pnpm-workspace.yaml
└─ package.json     # root: husky, lint-staged, scripts
```

### Architecture shape

```
[TanStack Start frontend] --REST/JSON--> [NestJS API] --> [PostgreSQL]
        ^  (TanStack Query + SSE for live progress)          |
        |                                                    |
   [Big-screen display page] <--SSE-- [NestJS] <--webhook-- [Paystack]
                                                     ^
                                          member transfer lands
```

---

## 10. Key Risks / Open Items

1. **Paystack go-live gate** per church (registered NG business) — onboarding friction; needs a
   clear onboarding flow.
2. **Webhook reliability** — idempotency, signature verification, retry/reconciliation job.
3. **Exact Paystack routing mechanism** (split vs subaccount vs DVA) — verify against live docs
   during build.
4. **Real-time without a sync engine** — SSE plumbing is on us (learning cost, acceptable).
5. **ORM choice** — Prisma proposed, not final.
6. **International expansion** — deliberately deferred; keep the data model currency-aware enough
   not to require a painful retrofit later.

---

## 11. Sources (landscape research)

- [The Lead Pastor — Best Online Giving Platforms 2026](https://theleadpastor.com/tools/best-online-giving-platforms-for-churches/)
- [Paystack — Dedicated Virtual Accounts docs](https://paystack.com/docs/payments/dedicated-virtual-accounts/)
- [Charitable — Accept Donations with Paystack](https://www.wpcharitable.com/accept-donations-with-paystack-a-leading-african-payment-gateway/)
