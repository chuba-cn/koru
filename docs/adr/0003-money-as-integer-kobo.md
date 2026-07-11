# Money is stored as integer kobo

All monetary amounts are stored and passed as an integer number of kobo (₦1 = 100 kobo), never as
floating-point naira, because float arithmetic (`0.1 + 0.2 !== 0.3`) is unacceptable for
financial totals. The `Kobo` type and the naira⇄kobo helpers live in `packages/shared` so every
package shares one definition.
