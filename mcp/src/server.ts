import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchFredObservations } from '@livefolio/fred';
import {
  makeGetObservationsHandler,
  getObservationsInputShape,
  getObservationsOutputShape,
  type FetchObservations,
} from './tools/observations';

export type ServerDeps = {
  /** FRED API key, forwarded to the fetcher on every call. */
  apiKey: string;
  /** Override the live fetcher. Tests inject a stub to stay offline. */
  fetchObservations?: FetchObservations;
};

// Keep in sync with mcp/package.json "version" (repo CI has a version-guard).
const VERSION = '0.1.0';

/**
 * Build the FRED MCP server with the `get_observations` tool registered. Pure of
 * process I/O — returns the server object; the caller connects a transport.
 * `fetchObservations` defaults to the adapter's `fetchFredObservations`.
 */
export function createServer(deps: ServerDeps): McpServer {
  const fetchObservations = deps.fetchObservations ?? fetchFredObservations;
  const handler = makeGetObservationsHandler({ apiKey: deps.apiKey, fetchObservations });

  const server = new McpServer({ name: 'fred', version: VERSION });

  server.registerTool(
    'get_observations',
    {
      title: 'Get FRED observations',
      description:
        'Historical observations for one FRED (St. Louis Fed) macro series over an inclusive ' +
        'date range, returned as degenerate OHLCV bars (open=high=low=close=value, volume=0; ' +
        'the value is `c`). Native publish cadence (monthly/quarterly/weekly/daily) — not ' +
        'resampled. UTC-midnight timestamps; FRED missing-value rows are dropped. Read-only.',
      inputSchema: getObservationsInputShape,
      outputSchema: getObservationsOutputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler,
  );

  return server;
}
