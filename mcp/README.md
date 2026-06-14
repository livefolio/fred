# @livefolio/fred-mcp

Local stdio [Model Context Protocol](https://modelcontextprotocol.io) server exposing
[`@livefolio/fred`](https://github.com/livefolio/fred) read-only FRED (St. Louis Fed)
macro data — historical observations over a date range — as an agent-callable tool.

## Tool

### `get_observations`

Historical observations for one FRED series over an **inclusive** date range, returned as
degenerate OHLCV bars (`open = high = low = close = value`, `volume = 0`; the value is `c`).
Native publish cadence (monthly/quarterly/weekly/daily) — not resampled. UTC-midnight
timestamps; FRED missing-value rows are dropped.

```jsonc
// input
{ "series_id": "GDP", "from": "2022-01-01", "to": "2024-12-31" }
```

## Usage

Requires a free FRED API key (https://fred.stlouisfed.org/docs/api/api_key.html), supplied
via the `FRED_API_KEY` environment variable.

```bash
claude mcp add fred --env FRED_API_KEY=your_key_here -- npx -y @livefolio/fred-mcp
```

Or in a client config block:

```jsonc
{
  "mcpServers": {
    "fred": {
      "command": "npx",
      "args": ["-y", "@livefolio/fred-mcp"],
      "env": { "FRED_API_KEY": "your_key_here" }
    }
  }
}
```

The server writes only JSON-RPC to stdout; all diagnostics go to stderr.
