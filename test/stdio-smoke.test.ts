import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import test from 'node:test';

const projectRoot = process.cwd();

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content.find((content) => content.type === 'text');
  assert.ok(item?.text);
  return item.text;
}

test('starts the stdio server and lists/calls tools and a public resource against a local mock API', async () => {
  const mockBearer = randomBytes(32).toString('base64url');
  const receivedRequests: Array<{ method: string; path: string; authorization?: string }> = [];
  const mockApi = createServer((request, response) => {
    receivedRequests.push({
      method: request.method ?? '',
      path: request.url ?? '',
      authorization: request.headers.authorization,
    });
    response.setHeader('content-type', 'application/json');

    if (request.method === 'GET' && request.url === '/api/v1/me') {
      response.writeHead(200);
      response.end(JSON.stringify({ data: { ok: true }, meta: { source: 'local-mock' } }));
      return;
    }

    if (request.method === 'GET' && request.url === '/api/v1/summary') {
      response.writeHead(401);
      response.end(
        JSON.stringify({
          error: {
            code: 'INVALID_API_KEY',
            message: `Rejected token ${mockBearer}`,
            details: { privateFixture: 'must not be forwarded' },
          },
        }),
      );
      return;
    }

    if (request.method === 'GET' && request.url === '/api/v1/openapi.json') {
      response.writeHead(200);
      response.end(
        JSON.stringify({ openapi: '3.1.0', paths: { '/me': {} }, 'x-mock': mockBearer }),
      );
      return;
    }

    response.writeHead(404);
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Mock route not found' } }));
  });

  const port = await new Promise<number>((resolve, reject) => {
    mockApi.once('error', reject);
    mockApi.listen(0, '127.0.0.1', () => {
      const address = mockApi.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Mock API did not bind a TCP port.'));
      } else {
        resolve(address.port);
      }
    });
  });

  const client = new Client(
    { name: 'lunidex-stdio-smoke', version: '0.1.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    cwd: projectRoot,
    env: {
      ...getDefaultEnvironment(),
      LUNIDEX_API_KEY: mockBearer,
      LUNIDEX_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
    },
    stderr: 'pipe',
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 9);
    assert.ok(tools.some((tool) => tool.name === 'get_me'));
    assert.ok(tools.some((tool) => tool.name === 'get_sealed_transaction'));

    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((resource) => resource.uri), ['lunidex://api/openapi']);

    const invalid = await client.callTool({
      name: 'list_cards',
      arguments: { limit: 1000 },
    });
    assert.equal(invalid.isError, true);
    assert.equal(receivedRequests.length, 0);

    const profile = await client.callTool({ name: 'get_me', arguments: {} });
    assert.equal(profile.isError ?? false, false);
    assert.deepEqual(JSON.parse(textContent(profile)), {
      data: { ok: true },
      meta: { source: 'local-mock' },
    });

    const unauthorized = await client.callTool({ name: 'get_summary', arguments: {} });
    const errorText = textContent(unauthorized);
    assert.equal(unauthorized.isError, true);
    assert.match(errorText, /INVALID_API_KEY/);
    assert.match(errorText, /Rejected token \[redacted\]/);
    assert.equal(errorText.includes(mockBearer), false);
    assert.equal(errorText.includes('privateFixture'), false);

    const openApi = await client.readResource({ uri: 'lunidex://api/openapi' });
    const openApiContent = openApi.contents[0];
    assert.ok(openApiContent && 'text' in openApiContent);
    const openApiDocument = JSON.parse(openApiContent.text) as Record<string, unknown>;
    assert.equal(openApiDocument.openapi, '3.1.0');
    assert.equal(JSON.stringify(openApiDocument).includes(mockBearer), false);

    assert.equal(receivedRequests.length, 3);
    assert.ok(receivedRequests.every((request) => request.method === 'GET'));
    assert.ok(
      receivedRequests
        .filter((request) => request.path !== '/api/v1/openapi.json')
        .every((request) => request.authorization === `Bearer ${mockBearer}`),
    );
    assert.equal(
      receivedRequests.find((request) => request.path === '/api/v1/openapi.json')?.authorization,
      undefined,
    );
    assert.ok(receivedRequests.some((request) => request.path === '/api/v1/me'));
    assert.ok(receivedRequests.some((request) => request.path === '/api/v1/summary'));
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => {
      mockApi.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
