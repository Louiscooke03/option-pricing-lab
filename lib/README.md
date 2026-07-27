# lib/

Pure, typed, unit-tested TypeScript functions only.

Rules:

- No React, no DOM, no `window`/`document`, no JSX.
- No side effects — every export should be a pure function of its inputs (e.g. `priceCall(spot, strike, vol, rate, time): number`).
- No client/server framework imports (`next/*`, `react`).
- Every function here should be trivially unit-testable in isolation and safe to run in Node, the browser, or a test runner without mocking.

Components in `components/` call into this layer for numerics; this layer never imports from `components/`.
