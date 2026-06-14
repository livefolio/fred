import { z } from 'zod';
import type { Bar, DateRange } from '@livefolio/sdk';
import { barsToOutput, observationsSummary } from '../format';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fetcher signature — matches the adapter's exported `fetchFredObservations`. */
export type FetchObservations = (seriesId: string, range: DateRange, opts: { apiKey: string }) => Promise<Bar[]>;

/** zod raw shape for the tool input. Types only — format/semantics are validated in the handler (D7). */
export const getObservationsInputShape = {
  series_id: z
    .string()
    .describe('FRED series ID. Examples: "GDP", "UNRATE", "CPIAUCSL". Leading/trailing whitespace is trimmed.'),
  from: z.string().describe('Inclusive start date, "YYYY-MM-DD" (UTC).'),
  to: z.string().describe('Inclusive end date, "YYYY-MM-DD" (UTC).'),
};

const barRowShape = {
  t: z.string().describe('UTC observation day, "YYYY-MM-DD".'),
  o: z.number().describe('Open — equals the observation value for FRED.'),
  h: z.number().describe('High — equals the observation value for FRED.'),
  l: z.number().describe('Low — equals the observation value for FRED.'),
  c: z.number().describe('The observation value (o=h=l=c for FRED).'),
  v: z.number().describe('Always 0 — FRED series carry no volume.'),
};

/** zod raw shape for the structured output. */
export const getObservationsOutputShape = {
  series_id: z.string(),
  from: z.string(),
  to: z.string(),
  count: z.number(),
  bars: z.array(z.object(barRowShape)),
};

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const toolError = (message: string): ToolResult => ({
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
});

/** Parse a strict `YYYY-MM-DD` at UTC midnight. Returns null if malformed or not a real calendar day. */
function parseUtcDay(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject JS date rollover (e.g. "2024-02-31" → Mar 2): re-render and compare.
  if (d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

/**
 * Build the `get_observations` handler from injected deps. The handler validates
 * input, calls the fetcher with an inclusive→half-open range, shapes the result,
 * and returns a tool error (never throws) on any failure.
 */
export function makeGetObservationsHandler(deps: { apiKey: string; fetchObservations: FetchObservations }) {
  return async (args: { series_id: string; from: string; to: string }): Promise<ToolResult> => {
    const seriesId = args.series_id.trim();
    if (seriesId.length === 0) return toolError('series_id must not be empty.');

    const from = parseUtcDay(args.from);
    if (from === null) return toolError(`Invalid "from" date: "${args.from}". Expected YYYY-MM-DD.`);
    const to = parseUtcDay(args.to);
    if (to === null) return toolError(`Invalid "to" date: "${args.to}". Expected YYYY-MM-DD.`);
    if (from.getTime() > to.getTime()) {
      return toolError(`"from" (${args.from}) must be on or before "to" (${args.to}).`);
    }

    // The adapter range is half-open [from, to); add one day so the caller's `to` is inclusive.
    const range: DateRange = { from, to: new Date(to.getTime() + ONE_DAY_MS) };

    try {
      const bars = await deps.fetchObservations(seriesId, range, { apiKey: deps.apiKey });
      const out = barsToOutput(seriesId, args.from, args.to, bars);
      return { content: [{ type: 'text', text: observationsSummary(out) }], structuredContent: out };
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  };
}
