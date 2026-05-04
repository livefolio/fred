# @livefolio/fred

FRED (St. Louis Fed) macro time series adapter for [`@livefolio/sdk`](https://github.com/livefolio/sdk) v0.4.

A `DataFeed` implementation that wraps FRED's `series/observations` REST endpoint. Pass-through: each FRED observation becomes a degenerate OHLCV bar (`open=high=low=close=value`, `volume=0`). Use it on its own for macro-only strategies, or compose with other feeds via `RoutingDataFeed`.

## Install

```bash
npm install @livefolio/fred @livefolio/sdk
```

## Usage

```ts
import { FredDataFeed } from '@livefolio/fred';
import type { Asset, DateRange } from '@livefolio/sdk';

const fred = new FredDataFeed({ apiKey: process.env.FRED_API_KEY! });

const dgs10: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };
const range: DateRange = { from: new Date('2024-01-01'), to: new Date('2025-01-01') };

for await (const bar of fred.bars(dgs10, range, '1d')) {
  console.log(bar.t.toISOString(), bar.close);
}
```

## Composition with `@livefolio/yfinance`

```ts
import { RoutingDataFeed } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';
import { FredDataFeed } from '@livefolio/fred';

const feed = new RoutingDataFeed({
  equity: new YfinanceDataFeed(),
  macro: new FredDataFeed({ apiKey: process.env.FRED_API_KEY! }),
});
```

## Scope

- `bars()` only. No `fundamentals()`, no `events()`.
- `freq: '1d'` only — anything else throws.
- `kind: 'macro'` only — anything else throws.
- Pass-through cadence: monthly series like `CPIAUCSL` yield sparse monthly bars when fetched as `'1d'`. Aggregation is the consumer's responsibility.

## Configuration

Get a free API key from <https://fred.stlouisfed.org/docs/api/api_key.html>. The package never reads `FRED_API_KEY` from the environment automatically — pass it explicitly.

## License

MIT
