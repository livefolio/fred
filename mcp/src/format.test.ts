import { describe, it, expect } from 'vitest';
import type { Bar } from '@livefolio/sdk';
import { barsToOutput, observationsSummary } from './format';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

/** A degenerate FRED observation bar: open=high=low=close=value, volume=0. */
function obs(date: string, value: number): Bar {
  return { t: utc(date), open: value, high: value, low: value, close: value, volume: 0 };
}

describe('barsToOutput', () => {
  it('maps degenerate bars to compact rows with date-only t and count', () => {
    const out = barsToOutput('GDP', '2024-01-01', '2024-12-31', [obs('2024-01-01', 27000), obs('2024-04-01', 28000)]);
    expect(out).toEqual({
      series_id: 'GDP',
      from: '2024-01-01',
      to: '2024-12-31',
      count: 2,
      bars: [
        { t: '2024-01-01', o: 27000, h: 27000, l: 27000, c: 27000, v: 0 },
        { t: '2024-04-01', o: 28000, h: 28000, l: 28000, c: 28000, v: 0 },
      ],
    });
  });

  it('handles an empty range', () => {
    const out = barsToOutput('GDP', '2024-01-01', '2024-01-01', []);
    expect(out).toEqual({ series_id: 'GDP', from: '2024-01-01', to: '2024-01-01', count: 0, bars: [] });
  });
});

describe('observationsSummary', () => {
  it('summarizes count, first→last, and last value', () => {
    const out = barsToOutput('GDP', '2024-01-01', '2024-12-31', [obs('2024-01-01', 27000), obs('2024-04-01', 28000.5)]);
    expect(observationsSummary(out)).toBe('GDP — 2 observations, 2024-01-01 → 2024-04-01. Last value 28000.5.');
  });

  it('summarizes a single-observation range (first and last coincide)', () => {
    const out = barsToOutput('GDP', '2024-01-01', '2024-01-01', [obs('2024-01-01', 27000)]);
    expect(observationsSummary(out)).toBe('GDP — 1 observations, 2024-01-01 → 2024-01-01. Last value 27000.');
  });

  it('reports an empty range distinctly', () => {
    const out = barsToOutput('GDP', '2024-01-01', '2024-01-01', []);
    expect(observationsSummary(out)).toBe('GDP — no observations in range 2024-01-01 → 2024-01-01.');
  });
});
