import { describe, it, expect, vi } from 'vitest';
import type { Bar, DateRange } from '@livefolio/sdk';
import { makeGetObservationsHandler } from './observations';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
function obs(date: string, value: number): Bar {
  return { t: utc(date), open: value, high: value, low: value, close: value, volume: 0 };
}

describe('get_observations handler', () => {
  it('shapes a successful fetch into structuredContent + summary', async () => {
    const fetchObservations = vi.fn().mockResolvedValue([obs('2024-01-01', 27000), obs('2024-04-01', 28000)]);
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    const res = await handler({ series_id: 'GDP', from: '2024-01-01', to: '2024-12-31' });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({
      series_id: 'GDP',
      from: '2024-01-01',
      to: '2024-12-31',
      count: 2,
      bars: [
        { t: '2024-01-01', o: 27000, h: 27000, l: 27000, c: 27000, v: 0 },
        { t: '2024-04-01', o: 28000, h: 28000, l: 28000, c: 28000, v: 0 },
      ],
    });
    expect(res.content[0]!.text).toBe('GDP — 2 observations, 2024-01-01 → 2024-04-01. Last value 28000.');
  });

  it('passes the apiKey and an inclusive→half-open range to the fetcher', async () => {
    const fetchObservations = vi.fn().mockResolvedValue([]);
    const handler = makeGetObservationsHandler({ apiKey: 'secret', fetchObservations });
    await handler({ series_id: 'UNRATE', from: '2024-01-01', to: '2024-01-31' });
    expect(fetchObservations).toHaveBeenCalledTimes(1);
    const [seriesId, range, opts] = fetchObservations.mock.calls[0]! as [string, DateRange, { apiKey: string }];
    expect(seriesId).toBe('UNRATE');
    expect(range.from.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2024-02-01T00:00:00.000Z'); // inclusive 2024-01-31 + 1 day
    expect(opts).toEqual({ apiKey: 'secret' });
  });

  it('returns an empty-range result, not an error', async () => {
    const fetchObservations = vi.fn().mockResolvedValue([]);
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    const res = await handler({ series_id: 'GDP', from: '2024-01-01', to: '2024-01-01' });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({ count: 0, bars: [] });
    expect(res.content[0]!.text).toBe('GDP — no observations in range 2024-01-01 → 2024-01-01.');
  });

  it('rejects an empty series_id without calling the fetcher', async () => {
    const fetchObservations = vi.fn();
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    const res = await handler({ series_id: '   ', from: '2024-01-01', to: '2024-12-31' });
    expect(res.isError).toBe(true);
    expect(fetchObservations).not.toHaveBeenCalled();
  });

  it('rejects a malformed date without calling the fetcher', async () => {
    const fetchObservations = vi.fn();
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    const res = await handler({ series_id: 'GDP', from: '2024-13-99', to: '2024-12-31' });
    expect(res.isError).toBe(true);
    expect(fetchObservations).not.toHaveBeenCalled();
  });

  it('rejects an impossible calendar date (Feb 31) without calling the fetcher', async () => {
    const fetchObservations = vi.fn();
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    const res = await handler({ series_id: 'GDP', from: '2024-02-31', to: '2024-12-31' });
    expect(res.isError).toBe(true);
    expect(fetchObservations).not.toHaveBeenCalled();
  });

  it('rejects from > to without calling the fetcher', async () => {
    const fetchObservations = vi.fn();
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    const res = await handler({ series_id: 'GDP', from: '2024-12-31', to: '2024-01-01' });
    expect(res.isError).toBe(true);
    expect(fetchObservations).not.toHaveBeenCalled();
  });

  it('maps a fetcher throw to a tool error', async () => {
    const fetchObservations = vi
      .fn()
      .mockRejectedValue(new Error('fetchFredObservations: FRED error for series_id="XYZ": Bad Request.'));
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    const res = await handler({ series_id: 'XYZ', from: '2024-01-01', to: '2024-12-31' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('FRED error for series_id="XYZ"');
  });

  it('trims surrounding whitespace from series_id before fetching', async () => {
    const fetchObservations = vi.fn().mockResolvedValue([]);
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    await handler({ series_id: '  GDP  ', from: '2024-01-01', to: '2024-12-31' });
    expect(fetchObservations.mock.calls[0]![0]).toBe('GDP');
  });

  it('maps a non-Error rejection to a tool error', async () => {
    const fetchObservations = vi.fn().mockRejectedValue('boom');
    const handler = makeGetObservationsHandler({ apiKey: 'k', fetchObservations });
    const res = await handler({ series_id: 'GDP', from: '2024-01-01', to: '2024-12-31' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('boom');
  });
});
