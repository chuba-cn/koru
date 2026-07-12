# Standard error schema and list meta, no success envelope

Successful responses return the resource itself — the HTTP status code carries success semantics,
and we deliberately do **not** wrap responses in a `{ success, message, data }` envelope (it
restates what the status code already says, lets body and status contradict each other, and taxes
every schema and client). Instead we standardise the two things an envelope legitimately solves:
**every failure** (400/404/409/500) conforms to one `ErrorResponseSchema` in `packages/shared`,
enforced by a global exception filter and documented once in OpenAPI; and **paginated lists** use
a shared `{ data, meta }` shape (page, pageSize, totalItems, totalPages), applied from the first
genuinely paginated endpoint onward — small child lists stay raw arrays. A contributor expecting
the familiar envelope pattern should not "fix" its absence.
