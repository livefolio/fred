import { describe, it, expect } from 'vitest';
import type { Asset, Bar, DateRange } from '@livefolio/sdk';
import { FredDataFeed } from './fred-data-feed';

const apiKey = process.env.FRED_API_KEY;

const describeIfKey = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip;

describeIfKey('FredDataFeed integration (live FRED)', () => {
  it('fetches DGS10 for a known week and returns at least one bar', async () => {
    const feed = new FredDataFeed({ apiKey: apiKey! });
    const dgs10: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };
    const range: DateRange = {
      from: new Date('2024-04-01T00:00:00Z'),
      to: new Date('2024-04-08T00:00:00Z'),
    };
    const bars: Bar[] = [];
    for await (const b of feed.bars(dgs10, range, '1d')) {
      bars.push(b);
    }
    expect(bars.length).toBeGreaterThan(0);
    expect(typeof bars[0]?.close).toBe('number');
    expect(Number.isFinite(bars[0]?.close)).toBe(true);
    // DGS10 publishes on weekdays — within a Mon–Sun window we expect 5 bars,
    // but FRED occasionally has holiday gaps; assert ≥ 3 to be conservative.
    expect(bars.length).toBeGreaterThanOrEqual(3);
  });
});
