import { describe, it, expect, vi } from 'vitest';
import type { Asset, Bar, DateRange } from '@livefolio/sdk';
import { FredDataFeed, type FredFetcher } from './fred-data-feed';

const dgs10: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y' };
const aapl: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
const range: DateRange = { from: new Date('2024-04-01T00:00:00Z'), to: new Date('2024-04-06T00:00:00Z') };

function bar(date: string, value: number): Bar {
  return {
    t: new Date(`${date}T00:00:00Z`),
    open: value,
    high: value,
    low: value,
    close: value,
    volume: 0,
  };
}

const FIXTURE: Bar[] = [bar('2024-04-01', 4.21), bar('2024-04-02', 4.18), bar('2024-04-03', 4.15)];

async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('FredDataFeed', () => {
  it('routes bars(macro, range, "1d") through the injected fetcher', async () => {
    const fetcher: FredFetcher = vi.fn(async () => [...FIXTURE]);
    const feed = new FredDataFeed({ apiKey: 'k', fetcher });

    const bars = await drain(feed.bars(dgs10, range, '1d'));

    expect(bars).toHaveLength(3);
    expect(bars[0]?.close).toBe(4.21);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('DGS10', range, { apiKey: 'k' });
  });

  it('serves the second bars call from cache (fetcher called once)', async () => {
    const fetcher: FredFetcher = vi.fn(async () => [...FIXTURE]);
    const feed = new FredDataFeed({ apiKey: 'k', fetcher });

    await drain(feed.bars(dgs10, range, '1d'));
    await drain(feed.bars(dgs10, range, '1d'));

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent calls into a single in-flight fetch', async () => {
    let resolve!: (bars: Bar[]) => void;
    const fetcher: FredFetcher = vi.fn(
      () =>
        new Promise<Bar[]>((r) => {
          resolve = r;
        }),
    );
    const feed = new FredDataFeed({ apiKey: 'k', fetcher });

    const p1 = drain(feed.bars(dgs10, range, '1d'));
    const p2 = drain(feed.bars(dgs10, range, '1d'));

    // Both calls created before the fetcher resolves.
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolve([...FIXTURE]);

    const [b1, b2] = await Promise.all([p1, p2]);
    expect(b1).toHaveLength(3);
    expect(b2).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('throws on non-macro assets', async () => {
    const feed = new FredDataFeed({ apiKey: 'k', fetcher: vi.fn() });
    await expect(drain(feed.bars(aapl, range, '1d'))).rejects.toThrow(/kind="equity"/);
  });

  it('throws on freq other than "1d"', async () => {
    const feed = new FredDataFeed({ apiKey: 'k', fetcher: vi.fn() });
    await expect(drain(feed.bars(dgs10, range, '1h'))).rejects.toThrow(/freq/);
    await expect(drain(feed.bars(dgs10, range, '1h'))).rejects.toThrow(/1h/);
  });

  it('does not implement fundamentals', () => {
    const feed = new FredDataFeed({ apiKey: 'k', fetcher: vi.fn() });
    expect('fundamentals' in feed).toBe(false);
  });

  it('does not implement events', () => {
    const feed = new FredDataFeed({ apiKey: 'k', fetcher: vi.fn() });
    expect('events' in feed).toBe(false);
  });
});
