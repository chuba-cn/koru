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
A single physical congregation belonging to a Church.
_Avoid_: Location, Site, Parish

**Member**:
A person who gives, identified by phone number, with **no account and no login**.
_Avoid_: Donor, Giver, Congregant, User (a User/Staff has a login; a Member never does)

**Staff**:
A church worker with a login who administers KORU, holding a role and one or more scopes.
_Avoid_: User, Admin, Operator (Admin names a role, not the person)

### Giving

**Campaign**:
A fundraising effort with a monetary target and a Scope, that Members give toward.
_Avoid_: Project, Fund, Appeal, Drive

**Scope**:
The reach of a Campaign — the whole Church, one Region, or one Branch — which decides who sees
and is nudged for it.
_Avoid_: Audience, Visibility, Level

**Pledge**:
A Member's promise to give a specific amount to a Campaign. A commitment, not money yet.
_Avoid_: Commitment, Promise, Intent

**Payment**:
Actual money received toward a Campaign — by bank transfer, cash, POS, or import.
_Avoid_: Donation, Gift, Contribution, Transaction

**Fulfilment**:
The state a Pledge reaches when its successful Payments meet or exceed the pledged amount.
_Avoid_: Completion, Settlement (Settlement is a banking term — see the API context)

### Money

**Kobo**:
The unit all money is expressed in — an integer number of kobo (₦1 = 100 kobo). Never
floating-point naira.
_Avoid_: Naira, Amount, Decimal
