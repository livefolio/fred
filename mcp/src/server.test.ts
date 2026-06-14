import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Bar } from '@livefolio/sdk';
import { createServer } from './server';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
function obs(date: string, value: number): Bar {
  return { t: utc(date), open: value, high: value, low: value, close: value, volume: 0 };
}

const openClients: Client[] = [];

async function connect(deps: Parameters<typeof createServer>[0]): Promise<Client> {
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  openClients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((c) => c.close()));
});

describe('createServer', () => {
  it('advertises get_observations with read-only annotations and an output schema', async () => {
    const client = await connect({ apiKey: 'test', fetchObservations: vi.fn().mockResolvedValue([]) });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    const tool = tools[0]!;
    expect(tool.name).toBe('get_observations');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(tool.outputSchema).toBeDefined();
  });

  it('returns structuredContent + summary for a successful call', async () => {
    const fetchObservations = vi.fn().mockResolvedValue([obs('2024-01-01', 27000), obs('2024-04-01', 28000)]);
    const client = await connect({ apiKey: 'test', fetchObservations });
    const res = await client.callTool({
      name: 'get_observations',
      arguments: { series_id: 'GDP', from: '2024-01-01', to: '2024-12-31' },
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      series_id: 'GDP',
      count: 2,
      bars: [
        { t: '2024-01-01', c: 27000 },
        { t: '2024-04-01', c: 28000 },
      ],
    });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('2 observations');
  });

  it('surfaces an adapter throw as a tool error and keeps serving', async () => {
    const fetchObservations = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetchFredObservations: FRED error for series_id="XYZ": Bad Request.'))
      .mockResolvedValueOnce([obs('2024-01-01', 1)]);
    const client = await connect({ apiKey: 'test', fetchObservations });

    const bad = await client.callTool({
      name: 'get_observations',
      arguments: { series_id: 'XYZ', from: '2024-01-01', to: '2024-12-31' },
    });
    expect(bad.isError).toBe(true);
    const badContent = bad.content as Array<{ type: string; text: string }>;
    expect(badContent[0]!.text).toContain('FRED error for series_id="XYZ"');

    const good = await client.callTool({
      name: 'get_observations',
      arguments: { series_id: 'GDP', from: '2024-01-01', to: '2024-12-31' },
    });
    expect(good.isError).toBeFalsy();
  });
});
