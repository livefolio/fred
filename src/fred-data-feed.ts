import type { Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';
import { assetToFredSeriesId } from './asset';
import { fetchFredObservations } from './fred-client';
import { BarCache } from './cache';

/** Function form used to fetch raw bars. Tests inject a mock; production uses {@link fetchFredObservations}. */
export type FredFetcher = (
  seriesId: string,
  range: DateRange,
  opts: { apiKey: string },
) => Promise<Bar[]>;

export type FredDataFeedOptions = {
  /** Required. FRED API key. */
  apiKey: string;
  /** Override the live fetcher. Tests inject a stub to stay offline. */
  fetcher?: FredFetcher;
};

const defaultFetcher: FredFetcher = (seriesId, range, opts) => fetchFredObservations(seriesId, range, opts);

/**
 * Implements `@livefolio/sdk` v0.4's `DataFeed.bars` over FRED's
 * `series/observations` endpoint.
 *
 * Composition: `assetToFredSeriesId` → `BarCache` → `fetchFredObservations`. A
 * per-instance `BarCache` deduplicates fetches inside a backtest; an in-flight
 * map further dedupes concurrent calls for the same `(seriesId, freq)`.
 *
 * `fundamentals` and `events` are intentionally *not* defined on the instance
 * — the SDK's interface marks them optional, and consumers feature-detect via
 * `'fundamentals' in feed`.
 *
 * Only `freq: '1d'` is accepted; FRED has no concept of intraday observations.
 */
export class FredDataFeed implements DataFeed {
  private readonly apiKey: string;
  private readonly fetcher: FredFetcher;
  private readonly cache = new BarCache();
  private readonly inflight = new Map<string, Promise<Bar[]>>();

  constructor(opts: FredDataFeedOptions) {
    this.apiKey = opts.apiKey;
    this.fetcher = opts.fetcher ?? defaultFetcher;
  }

  // Async generator (rather than plain delegation) so the freq/asset-kind
  // checks throw lazily on first next() — surfacing as iterable rejections
  // rather than synchronous throws at call time, consistent with
  // RoutingDataFeed.bars.
  async *bars(asset: Asset, range: DateRange, freq: Frequency): AsyncGenerator<Bar> {
    if (freq !== '1d') {
      throw new Error(`FredDataFeed.bars: unsupported freq="${freq}". FRED supports daily ('1d') only.`);
    }

    const seriesId = assetToFredSeriesId(asset);

    const cached = this.cache.get(seriesId, range, freq);
    if (cached !== undefined) {
      for (const b of cached) yield b;
      return;
    }

    const inflightKey = `${seriesId}:${freq}`;
    let pending = this.inflight.get(inflightKey);
    if (!pending) {
      pending = (async () => {
        try {
          const bars = await this.fetcher(seriesId, range, { apiKey: this.apiKey });
          this.cache.set(seriesId, freq, range, bars);
          return bars;
        } finally {
          this.inflight.delete(inflightKey);
        }
      })();
      this.inflight.set(inflightKey, pending);
    }

    const bars = await pending;

    // After the fetch, the cache should serve the requested range. If a
    // concurrent fetch was for a different range, fall back to the resolved
    // bars filtered to this caller's range.
    const post = this.cache.get(seriesId, range, freq);
    if (post !== undefined) {
      for (const b of post) yield b;
      return;
    }

    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    for (const b of bars) {
      const t = b.t.getTime();
      if (t >= fromMs && t <= toMs) yield b;
    }
  }
}
