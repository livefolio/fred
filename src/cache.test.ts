import { describe, it, expect } from 'vitest';
import type { Bar } from '@livefolio/sdk';
import { BarCache } from './cache';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function bar(date: string, close: number): Bar {
  return { t: utc(date), open: close, high: close, low: close, close, volume: 0 };
}

const SERIES = [
  bar('2024-04-01', 4.0),
  bar('2024-04-02', 4.05),
  bar('2024-04-03', 4.1),
  bar('2024-04-04', 4.12),
  bar('2024-04-05', 4.08),
];

describe('BarCache', () => {
  it('empty cache miss returns undefined', () => {
    const c = new BarCache();
    expect(c.get('DGS10', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d')).toBeUndefined();
  });

  it('exact-range hit returns the full slice', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('DGS10', '1d', range, SERIES);
    const out = c.get('DGS10', range, '1d');
    expect(out).toHaveLength(5);
    expect(out?.[0]?.t.toISOString()).toBe('2024-04-01T00:00:00.000Z');
    expect(out?.[4]?.t.toISOString()).toBe('2024-04-05T00:00:00.000Z');
  });

  it('sub-range hit returns the bars within the requested range, inclusive both ends', () => {
    const c = new BarCache();
    c.set('DGS10', '1d', { from: utc('2024-04-01'), to: utc('2024-04-05') }, SERIES);
    const out = c.get('DGS10', { from: utc('2024-04-02'), to: utc('2024-04-04') }, '1d');
    expect(out).toHaveLength(3);
    expect(out?.[0]?.t.toISOString()).toBe('2024-04-02T00:00:00.000Z');
    expect(out?.[2]?.t.toISOString()).toBe('2024-04-04T00:00:00.000Z');
  });

  it('super-range miss: requested range exceeds cached range', () => {
    const c = new BarCache();
    c.set('DGS10', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SERIES.slice(1, 4));
    expect(c.get('DGS10', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d')).toBeUndefined();
  });

  it('isolates cache entries per series id', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('DGS10', '1d', range, SERIES);
    expect(c.get('DGS2', range, '1d')).toBeUndefined();
    expect(c.get('DGS10', range, '1d')).toHaveLength(5);
  });

  it('isolates cache entries per frequency', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('DGS10', '1d', range, SERIES);
    expect(c.get('DGS10', range, '1h')).toBeUndefined();
  });

  it('set: strict-superset widens the cached range', () => {
    const c = new BarCache();
    c.set('DGS10', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SERIES.slice(1, 4));
    c.set('DGS10', '1d', { from: utc('2024-04-01'), to: utc('2024-04-05') }, SERIES);
    expect(c.get('DGS10', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d')).toHaveLength(5);
  });

  it('set: throws on partial overlap (YAGNI per plan)', () => {
    const c = new BarCache();
    c.set('DGS10', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SERIES.slice(1, 4));
    expect(() => c.set('DGS10', '1d', { from: utc('2024-04-03'), to: utc('2024-04-05') }, SERIES.slice(2, 5))).toThrow(
      /partial overlap/i,
    );
  });
});
