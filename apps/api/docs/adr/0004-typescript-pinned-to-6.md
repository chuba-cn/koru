# TypeScript pinned to ^6 until Nest supports the TS 7.1 API

`apps/api` pins `typescript` to `^6` because TypeScript 7.0 (the native compiler) ships only the
`tsc` executable and dropped the programmatic compiler API that the Nest CLI requires; that API is
expected to return in 7.1. Do **not** "upgrade" to 7.x until Nest supports it — `nest build` will
fail. Easy to reverse, recorded only to stop a well-meaning dependency bump from breaking the build.
