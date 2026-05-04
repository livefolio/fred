import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DateRange } from '@livefolio/sdk';
import { fetchFredObservations } from './fred-client';

const range: DateRange = { from: new Date('2024-04-01T00:00:00Z'), to: new Date('2024-04-06T00:00:00Z') };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchFredObservations', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('builds the URL with the expected query params', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ observations: [] }));
    await fetchFredObservations('DGS10', range, { apiKey: 'TEST_KEY' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL((fetchSpy.mock.calls[0]![0] as URL | string).toString());
    expect(url.origin + url.pathname).toBe('https://api.stlouisfed.org/fred/series/observations');
    expect(url.searchParams.get('series_id')).toBe('DGS10');
    expect(url.searchParams.get('api_key')).toBe('TEST_KEY');
    expect(url.searchParams.get('file_type')).toBe('json');
    expect(url.searchParams.get('observation_start')).toBe('2024-04-01');
    // range.to is exclusive (2024-04-06), so observation_end is 2024-04-05.
    expect(url.searchParams.get('observation_end')).toBe('2024-04-05');
  });

  it('maps observations to bars (open=high=low=close=value, volume=0)', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        observations: [
          { date: '2024-04-01', value: '4.21' },
          { date: '2024-04-02', value: '4.18' },
        ],
      }),
    );
    const bars = await fetchFredObservations('DGS10', range, { apiKey: 'k' });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      t: new Date('2024-04-01T00:00:00Z'),
      open: 4.21,
      high: 4.21,
      low: 4.21,
      close: 4.21,
      volume: 0,
    });
    expect(bars[1]?.close).toBe(4.18);
  });

  it("drops observations with FRED's missing-value sentinel '.'", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        observations: [
          { date: '2024-04-01', value: '4.21' },
          { date: '2024-04-02', value: '.' },
          { date: '2024-04-03', value: '4.18' },
        ],
      }),
    );
    const bars = await fetchFredObservations('DGS10', range, { apiKey: 'k' });
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.t.toISOString())).toEqual(['2024-04-01T00:00:00.000Z', '2024-04-03T00:00:00.000Z']);
  });

  it('throws on HTTP non-2xx with status and body in the message', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Bad Request: invalid api_key', { status: 400 }));
    await expect(fetchFredObservations('DGS10', range, { apiKey: 'bad' })).rejects.toThrow(/400/);
    fetchSpy.mockResolvedValueOnce(new Response('Bad Request: invalid api_key', { status: 400 }));
    await expect(fetchFredObservations('DGS10', range, { apiKey: 'bad' })).rejects.toThrow(/invalid api_key/);
  });

  it('throws on FRED 200 with error_message', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error_code: 400, error_message: 'Variable api_key is not registered.' }));
    await expect(fetchFredObservations('DGS10', range, { apiKey: 'k' })).rejects.toThrow(
      /Variable api_key is not registered/,
    );
  });

  it('propagates network errors without wrapping', async () => {
    const networkErr = new TypeError('fetch failed');
    fetchSpy.mockRejectedValueOnce(networkErr);
    await expect(fetchFredObservations('DGS10', range, { apiKey: 'k' })).rejects.toBe(networkErr);
  });
});
