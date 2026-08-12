# Standard error schema and list pagination shape, no success envelope

Successful responses return the resource itself — the HTTP status code carries success semantics,
and we deliberately do **not** wrap responses in a `{ success, message, data }` envelope (it
restates what the status code already says, lets body and status contradict each other, and taxes
every schema and client). Instead we standardise the two things an envelope legitimately solves:
**every failure** (400/404/409/500) conforms to one `ErrorResponseSchema` in `packages/shared`,
enforced by a global exception filter and documented once in OpenAPI; and **paginated lists** use
a shared contract, applied from the first genuinely paginated endpoint onward — small child lists
stay raw arrays. A contributor expecting the familiar envelope pattern should not "fix" its
absence.

## Update (#82): the pagination shape is cursor-based, not offset-based

This ADR originally specified an offset shape for paginated lists: `{ data, meta }`, with
`meta` carrying `page`/`pageSize`/`totalItems`/`totalPages`. That shape was replaced, before any
endpoint shipped it, by the Relay-style cursor contract now in `packages/shared/src/pagination.ts`:

```ts
{ items, totalCount, hasNextPage, hasPreviousPage, startCursor, endCursor }
```

**Why the change:** offset pagination (`page`/`pageSize`) asks Postgres to skip `N` rows before
returning results — the further into a list a client pages, the more rows the database has to walk
past just to discard them. It also isn't stable: if a row is inserted or removed while a client is
paging, every subsequent page can shift, silently skipping or repeating rows. Cursor pagination
asks instead for "the `limit` rows after this specific row's position," which Postgres can serve
directly from an index with no skip-and-discard cost for the page itself, and which stays correct
regardless of concurrent inserts elsewhere in the table. (`totalCount` is a separate `COUNT(*)`
over the full filtered set on every request — cursor pagination doesn't make that free, and a
future ticket may need to drop or cache it if it becomes the bottleneck instead.) At KORU's target
scale — a single tenant with 30,000+
members and 500+ branches — this is not a micro-optimization to defer; it is the difference between
a list endpoint that stays fast as a roster grows and one that degrades with it. See
[chuba-cn/koru#81](https://github.com/chuba-cn/koru/issues/81) for the full scoping and
`StaffService.list` (`apps/api/src/staff/staff.service.ts`) for the reference implementation.

A future contributor should not "restore" the `{ data, meta }` shape to match this document's
original text — this update supersedes it.
