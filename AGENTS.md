# @livefolio/fred

## Purpose
FRED (St. Louis Fed) `DataFeed` adapter for `@livefolio/sdk` v0.4. Wraps FRED's `series/observations` REST endpoint to implement the SDK's `DataFeed.bars` interface — narrows `Asset` to `MacroAsset`, calls FRED with the asset's `id` as the `series_id`, drops missing-value rows, and yields each observation as a degenerate OHLCV bar (`open=high=low=close=value`, `volume=0`). UTC-midnight timestamps.

The package is intentionally thin: pass-through cadence (monthly series stay monthly), no `fundamentals` / `events`, no upsampling. Designed to plug into `RoutingDataFeed`'s `macro` slot alongside `@livefolio/yfinance`.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Project manifest — `@livefolio/fred`, ES module, Node >=20 |
| `tsconfig.json` | TypeScript strict mode, ES2022 target, bundler module resolution, `noUncheckedIndexedAccess` |
| `tsup.config.ts` | tsup bundler configuration, `@livefolio/sdk` marked external |
| `vitest.config.ts` | Vitest test runner configuration |
| `eslint.config.js` | ESLint flat config with typescript-eslint and Prettier |
| `.prettierrc` | Prettier formatting rules (matches the SDK byte-for-byte) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | All TypeScript source code — adapter implementation and co-located tests |
| `docs/` | Design specs and implementation plans |

## For AI Agents

### Working In This Directory
- This is an ES module project (`"type": "module"`) — extensionless imports, bundled with tsup
- The SDK is consumed as a peer dependency; in this checkout it links to `../sdk` via `file:../sdk`
- `@livefolio/sdk` is marked `external` in `tsup.config.ts` so it is never inlined into `dist/`
- Native `fetch` (Node >=20) is the HTTP client — no `axios`, no `node-fetch`

### Testing Requirements
- Run `npm test` to execute all Vitest tests
- Tests use Vitest's `vi.fn()` and a `vi.spyOn(globalThis, 'fetch')` pattern for HTTP mocks — no real network connection
- A single integration test (`src/integration.test.ts`) hits the live FRED API and is gated on `process.env.FRED_API_KEY`; skipped without the key

### Common Patterns
- **Single class export**: `FredDataFeed` is the only consumer-facing surface
- **Injected fetcher seam**: the constructor accepts a `fetcher` option so tests can swap the live FRED client for a mocked one
- **Range-aware in-memory cache**: deduplicates bar fetches across overlapping ranges within a backtest
- **Pass-through cadence**: monthly/weekly/quarterly series surface at their native publish rate; the adapter never resamples

## Dependencies

### External (runtime)
- None — uses native `fetch` (Node >=20)

### Peer
- `@livefolio/sdk` — Provides `Asset`, `MacroAsset`, `Bar`, `DateRange`, `Frequency`, and the `DataFeed` interface

### Dev
- `tsup` — Bundler
- `vitest` — Test runner
- `typescript` — Compiler
- `eslint` + `typescript-eslint` — Linting
- `prettier` — Formatting
