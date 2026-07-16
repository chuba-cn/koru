# Zod schemas are the single source of truth, bridged to OpenAPI

Request/response contracts are defined once as Zod schemas in `packages/shared` and reused for
runtime validation (validation pipe), TypeScript types (`z.infer`), web-app form validation, and
API documentation — the OpenAPI/Swagger document is generated from these schemas via the
nestjs-zod bridge (`createZodDto`). We deliberately do **not** write `@nestjs/swagger` decorator
DTO classes, the idiomatic Nest approach, because they would duplicate every contract and drift
from the schemas that actually validate. Consequence: docs tooling must always go through the
Zod-to-OpenAPI path, and a Nest developer expecting `@ApiProperty()` classes should not "fix"
their absence.

**The documentation surface is public and unauthenticated, deliberately.** `/docs`, `/schema.json`
and `/schema.yaml` are mounted straight onto the Express adapter, so they bypass Nest's pipeline
and never meet the global fail-closed `AuthGuard`. That is a decision, not an oversight: our API
shape is documentation, not a secret, and the guards are what protect data. What it publishes is
route and field *names* only — no `paystackSubaccountCode`, no `passwordHash`, and `accountNumber`
appears solely as an input field, since masking happens server-side. A reader should not "fix" the
missing auth on these routes; if the API surface ever becomes genuinely sensitive, the answer is
to stop serving docs publicly rather than to guard three Express routes.
