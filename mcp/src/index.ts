import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

/** Log to stderr (never stdout — that is the JSON-RPC channel) and exit non-zero. */
function fail(message: string): never {
  process.stderr.write(`fred-mcp: ${message}\n`);
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`fred-mcp: unhandled rejection: ${String(reason)}\n`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`fred-mcp: uncaught exception: ${detail}\n`);
  process.exit(1);
});

async function main(): Promise<void> {
  const apiKey = process.env.FRED_API_KEY;
  if (apiKey === undefined || apiKey.trim() === '') {
    fail(
      'FRED_API_KEY is not set. Get a free key at ' +
        'https://fred.stlouisfed.org/docs/api/api_key.html and set the FRED_API_KEY env var.',
    );
  }

  const server = createServer({ apiKey });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Connected. stdout is now the JSON-RPC channel; never write to it.
}

main().catch((err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`fred-mcp: failed to start: ${detail}\n`);
  process.exit(1);
});
