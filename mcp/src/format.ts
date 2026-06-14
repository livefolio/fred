import type { Bar } from '@livefolio/sdk';

export type BarRow = { t: string; o: number; h: number; l: number; c: number; v: number };

export type ObservationsOut = {
  series_id: string;
  from: string;
  to: string;
  count: number;
  bars: readonly BarRow[];
};

/** UTC `YYYY-MM-DD` for a Date. */
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Shape adapter `Bar[]` (degenerate FRED observations: open=high=low=close=value,
 * volume=0) into compact rows. `t` is the UTC-midnight day as `YYYY-MM-DD`.
 *
 * Bars must carry UTC-midnight timestamps, as emitted by the `@livefolio/fred`
 * adapter — `t` is rendered via `toISOString().slice(0, 10)`.
 */
export function barsToOutput(seriesId: string, from: string, to: string, bars: ReadonlyArray<Bar>): ObservationsOut {
  return {
    series_id: seriesId,
    from,
    to,
    count: bars.length,
    bars: bars.map((b) => ({ t: isoDay(b.t), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })),
  };
}

/** Human-readable one-line summary of an already-shaped {@link ObservationsOut}. */
export function observationsSummary(out: ObservationsOut): string {
  if (out.count === 0) {
    return `${out.series_id} — no observations in range ${out.from} → ${out.to}.`;
  }
  const first = out.bars[0]!;
  const last = out.bars[out.bars.length - 1]!;
  return `${out.series_id} — ${out.count} observations, ${first.t} → ${last.t}. Last value ${last.c}.`;
}
