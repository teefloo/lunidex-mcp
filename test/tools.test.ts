import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { LunidexApiClient } from '../src/api.js';
import { registerLunidexTools } from '../src/tools.js';

async function connectInMemory(api: LunidexApiClient) {
  const server = new McpServer({ name: 'lunidex-test', version: '0.1.0' });
  registerLunidexTools(server, api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'lunidex-test-client', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    server,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content.find((content) => content.type === 'text');
  assert.ok(item?.text);
  return item.text;
}

test('registers only the nine verified read-only API tools', async () => {
  const api = new LunidexApiClient({});
  const session = await connectInMemory(api);
  try {
    const { tools } = await session.client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        'get_me',
        'get_summary',
        'list_cards',
        'get_card',
        'search_sealed_catalogue',
        'list_sealed_positions',
        'get_sealed_position',
        'list_sealed_transactions',
        'get_sealed_transaction',
      ],
    );
    assert.equal(tools.some((tool) => /write|update|delete|void/i.test(tool.name)), false);
  } finally {
    await session.close();
  }
});

test('maps every read-only MCP tool to its verified Lunidex API route and query', async () => {
  const requests: Array<{ pathname: string; query: Record<string, string> }> = [];
  const api = new LunidexApiClient(
    {
      LUNIDEX_API_KEY: 'local-test-key',
      LUNIDEX_API_BASE_URL: 'http://127.0.0.1:43119/api/v1',
    },
    async (input) => {
      const url = new URL(String(input));
      requests.push({
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
      });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  );
  const session = await connectInMemory(api);
  try {
    const calls = [
      { name: 'get_me', arguments: {} },
      { name: 'get_summary', arguments: {} },
      {
        name: 'list_cards',
        arguments: { cursor: 'cards-next', limit: 12, language: 'fr', set: 'base1' },
      },
      { name: 'get_card', arguments: { cardId: 'base1-001', language: 'en' } },
      { name: 'search_sealed_catalogue', arguments: { q: 'elite trainer', cursor: 'catalogue-next' } },
      {
        name: 'list_sealed_positions',
        arguments: { cursor: 'positions-next', limit: 8, language: 'ja', productId: 12345 },
      },
      { name: 'get_sealed_position', arguments: { productId: 12345 } },
      {
        name: 'list_sealed_transactions',
        arguments: {
          cursor: 'transactions-next',
          limit: 5,
          language: 'en',
          productId: 12345,
          type: 'buy',
          includeVoided: true,
          voided: false,
        },
      },
      {
        name: 'get_sealed_transaction',
        arguments: { id: '00000000-0000-4000-8000-000000000002' },
      },
    ];

    for (const call of calls) {
      const result = await session.client.callTool(call);
      assert.equal(result.isError ?? false, false, `${call.name} should succeed`);
    }

    assert.deepEqual(requests, [
      { pathname: '/api/v1/me', query: {} },
      { pathname: '/api/v1/summary', query: {} },
      {
        pathname: '/api/v1/cards',
        query: { cursor: 'cards-next', limit: '12', language: 'fr', set: 'base1' },
      },
      { pathname: '/api/v1/cards/base1-001', query: { language: 'en' } },
      {
        pathname: '/api/v1/sealed/catalogue',
        query: { q: 'elite trainer', cursor: 'catalogue-next' },
      },
      {
        pathname: '/api/v1/sealed/positions',
        query: { cursor: 'positions-next', limit: '8', language: 'ja', productId: '12345' },
      },
      { pathname: '/api/v1/sealed/positions/12345', query: {} },
      {
        pathname: '/api/v1/sealed/transactions',
        query: {
          cursor: 'transactions-next',
          limit: '5',
          language: 'en',
          productId: '12345',
          type: 'buy',
          includeVoided: 'true',
          voided: 'false',
        },
      },
      {
        pathname: '/api/v1/sealed/transactions/00000000-0000-4000-8000-000000000002',
        query: {},
      },
    ]);
  } finally {
    await session.close();
  }
});

test('validates pagination, filters, UUIDs and exact tool arguments before making API calls', async () => {
  let requests = 0;
  const api = new LunidexApiClient({}, async () => {
    requests += 1;
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  const session = await connectInMemory(api);
  try {
    const invalidLimit = await session.client.callTool({
      name: 'list_cards',
      arguments: { limit: 101 },
    });
    const invalidProductId = await session.client.callTool({
      name: 'get_sealed_position',
      arguments: { productId: 0 },
    });
    const invalidTransactionId = await session.client.callTool({
      name: 'get_sealed_transaction',
      arguments: { id: 'not-a-uuid' },
    });
    const unknownArgument = await session.client.callTool({
      name: 'get_me',
      arguments: { unexpected: true },
    });

    assert.equal(invalidLimit.isError, true);
    assert.equal(invalidProductId.isError, true);
    assert.equal(invalidTransactionId.isError, true);
    assert.equal(unknownArgument.isError, true);
    assert.equal(requests, 0);
  } finally {
    await session.close();
  }
});

test('accepts 150 Unicode code points and opaque cursors without an invented length limit', async () => {
  const mockBearer = randomBytes(32).toString('base64url');
  let requestUrl: URL | undefined;
  let requests = 0;
  const api = new LunidexApiClient(
    { LUNIDEX_API_KEY: mockBearer, LUNIDEX_API_BASE_URL: 'http://127.0.0.1:43118/api/v1' },
    async (input) => {
      requests += 1;
      requestUrl = new URL(String(input));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  );
  const session = await connectInMemory(api);
  try {
    const query = '😀'.repeat(150);
    const longCursor = 'opaque-cursor'.repeat(300);
    const accepted = await session.client.callTool({
      name: 'search_sealed_catalogue',
      arguments: { q: query, cursor: longCursor },
    });
    const rejected = await session.client.callTool({
      name: 'search_sealed_catalogue',
      arguments: { q: `${query}😀` },
    });

    assert.equal(accepted.isError ?? false, false);
    assert.equal(requestUrl?.searchParams.get('q'), query);
    assert.equal(requestUrl?.searchParams.get('cursor'), longCursor);
    assert.equal(rejected.isError, true);
    assert.equal(requests, 1);
  } finally {
    await session.close();
  }
});

test('returns a clear MCP configuration error when the key is absent', async () => {
  let requests = 0;
  const api = new LunidexApiClient({}, async () => {
    requests += 1;
    return new Response(JSON.stringify({ data: null }), { status: 200 });
  });
  const session = await connectInMemory(api);
  try {
    const result = await session.client.callTool({ name: 'get_me', arguments: {} });
    const responseText = textContent(result);
    assert.equal(result.isError, true);
    assert.match(responseText, /MISSING_API_KEY/);
    assert.match(responseText, /LUNIDEX_API_KEY/);
    assert.equal(requests, 0);
  } finally {
    await session.close();
  }
});
