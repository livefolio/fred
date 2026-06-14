# `@livefolio/fred-mcp` Design

**Status:** Draft
**Date:** 2026-06-14
**Owns:** A local, stdio Model Context Protocol (MCP) server that exposes the `@livefolio/fred` adapter's read-only FRED (St. Louis Fed) capability — historical macro observations over a date range — as an agent-callable tool. Published from the `fred/` repo as a workspace package alongside `@livefolio/fred` (the Node adapter), mirroring the pattern established by `@livefolio/yfinance-mcp`.

## Goal

Let an MCP-capable agent (Claude Desktop, Claude Code, Cursor, …) look up FRED macro time series conversationally by spawning a single local binary over stdio. One tool — `get_observations` — maps one-to-one onto the adapter's existing observation surface. The server is a thin, faithful, **read-only** wrapper: it adds an MCP protocol layer and nothing else. It calls the adapter's published function, so data semantics (missing-value drop, UTC-midnight timestamps, pass-through cadence, inclusive date bounds) are identical to using the adapter directly.

## Non-goals

- **HTTP / SSE / remote transport.** stdio only; one local process per client. The tool/handler layer stays transport-agnostic so an HTTP entry point is additive later, but no HTTP is built now.
- **Latest-value / quote tool.** A `get_latest_observation` tool is a natural sibling, but the underlying `fetchLatestFredObservation` lives on the unmerged `feat/quote-feed` branch, not `main`. Deferred until that merges (see Follow-ups).
- **Batch / multi-series tool.** FRED's `series/observations` endpoint is one series per request — there is no single-round-trip batch (unlike Yahoo's quote batch). A multi-series tool would just be N sequential calls; not built. The agent calls `get_observations` per series.
- **Derived / computed helpers** (period change %, YoY, summary stats, latest-N). The agent post-processes raw observations itself.
- **Series search / free-text lookup** ("unemployment rate" → `UNRATE`). Not in the adapter; would reach past the package boundary into FRED's `series/search` endpoint.
- **Non-macro assets.** Macro series only, matching `assetToFredSeriesId` (which throws on other kinds).
- **Non-`1d` cadence resampling.** FRED is pass-through: monthly/weekly/quarterly/daily series surface at their native publish rate. The adapter never resamples and neither does the server.
- **Caching.** Intentionally stateless — see D1.
- **Auth, multi-tenancy, rate limiting.** A local single-user stdio process needs none. (The FRED **API key** is required, but that is a configuration concern, not auth — see "API key".)

## Repo layout

The `fred/` repo is currently a single package (`@livefolio/fred`). This change converts it into a workspace root: the root `package.json` gains a `"workspaces": ["mcp"]` array, and `@livefolio/fred-mcp` ships as a new child workspace under `mcp/`. The adapter's source files do not move (zero churn on the published `@livefolio/fred`). Tooling (tsup, vitest, eslint, prettier, strict tsconfig, co-located `*.test.ts`) mirrors the adapter and the `@livefolio/yfinance-mcp` precedent.

```
fred/                              # repo root → workspace root; @livefolio/fred (adapter)
├── package.json                    # @livefolio/fred (existing) + "workspaces": ["mcp"]
├── tsconfig.json                   # adapter strict config — UNCHANGED
├── eslint.config.js                # reused by the child via import/extends
├── .prettierrc                     # reused by the child
├── src/                            # @livefolio/fred source — UNCHANGED
├── docs/specs/2026-06-14-fred-mcp-design.md
└── mcp/                            # NEW workspace package
    ├── package.json                # @livefolio/fred-mcp, "bin" → dist/index.js
    ├── tsconfig.json               # extends ../tsconfig.json
    ├── tsup.config.ts              # entry src/index.ts, esm, node20, shebang banner
    ├── vitest.config.ts
    ├── README.md                   # usage + `claude mcp add` snippet, FRED_API_KEY note
    └── src/
        ├── index.ts                # bin entrypoint: read env, createServer() + StdioServerTransport + connect
        ├── server.ts               # createServer(deps?) → McpServer with get_observations registered
        ├── server.test.ts          # in-memory client/server integration tests
        ├── tools/
        │   └── observations.ts     # get_observations handler & zod schemas
        ├── format.ts               # Bar[] → output (pure)
        └── format.test.ts
```

**Why a workspace, not a separate repo or a standalone nested package:** keeps the MCP server versioned and released next to the adapter it wraps, and lets npm link the local adapter by package name. It matches the `@livefolio/yfinance-mcp` precedent (a sibling workspace in the `yfinance/` repo). The adapter's source doesn't move, so the published `@livefolio/fred` is unaffected.

**ESLint / Prettier** at the repo root are reused by the child.

### Dependency wiring

- **Runtime dependencies:** `@modelcontextprotocol/sdk`, `@livefolio/fred` (the adapter), `zod`. (FRED's HTTP access is native `fetch` inside the adapter — no transitive HTTP client.)
- **Dev / types-only:** `@livefolio/sdk`. Every SDK reference in the adapter and in this package is `import type`, so the SDK never enters the runtime bundle — it's needed only to type-check `Asset` / `MacroAsset` / `Bar` / `DateRange`.
- **`engines.node` >= 20**, `"type": "module"`, matching the repo.
- **Adapter resolution:** the MCP package declares `"@livefolio/fred": "^0.1.0"`. Inside the workspace, npm links the local root package by that name; the adapter must be **built first** (`npm run build` at root) so `@livefolio/fred/dist` exists. If workspace linking of the root package proves unreliable, the published `0.1.0` on the registry already exports the functions we need (`fetchFredObservations`, `assetToFredSeriesId`), so a registry fallback is API-compatible.
- **tsconfig `paths` caveat (the one wiring detail to confirm during implementation):** unlike the `yfinance/` root tsconfig (which has no `paths`), the `fred/` root tsconfig maps `@livefolio/sdk*` → `./node_modules/@livefolio/sdk/src/...`. The `mcp/` child does `extends ../tsconfig.json` and inherits those `paths` plus `baseUrl: "."`. Under TypeScript ≥5.0 inherited `paths`/`baseUrl` resolve relative to the **declaring** (root) config, so with workspace hoisting `@livefolio/sdk` at the root `node_modules` should type-check. **Confirm at implementation;** if resolution fails, the child overrides `paths` (or drops them — the installed `@livefolio/sdk` ships its own `.d.ts`). Low risk, since all SDK usage is `import type`.
- **tsup** compiles `src/index.ts` → `dist/index.js` (esm, target node20), prepends a `#!/usr/bin/env node` shebang banner, and externalizes the runtime deps (npm installs them for `npx` consumers). No `.d.ts` emitted — this is an executable, not a library.

## API key

FRED's `series/observations` endpoint requires an API key. The server reads it once, at startup, from `process.env.FRED_API_KEY`:

- **Missing key:** `index.ts` logs a clear message to **stderr** and exits non-zero **before** connecting the transport. A server with no key can answer nothing, so failing fast is correct.
- **Present key:** passed into `createServer({ apiKey })` and forwarded to `fetchFredObservations(seriesId, range, { apiKey })` on every call. The key is never written to stdout and never echoed in tool output or error messages.
- This is **configuration, not auth** — there is one local user and one key for the whole process. Clients set the env var in their MCP server config block (documented in the README).

## Public API (the tool)

`get_observations` uses MCP **structured tool output**: registered with an `outputSchema`, and each call returns both `structuredContent` (the JSON below) and a `content` text block (a short human summary). It carries read-only annotations (D5).

### `get_observations`

Historical observations for one FRED series over a date range.

```ts
// input
{
  series_id: string,          // e.g. "GDP", "UNRATE", "CPIAUCSL" — used verbatim (FRED needs no normalization)
  from: string,               // inclusive, "YYYY-MM-DD"
  to: string,                 // inclusive, "YYYY-MM-DD"
}
// output (structuredContent)
{
  series_id: string,          // echoed verbatim
  from: string,               // echoed "YYYY-MM-DD"
  to: string,                 // echoed "YYYY-MM-DD"
  count: number,              // number of non-missing observations returned
  bars: Array<{               // degenerate OHLCV bars; UTC-midnight publish day, native cadence
    t: string,                // "YYYY-MM-DD"
    o: number, h: number, l: number, c: number, v: number,   // o=h=l=c=value, v=0
  }>,
}
// text: `GDP — 12 observations, 2022-01-01 → 2024-10-01. Last value 29349.0.`
```

Maps to `fetchFredObservations(series_id, range, { apiKey })`. The structured key is `bars` (the SDK's canonical row name); the human summary uses "observations" (the FRED-native term).

**Adaptation vs `get_daily_bars` (yfinance):**
- **Degenerate OHLCV bars for feed interoperability — not a `{ t, value }` value-series.** FRED observations are single values; the adapter returns degenerate bars (`open=high=low=close=value`, `volume=0`). The tool emits those bars verbatim as compact `{ t, o, h, l, c, v }` rows — **identical in shape to yfinance's `get_daily_bars`** (modulo `series_id`/`symbol`). Rationale: the primary consumer is a future **livefolio strategy-engine MCP** that ingests agent-supplied data feeds in the SDK's canonical `Bar` shape — the entire `DataFeed` contract is OHLCV, and `FredDataFeed` degenerates macro values into bars *precisely* to occupy a feed slot. Emitting `Bar`s lets this tool's output pipe straight into the engine MCP with **zero agent-side reshaping**, and keeps every data-feed MCP (FRED, yfinance, future) speaking one wire shape. A `{ t, value }` series would instead force the agent to reconstruct `o=h=l=c=value, v=0` before piping — leaking the exact degenerate-bar knowledge the adapter encapsulates. FRED series are short (monthly/quarterly), so OHLCV's redundancy costs few tokens; `value === c` for any consumer that wants the scalar. The `v: 0` and `o=h=l=c` are documented in the tool description so a human reading raw output isn't surprised.
- **Inclusive `to` over a half-open adapter range.** `fetchFredObservations` accepts a half-open `[from, to)` `DateRange` and queries FRED with `observation_end = to − 1 day`. To present an **inclusive** `to` (matching the macro convention and the existing adapter spec), the handler builds `range = { from: utcMidnight(from), to: utcMidnight(to) + ONE_DAY_MS }`. Both bounds inclusive.
- **Native cadence.** No frequency parameter. Monthly/quarterly/weekly/daily series surface at their native publish rate; the server never resamples.
- **No `includeIncompleteToday`.** FRED publishes finalized observations, not in-progress session bars — there is no in-progress-row concept to filter.

The description states that prices/values are FRED's published figures at native cadence, UTC-midnight timestamps, missing-value rows dropped — so the model knows what it is consuming. No truncation: the full in-range array is returned (FRED series are typically far shorter than daily equity history, and the text summary stays small regardless of length).

## Design decisions

### D1. Stateless calls — no caching

The tool calls the adapter's exported `fetchFredObservations` per request; no `FredDataFeed` instance, no `BarCache`. The adapter's bar cache is range-aware with **no TTL** — built for a single backtest run. In a long-lived stdio server (Claude Desktop can keep the process alive for days), a cached `(seriesId, range)` would keep returning the old set and silently miss newly-published observations (FRED revises and appends on a publication schedule). Fresh-per-request is the correct trade for interactive lookup; dedup matters little for human-paced calls.

### D2. Reuse the adapter's public export, not raw `fetch`

The server imports `fetchFredObservations` (and, where validation is wanted, `assetToFredSeriesId`) from `@livefolio/fred`. Identical URL construction, missing-value handling, error mapping, and UTC-midnight bar timestamps — and it honors the package boundary (no reaching around the adapter into raw FRED HTTP).

**On `assetToFredSeriesId`:** for FRED the series ID is used verbatim (FRED has no symbol normalization, unlike Yahoo's `BRK.B → BRK-B`). `assetToFredSeriesId({ kind: 'macro', id })` is therefore an identity that only guards asset kind. The handler passes `series_id` straight to `fetchFredObservations`; it does not round-trip through a `MacroAsset` (there is nothing to normalize). The export remains available and is referenced in the design for parity, but is intentionally not on the hot path.

### D3. Dependency-injection seam for offline tests

`createServer(deps?: { apiKey: string; fetchObservations?: FetchObservations })` defaults `fetchObservations` to the real adapter export; tests inject a `vi.fn()` stub returning plain `Bar[]`. Parallel to the adapter's own `fetcher` constructor option (called out in AGENTS.md). No network and no new fixtures in tests. In tests `apiKey` is a throwaway string (the stub ignores it).

### D4. Structured tool output; degenerate OHLCV bars

The tool registers an `outputSchema` and returns `structuredContent` + a text summary. Rows are the adapter's degenerate `{ t, o, h, l, c, v }` bars (`o=h=l=c=value`, `v=0`), matching yfinance's `get_daily_bars` and the SDK's canonical `Bar` shape. This is a deliberate choice for **downstream interoperability**: the intended primary consumer is a future livefolio strategy-engine MCP that ingests agent-supplied data feeds as `Bar`s, so emitting `Bar`s makes this tool's output a drop-in feed with no reshaping, and keeps all data-feed MCPs on one wire shape (see Public API for the full rationale and the rejected `{ t, value }` alternative). The text summary always carries the human-readable gist (`count`, first→last dates, last value = `close`).

### D5. Read-only annotations

The tool registration includes `annotations: { readOnlyHint: true, openWorldHint: true }`:
- `readOnlyHint: true` — the tool mutates nothing. Defaults to `false`, so it **must** be set explicitly or clients assume possible mutation.
- `openWorldHint: true` — the tool reaches an external service (FRED). Already the default; set explicitly for clarity.
- `destructiveHint` / `idempotentHint` are omitted — the spec defines them as meaningful only when `readOnlyHint` is `false`.

These are **advisory hints, not guarantees**: per the MCP spec, clients treat annotations as untrusted and must not make security decisions on them alone.

### D6. stdout is reserved for the protocol

The stdio transport uses **stdout** as the JSON-RPC channel. All diagnostics (missing key, crash handlers, connect failures) go to **stderr** only. Writing anything else to stdout corrupts the protocol stream. The entrypoint installs `unhandledRejection` / `uncaughtException` handlers that log to stderr and exit non-zero.

### D7. Errors become tool errors, never protocol throws

The handler wraps its body in try/catch and returns an MCP tool error (`isError: true` with a text message) rather than throwing across the protocol. The adapter's own messages (e.g. `fetchFredObservations: FRED error for series_id="XYZ": ...`) pass through; no stack traces. Semantic input validation (unparseable date, `from > to`, empty `series_id`) returns a clear tool error **before** any FRED call. Schema-level validation (wrong types) is handled by the SDK from the zod `inputSchema`.

## Internal architecture

### Components

```
index.ts            Bin entrypoint. Reads FRED_API_KEY (stderr + non-zero exit if absent).
                    createServer({ apiKey }) → connect(new StdioServerTransport()).
                    Installs stderr-only crash handlers. The only file that touches process I/O.

server.ts           createServer(deps?) → new McpServer({ name: 'fred', version }).
                    Registers get_observations via registerTool(name, { title, description,
                    inputSchema, outputSchema, annotations }, handler). deps.fetchObservations
                    defaults to the real adapter export; injectable for tests. Pure of process
                    I/O — returns the server object, does not connect a transport.

tools/observations.ts  Builds the get_observations handler from the injected fetcher + apiKey.
                       Validates series_id non-empty and dates (YYYY-MM-DD, from ≤ to),
                       builds the inclusive→half-open DateRange, calls fetchObservations,
                       shapes via format.ts, catches errors → tool error.

format.ts           Pure shapers: barsToOutput(series_id, from, to, Bar[]) →
                    { series_id, from, to, count, bars } (compact { t, o, h, l, c, v } rows) +
                    summary text. No I/O, no throws.
```

### Data flow (per tool call)

```
client callTool("get_observations", args)
  → SDK validates args against the zod inputSchema
  → handler: semantic validation (non-empty series_id, valid dates, from ≤ to) → tool error on failure
  → build DateRange { from: utcMidnight(from), to: utcMidnight(to) + 1 day }  (inclusive → half-open)
  → injected fetchObservations(series_id, range, { apiKey })
       → @livefolio/fred → FRED series/observations → normalized Bar[] (missing rows dropped)
  → format.ts → { content: [{ type:'text', text: summary }], structuredContent: {...} }
  → (any throw) → catch → { content:[{type:'text', text:'Error: …'}], isError: true }
```

`index.ts` is intentionally tiny — read env, build server, connect transport — so all logic lives in transport-agnostic, unit-testable units.

## Error handling & edge cases

- **Unknown / invalid series:** FRED returns a 200 with `error_message`, which the adapter turns into a throw (`fetchFredObservations: FRED error for series_id="XYZ": ...`) → tool error.
- **HTTP error from FRED:** adapter throws with status + body → tool error.
- **Bad API key:** FRED responds 400 with an error body → adapter throws → tool error (message does not echo the key).
- **Empty range (no observations in window):** `count: 0`, `bars: []`, text "no observations in range" — a normal result, **not** an error.
- **All-missing window:** the adapter drops `"."` rows, so a window containing only placeholders yields `count: 0` — same as empty.
- **Invalid input:** bad date format, `from > to`, empty `series_id` → tool error **before** any network call.
- **Non-macro asset:** not reachable from the tool input (input is a bare `series_id` string); `assetToFredSeriesId`'s kind guard is an adapter-internal concern.
- **Date semantics:** `from` / `to` are `YYYY-MM-DD` parsed as UTC midnight, matching the adapter's UTC-midnight observation convention. Both bounds **inclusive** (the handler adds one day to `to` to satisfy the adapter's half-open contract).
- **Process-level:** missing `FRED_API_KEY`, `unhandledRejection` / `uncaughtException`, and a failed `connect()` log to stderr and exit non-zero. Never write to stdout outside the transport.

## Testing strategy

Offline-only, co-located `*.test.ts`, Vitest, no network and **no new fixtures** — the DI seam (D3) stubs at the adapter-function boundary with plain `Bar` objects.

**`format.test.ts`** — pure unit tests:
- `barsToOutput`: compact `{ t, o, h, l, c, v }` rows with date-only `t`; `count` matches; empty array → `count: 0` + "no observations" summary; summary renders first→last and last value (`close`).

**`server.test.ts`** — full request→response via the SDK's `InMemoryTransport.createLinkedPair()` linking a `Client` to `createServer({ apiKey: 'test', fetchObservations: stub })`:

| Behavior | Verifies |
|---|---|
| Tool discovery | `listTools` returns `get_observations` with `readOnlyHint: true`, `openWorldHint: true` and an `outputSchema` |
| Success | Stub `Bar[]` → compact `{ t, o, h, l, c, v }` rows, `count`, range echo + summary text |
| Inclusive→half-open range | stub called with `range.to === utcMidnight(to) + 1 day` (inclusive `to`) |
| Empty range | `count: 0`, "no observations" summary, **not** an error |
| Date validation | `from > to` and malformed date → `isError: true`, **no** fetcher call |
| Empty series_id | `isError: true`, no fetcher call |
| Adapter throw → tool error | stub rejects → `isError: true`, message passed through, server stays up |

No coverage-threshold gate. No live-FRED integration test in this package — the adapter already owns the single `FRED_API_KEY`-gated integration test; the MCP layer is fully covered by the DI stub at the boundary.

## Out-of-scope / explicitly NOT done

- HTTP / SSE transport (tool layer kept transport-agnostic for a future additive entry point).
- Latest-value / quote tool (deferred until `feat/quote-feed` merges to `main`).
- Batch / multi-series tool, derived/computed tools, series search, non-macro assets, cadence resampling.
- Caching / dedup (stateless by D1).
- Auth, rate limiting, multi-tenancy.
- Bundling the adapter source directly (consumed via package name per D2).

## Open questions / follow-ups

- **tsconfig `paths` inheritance** (root maps `@livefolio/sdk` into `node_modules/.../src`) — confirm the `mcp/` child type-checks under workspace hoisting; override or drop `paths` in the child if not. Low risk (all SDK usage is `import type`). See Dependency wiring.
- **Adapter resolution in the workspace** (workspace link of the root package vs registry fallback) — confirm during implementation. Low risk: the published API is compatible either way.
- **Release CI wiring.** The repo's CI (`.github/workflows/ci.yml`: test + version-guard + release) will need an entry for the new `mcp` workspace (build/test, and publish `@livefolio/fred-mcp`). Flagged as a follow-up, not built into this spec; the package is publishable (`publishConfig.access: public`, `repository.directory: "mcp"`) but CI integration is a separate change.
- **Latest-value tool.** When `feat/quote-feed` (exporting `fetchLatestFredObservation`) merges, add a sibling `get_latest_observation` tool following this same pattern.
- **Initial version:** `0.1.0`.
