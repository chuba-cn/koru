# Testing

Two layers, answering different questions. Both are required; neither replaces the other.

| Layer | Lives in | Needs a database | Answers |
|---|---|---|---|
| **Unit** | `src/**/*.spec.ts`, beside the code it tests | No | Does this unit behave correctly, including its edge cases? |
| **End-to-end** | `apps/api/test/**/*.e2e-spec.ts` | Yes | Does the whole path still work over HTTP? |

```bash
pnpm --filter @koru/api db:generate   # once per clone — the Prisma client is gitignored
pnpm test:unit                        # both packages, no Docker needed
pnpm --filter @koru/api test:e2e      # needs Postgres: docker compose up -d
pnpm --filter @koru/api test:unit:ui  # browser runner with a coverage tab
```

**A unit test must pass with Postgres stopped.** That is the line between the two layers. If a test needs a database, it is an end-to-end test and belongs in `test/`.

---

## Why both

End-to-end tests prove the system works. They are also expensive per branch: reaching one error path inside a service can cost a signup, a church bootstrap, two records and an HTTP round trip. The practical result is that we write the two cases we can be bothered with rather than all six.

Unit tests reach any branch in about a millisecond, need no database, and say *which line* broke rather than *which request* broke. They also reach cases end-to-end cannot: a guard receiving a malformed session, or a database connection dropping mid-write.

We have shipped two bugs that a unit test would have caught immediately — `TenantGuard` reading `session.userId` when the real shape is `session.user.id`, and guards missing from a module's `providers`. Both surfaced as mysterious 500s.

---

## What needs a spec test

**Services, guards, pipes, filters, and everything in `packages/shared`.** These hold the branching, the error mapping and the invariants, which is where unit tests pay best.

**Controllers get a wiring spec**, described below. They do not get delegation tests.

### Legitimate skips

A spec is required unless it would genuinely prove nothing:

- **`PrismaService`** — a constructor and a `$connect`. A test would assert the framework.
- **DTO classes** — `createZodDto` wrappers with no logic; the schemas they wrap are tested in `packages/shared`.
- **Composition roots** like `main.ts` and `setup-docs.ts` — covered at the e2e level, which is the right level for them.
- **Pure pass-through** with no branching, no mapping and no invariant.

**"It is hard to test" is not on that list.** If something is hard to test, that is usually the design talking, and it is worth listening to.

---

## Controller specs assert wiring, not delegation

This is the part most likely to be "helpfully" undone by someone who has read a NestJS tutorial, so the reasoning matters.

**Do not write this:**

```ts
const service = { create: vi.fn() };
const controller = new StaffController(service as never);
await controller.create('church-1', body);
expect(service.create).toHaveBeenCalledWith('church-1', body);
```

It is worthless here, for four specific reasons:

1. It does not exercise the guards — constructing the class directly skips the entire NestJS pipeline.
2. It does not exercise the validation pipe, or status codes.
3. It restates a one-line delegation, so it only fails when you deliberately change that line.
4. **It would pass even if the controller had no guards at all** — which is exactly the bug we shipped in [#12](https://github.com/koru-app/koru/issues/12).

The e2e suite already proves delegation works, over real HTTP. Repeating it against a mock adds maintenance and false confidence.

**Write this instead** — assert that the security wiring is attached:

```ts
const guardsOf = (target: object) =>
  ((Reflect.getMetadata('__guards__', target) as { name: string }[]) ?? []).map((g) => g.name);

expect(guardsOf(StaffController)).toEqual(['TenantGuard', 'RolesGuard']);
expect(new Reflector().get(STAFF_ROLES_KEY, StaffController)).toEqual(['super_admin']);
```

Every church-scoped controller missing its guard is a tenant breach. These assertions are the cheapest insurance in the codebase, and they catch a class of bug we have actually shipped.

### The metadata keys

Verified against the installed packages, not guessed:

| What | How to read it | Returns |
|---|---|---|
| `@StaffRoles('super_admin')` | `reflector.get(STAFF_ROLES_KEY, Controller)` | `['super_admin']` |
| `@UseGuards(A, B)` | `Reflect.getMetadata('__guards__', Controller)` | `[A, B]` — the classes, so use `.name` |
| `@AllowAnonymous()` | `Reflect.getMetadata('PUBLIC', Controller.prototype.method)` | `true` |

Two caveats worth knowing.

`__guards__` is an internal NestJS key rather than a documented API. It is stable in practice, and the alternative is not testing guard attachment at all — which we know from experience is worse.

`@AllowAnonymous()` writes the key `'PUBLIC'`, and the library **does not export a constant for it**; the string is inlined in its source. So a test must use the literal. That is a deliberate coupling: if the library ever renames it, our test breaks loudly, which is what we want, because our `@AllowAnonymous()` would have silently stopped working too.

### Assert the absence of a guard where that is the decision

`AcceptInviteController` is public on purpose, because the invitee has no session yet. A test states that:

```ts
expect(guardsOf(AcceptInviteController)).toEqual([]);
```

Without it, someone "tightening security" by adding `TenantGuard` would break every invite in the system, because there is no session for the guard to resolve.

---

## Assert behaviour, not calls

```ts
// Bad — tests the implementation, breaks on refactor, proves nothing
expect(prisma.region.create).toHaveBeenCalledWith({ data: { ... } });

// Good — tests the contract
await expect(service.create('c1', input)).rejects.toThrow(ConflictException);
```

The first passes even if the service swallows the error and returns nonsense. The second fails if the mapping breaks, which is the thing we care about.

The test to imagine: **if someone rewrote this method's internals but kept its contract, should my test still pass?** If the answer is no, it is measuring the wrong thing.

This is also why we fake Prisma by hand with `vi.fn()` rather than reaching for a deep-proxy mocking library. A hand-rolled fake keeps what is being faked visible in the test, and it makes asserting on calls *harder* — which is the habit this rule exists to discourage.

### Two documented exceptions

Sometimes the call **is** the contract, and refusing to assert it means asserting nothing.

**Tenant scoping.** The `churchId` in a `where` clause is not an implementation detail; it is the security boundary. A fake that ignores its arguments cannot tell `findFirst({ where: { id, churchId } })` from `findFirst({ where: { id } })`, and the second is a cross-tenant read. Make the fake behave like a small store that honours `where`, then assert the *behaviour* — that a lookup from another church rejects:

```ts
findFirst: vi.fn(({ where }) =>
  Promise.resolve(where.id === REGION.id && where.churchId === CHURCH ? REGION : null),
),

// then
await expect(service.findById('another-church', REGION.id)).rejects.toThrow(NotFoundException);
```

**Void methods whose effect is the call.** `remove()` returns nothing, so `resolves.toBeUndefined()` is satisfied by any path that does not throw — including one where the delete was removed entirely. The observable effect *is* the delete, so assert it:

```ts
expect(prisma.region.delete).toHaveBeenCalledWith({ where: { id: REGION.id } });
```

Both exceptions share a test: **would removing the line under test make this fail?** If not, the assertion is decorative regardless of which style it uses.

---

## Patterns

Copy from the exemplars rather than inventing a style:

| Pattern | Exemplar |
|---|---|
| Pure function | [`packages/shared/src/mask.spec.ts`](../../packages/shared/src/mask.spec.ts) |
| Guard, with a faked `ExecutionContext` | [`apps/api/src/auth/roles.guard.spec.ts`](../../apps/api/src/auth/roles.guard.spec.ts) |
| Service, with a hand-rolled Prisma fake | [`apps/api/src/region/region.service.spec.ts`](../../apps/api/src/region/region.service.spec.ts) |
| Controller wiring | [`apps/api/src/staff/staff.controller.spec.ts`](../../apps/api/src/staff/staff.controller.spec.ts) |

A guard only touches three things on its context, so fake exactly those rather than building a real one:

```ts
function contextWith(staff: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ staff }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}
```

---

## A wiring test must be able to fail

A test that cannot detect the problem it claims to catch is worse than no test, because it produces false confidence.

When you write one, prove it by mutation: remove the thing it asserts, watch it go red, then put it back. For the exemplar above, commenting out `@StaffRoles('super_admin')` produces:

```
FAIL  src/staff/staff.controller.spec.ts > StaffController wiring > requires super_admin
AssertionError: expected undefined to deeply equal [ 'super_admin' ]
```

That is the confirmation. Do this for any test whose whole purpose is to catch an omission.

---

## Coverage

`pnpm --filter @koru/api test:unit:ui` opens a browser runner with a coverage tab, and writes a standalone report to `coverage/`.

**Use coverage to find code you forgot to test. Do not treat the percentage as a score to maximise.**

There is deliberately **no coverage threshold**, and that is a decision rather than an oversight. A threshold enforced from a near-zero baseline rewards writing shallow tests that execute lines without asserting anything meaningful — the exact habit "assert behaviour, not calls" exists to prevent. Worth revisiting once [#31](https://github.com/koru-app/koru/issues/31) has backfilled the existing code and a number would measure something real.

---

## Layout and configuration

Unit tests sit **beside the code**; e2e tests stay in `test/`:

```
src/region/
  region.service.ts
  region.service.spec.ts     ← here
```

The file you need is one line away rather than in a parallel tree, so it actually gets opened and updated. The two `include` globs also never overlap, so each runner picks up exactly one kind of test. That second point matters: if they overlapped, the unit runner would try to execute the e2e tests without their `globalSetup` and produce a confusing pile of failures.

Two configuration details exist because of this layout, and should not be "tidied away":

- Both packages have a **`tsconfig.build.json`** that excludes `*.spec.ts`, and both the `build` and `dev` scripts point at it. Without that, spec files compile into `dist/` and ship inside the built package.
- The unit configs deliberately **do not set `globals: true`**, so specs import `describe`, `it`, `expect` and `vi` from `vitest` explicitly. Unit specs live under `src/`, which is type-checked and built; ambient test globals there would let a stray `expect()` or `vi.fn()` in a *service* pass type-checking, build into `dist`, and fail only at runtime in production. The e2e config keeps `globals: true` because `test/` is neither type-checked nor built.

In `packages/shared`, `moduleResolution` is `NodeNext`, so relative imports need a file extension even from a `.ts` file:

```ts
import { maskTail } from './mask.js';   // .js, though the file is mask.ts
```

That looks wrong and is correct; it is how the rest of that package already imports.

---

## CI

`pnpm test:unit` runs in the **`verify`** job, not `e2e`. That is the entire reason those two jobs are separate: `verify` needs no database and finishes in well under a minute, so the fast feedback stays fast. See [`ci-and-branching.md`](./ci-and-branching.md).
