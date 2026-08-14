# KORU Core Domain

The shared kernel: the vocabulary of the church-giving loop that every package speaks. Pure
glossary — no implementation details.

## Language

### Organisation & people

**Church**:
The top-level organisation and the tenant boundary; it owns everything beneath it.
_Avoid_: Organisation, Tenant (tenant is the technical framing of the same thing)

**Region**:
A grouping of Branches, usually a Nigerian state.
_Avoid_: State, Zone, Area

**Branch**:
A single physical congregation belonging to a Church. Its name is the church-wide handle people
use to identify it, so it is unique within the Church (not merely within a Region) — colliding
localities are disambiguated in the name itself (e.g. "Victoria Island (Lagos)").
_Avoid_: Location, Site, Parish

**Member**:
A person who gives, identified by phone number, with **no account and no login**.
_Avoid_: Donor, Giver, Congregant, User (a User/Staff has a login; a Member never does)

**Staff**:
A church worker with a login who administers KORU, holding a role and one or more scopes.
_Avoid_: User, Admin, Operator (Admin names a role, not the person)

**Scope Level**:
How far a scoped thing reaches: the whole Church, one Region, or one Branch. The reach of a
Campaign or a Settlement Account, never of a person.
_Avoid_: Scope Type (that names the Staff Scope enum, which has no church value on purpose),
Audience, Visibility

**Staff Scope**:
The Region(s) or Branch(es) a Staff member may act within. Never church-wide — church-wide
authority is the super_admin role, not a scope.
_Avoid_: Scope Level (a Scope Level is where a *resource* reaches; a Staff Scope is where a
*person* may act), Permission, Role (a Role is *what* they may do; a Scope is *where*)

### Giving

**Campaign**:
A fundraising effort with a monetary target and a Scope Level, that Members give toward. Names the
Settlement Account its giving lands in; its Scope Level is fixed once giving exists.
_Avoid_: Project, Fund, Appeal, Drive

**Pledge**:
A Member's promise to give a specific amount to a Campaign. A commitment, not money yet.
_Avoid_: Commitment, Promise, Intent

**Donation Intent**:
The payment-lifecycle attempt to fulfil a Pledge, or a one-off gift with no Pledge behind it. Not
the same thing as a Pledge, despite the shared word "intent" — a Pledge is the promise itself; a
Donation Intent is one specific try at turning some amount of money into a real Payment.
_Avoid_: Payment Intent, Transaction (Payment Attempt, below, is the specific try through one
channel; Donation Intent is what the giver wants, before any channel is chosen)

**Payment Attempt**:
One try at fulfilling a Donation Intent through a specific channel (Paystack transfer, cash, POS).
A single Donation Intent can have several Payment Attempts — an expired virtual account followed by
a successful cash payment is one Intent, two Attempts, one eventual Payment.
_Avoid_: Transaction, Charge

**Payment**:
Actual money received toward a Campaign — by bank transfer, cash, POS, or import. Settled and
immutable: a Payment row only exists once a Payment Attempt has succeeded.
_Avoid_: Donation, Gift, Contribution, Transaction

**Fulfilment**:
The state a Pledge reaches when its successful Payments meet or exceed the pledged amount.
_Avoid_: Completion, Settlement (Settlement is a banking term — see the API context)

### Money

**Kobo**:
The unit all money is expressed in — an integer number of kobo (₦1 = 100 kobo). Never
floating-point naira.
_Avoid_: Naira, Amount, Decimal
