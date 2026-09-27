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

test('registers the nine read tools and four verified write tools', async () => {
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
        'set_card_quantity',
        'create_sealed_transaction',
        'update_sealed_transaction',
        'void_sealed_transaction',
      ],
    );
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

test('maps write tools to the verified Lunidex routes and optimistic revision fields', async () => {
  const requests: Array<{
    method: string;
    pathname: string;
    body: unknown;
    authorization: string | null;
    idempotencyKey: string | null;
  }> = [];
  const apiKey = 'write-test-key';
  const api = new LunidexApiClient(
    {
      LUNIDEX_API_KEY: apiKey,
      LUNIDEX_API_BASE_URL: 'http://127.0.0.1:43121/api/v1',
    },
    async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        method: init?.method ?? '',
        pathname: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body)),
        authorization: headers.get('authorization'),
        idempotencyKey: headers.get('idempotency-key'),
      });
      return new Response(JSON.stringify({ data: { saved: true } }), { status: 200 });
    },
  );
  const session = await connectInMemory(api);
  const id = '00000000-0000-4000-8000-000000000002';
  const transactionDraft = {
    kind: 'buy',
    cardmarketProductId: 12345,
    language: 'en',
    date: '2026-09-28',
    quantity: 1,
    unitPriceCents: 2500,
  };
  try {
    const writes = [
      {
        name: 'set_card_quantity',
        arguments: { cardId: 'base1-001', language: 'en', variant: 'normal', quantity: 2 },
      },
      {
        name: 'create_sealed_transaction',
        arguments: {
          idempotencyKey: 'mcp-create-20260928-0001',
          expectedRevision: 3,
          ...transactionDraft,
        },
      },
      {
        name: 'update_sealed_transaction',
        arguments: { id, revision: 1, expectedRevision: 4, ...transactionDraft },
      },
      {
        name: 'void_sealed_transaction',
        arguments: { id, revision: 1, expectedRevision: 5 },
      },
    ];

    for (const write of writes) {
      const result = await session.client.callTool(write);
      assert.equal(result.isError ?? false, false, `${write.name} should succeed`);
    }

    assert.deepEqual(requests, [
      {
        method: 'PUT',
        pathname: '/api/v1/cards/base1-001',
        body: { language: 'en', variant: 'normal', quantity: 2 },
        authorization: `Bearer ${apiKey}`,
        idempotencyKey: null,
      },
      {
        method: 'POST',
        pathname: '/api/v1/sealed/transactions',
        body: { expectedRevision: 3, ...transactionDraft },
        authorization: `Bearer ${apiKey}`,
        idempotencyKey: 'mcp-create-20260928-0001',
      },
      {
        method: 'PATCH',
        pathname: `/api/v1/sealed/transactions/${id}`,
        body: { revision: 1, expectedRevision: 4, ...transactionDraft },
        authorization: `Bearer ${apiKey}`,
        idempotencyKey: null,
      },
      {
        method: 'POST',
        pathname: `/api/v1/sealed/transactions/${id}/void`,
        body: { revision: 1, expectedRevision: 5 },
        authorization: `Bearer ${apiKey}`,
        idempotencyKey: null,
      },
    ]);

    const invalidCardQuantity = await session.client.callTool({
      name: 'set_card_quantity',
      arguments: { cardId: 'base1-001', language: 'en', variant: 'normal', quantity: 10_001 },
    });
    const invalidIdempotencyKey = await session.client.callTool({
      name: 'create_sealed_transaction',
      arguments: {
        idempotencyKey: 'short',
        expectedRevision: 3,
        ...transactionDraft,
      },
    });
    const missingUpdateRevision = await session.client.callTool({
      name: 'update_sealed_transaction',
      arguments: { id, revision: 0, expectedRevision: 4, ...transactionDraft },
    });
    const missingVoidRevision = await session.client.callTool({
      name: 'void_sealed_transaction',
      arguments: { id, revision: 1 },
    });

    assert.equal(invalidCardQuantity.isError, true);
    assert.equal(invalidIdempotencyKey.isError, true);
    assert.equal(missingUpdateRevision.isError, true);
    assert.equal(missingVoidRevision.isError, true);
    assert.equal(requests.length, 4);
  } finally {
    await session.close();
  }
});

test('surfaces Lunidex write-permission errors without retrying the mutation', async () => {
  let requests = 0;
  const api = new LunidexApiClient(
    { LUNIDEX_API_KEY: 'read-only-test-key' },
    async () => {
      requests += 1;
      return new Response(
        JSON.stringify({ error: { code: 'INSUFFICIENT_PERMISSION', message: 'This API key does not allow writes.' } }),
        { status: 403 },
      );
    },
  );
  const session = await connectInMemory(api);
  try {
    const result = await session.client.callTool({
      name: 'set_card_quantity',
      arguments: { cardId: 'base1-001', language: 'en', variant: 'normal', quantity: 2 },
    });

    assert.equal(result.isError, true);
    assert.match(textContent(result), /INSUFFICIENT_PERMISSION/);
    assert.equal(requests, 1);
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
