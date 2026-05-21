import type { Asset, Bar, DataFeed, DateRange, Frequency, Quote, QuoteFeed } from '@livefolio/sdk';
import { assetToFredSeriesId } from './asset';
import { fetchFredObservations, fetchLatestFredObservation, type FredLatestObservation } from './fred-client';
import { BarCache } from './cache';

/** Function form used to fetch raw bars. Tests inject a mock; production uses {@link fetchFredObservations}. */
export type FredFetcher = (seriesId: string, range: DateRange, opts: { apiKey: string }) => Promise<Bar[]>;

/** Function form used to fetch the most recent non-missing observation. Tests inject a mock; production uses {@link fetchLatestFredObservation}. */
export type FredLatestFetcher = (seriesId: string, opts: { apiKey: string }) => Promise<FredLatestObservation>;

export type FredDataFeedOptions = {
  /** Required. FRED API key. */
  apiKey: string;
  /** Override the live bars fetcher. Tests inject a stub to stay offline. */
  fetcher?: FredFetcher;
  /** Override the live latest-observation fetcher. Tests inject a stub to stay offline. */
  latestFetcher?: FredLatestFetcher;
};

const defaultFetcher: FredFetcher = (seriesId, range, opts) => fetchFredObservations(seriesId, range, opts);
const defaultLatestFetcher: FredLatestFetcher = (seriesId, opts) => fetchLatestFredObservation(seriesId, opts);

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
 *
 * Also implements `QuoteFeed` — FRED has no realtime quote endpoint, so
 * `quote(asset)` returns the most recent non-missing observation for the
 * series. The returned `Quote.t` is the observation's UTC-midnight date,
 * not the local clock.
 */
export class FredDataFeed implements DataFeed, QuoteFeed {
  private readonly apiKey: string;
  private readonly fetcher: FredFetcher;
  private readonly latestFetcher: FredLatestFetcher;
  private readonly cache = new BarCache();
  private readonly inflight = new Map<string, Promise<Bar[]>>();

  constructor(opts: FredDataFeedOptions) {
    this.apiKey = opts.apiKey;
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.latestFetcher = opts.latestFetcher ?? defaultLatestFetcher;
  }

  async quote(asset: Asset): Promise<Quote> {
    const seriesId = assetToFredSeriesId(asset);
    const obs = await this.latestFetcher(seriesId, { apiKey: this.apiKey });
    return { asset, t: obs.t, price: obs.value };
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
