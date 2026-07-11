# Zod schemas are the single source of truth, bridged to OpenAPI

Request/response contracts are defined once as Zod schemas in `packages/shared` and reused for
runtime validation (validation pipe), TypeScript types (`z.infer`), web-app form validation, and
API documentation — the OpenAPI/Swagger document is generated from these schemas via the
nestjs-zod bridge (`createZodDto`). We deliberately do **not** write `@nestjs/swagger` decorator
DTO classes, the idiomatic Nest approach, because they would duplicate every contract and drift
from the schemas that actually validate. Consequence: docs tooling must always go through the
Zod-to-OpenAPI path, and a Nest developer expecting `@ApiProperty()` classes should not "fix"
their absence.
