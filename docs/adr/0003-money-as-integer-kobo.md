# Money is stored as integer kobo

All monetary amounts are stored and passed as an integer number of kobo (₦1 = 100 kobo), never as
floating-point naira, because float arithmetic (`0.1 + 0.2 !== 0.3`) is unacceptable for
financial totals. The `Kobo` type and the naira⇄kobo helpers live in `packages/shared` so every
package shares one definition.

**Amended:** money columns (`Pledge.pledgeAmountKobo`, `Payment.amountKobo`,
`Campaign.targetAmountKobo`) are Postgres/Prisma `BigInt`, not `Int` — a 32-bit integer caps out
at ₦21.4m, too small for a real campaign target. `BigInt` doesn't survive `JSON.stringify`
(Node throws `TypeError: Do not know how to serialize a BigInt`), so it can never reach an HTTP
response directly. The bridge is `bigintToKobo`/`koboToBigint` in `packages/shared`: every
`BigInt` amount is converted to a plain `number` at the service boundary before a response is
built, and `Kobo` stays `number` end to end. This is safe, not just convenient — `bigintToKobo`
asserts the value is within `Number.MAX_SAFE_INTEGER` (≈₦90 trillion) and throws rather than
silently losing precision, and no KORU amount will ever approach that bound. Every future
endpoint returning money reuses this bridge; do not add a second conversion path.
