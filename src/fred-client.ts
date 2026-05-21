import type { Bar, DateRange } from '@livefolio/sdk';

const FRED_OBSERVATIONS_URL = 'https://api.stlouisfed.org/fred/series/observations';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type FredObservation = {
  date: string;
  value: string;
};

type FredObservationsResponse = {
  observations?: FredObservation[];
  error_code?: number;
  error_message?: string;
};

/**
 * Format a `Date` as `YYYY-MM-DD` in UTC. FRED's `observation_start` and
 * `observation_end` are date-only and inclusive on both ends.
 */
function toFredDate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Fetches FRED observations for `seriesId` over `range`, returning each
 * non-missing observation as a degenerate OHLCV `Bar`.
 *
 * `range` is half-open `[from, to)`; FRED's `observation_end` is inclusive,
 * so we send `to - 1 day`.
 *
 * Throws on:
 * - HTTP non-2xx (message includes status + body)
 * - FRED 200 with `error_message` (message echoes FRED's error)
 *
 * Network rejections from `fetch` propagate unwrapped.
 */
export async function fetchFredObservations(
  seriesId: string,
  range: DateRange,
  opts: { apiKey: string },
): Promise<Bar[]> {
  const url = new URL(FRED_OBSERVATIONS_URL);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', opts.apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('observation_start', toFredDate(range.from));
  url.searchParams.set('observation_end', toFredDate(new Date(range.to.getTime() - ONE_DAY_MS)));

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `fetchFredObservations: FRED returned HTTP ${response.status} for series_id="${seriesId}": ${body}`,
    );
  }

  const json = (await response.json()) as FredObservationsResponse;

  if (json.error_message !== undefined) {
    throw new Error(`fetchFredObservations: FRED error for series_id="${seriesId}": ${json.error_message}`);
  }

  const observations = json.observations ?? [];
  const bars: Bar[] = [];
  for (const obs of observations) {
    if (obs.value === '.') continue;
    const value = Number.parseFloat(obs.value);
    bars.push({
      t: new Date(`${obs.date}T00:00:00Z`),
      open: value,
      high: value,
      low: value,
      close: value,
      volume: 0,
    });
  }
  return bars;
}

export type FetchFredObservationsOptions = { apiKey: string };

/** A single non-missing FRED observation, parsed into a numeric value at UTC midnight. */
export type FredLatestObservation = {
  t: Date;
  value: number;
};

/**
 * Fetches the most recent non-missing FRED observation for `seriesId`.
 *
 * FRED has no realtime quote API; this hits `series/observations` with
 * `sort_order=desc` and walks down the response until it finds an observation
 * whose `value` is not `.` (FRED's missing-value sentinel). This handles the
 * common case where the latest published row for monthly/quarterly series
 * may temporarily be `.` while still surfacing the most recent real datum.
 *
 * Throws on:
 * - HTTP non-2xx (message includes status + body)
 * - FRED 200 with `error_message` (message echoes FRED's error)
 * - All scanned observations are missing (message names the series)
 */
export async function fetchLatestFredObservation(
  seriesId: string,
  opts: { apiKey: string },
): Promise<FredLatestObservation> {
  const url = new URL(FRED_OBSERVATIONS_URL);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', opts.apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '10');

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `fetchLatestFredObservation: FRED returned HTTP ${response.status} for series_id="${seriesId}": ${body}`,
    );
  }

  const json = (await response.json()) as FredObservationsResponse;

  if (json.error_message !== undefined) {
    throw new Error(`fetchLatestFredObservation: FRED error for series_id="${seriesId}": ${json.error_message}`);
  }

  const observations = json.observations ?? [];
  for (const obs of observations) {
    if (obs.value === '.') continue;
    return {
      t: new Date(`${obs.date}T00:00:00Z`),
      value: Number.parseFloat(obs.value),
    };
  }

  throw new Error(`fetchLatestFredObservation: no non-missing observations returned for series_id="${seriesId}"`);
}
