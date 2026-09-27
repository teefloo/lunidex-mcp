import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { LunidexApiClient, LunidexApiError } from '../src/api.js';
import { ConfigurationError, DEFAULT_API_BASE_URL, readLunidexConfig } from '../src/config.js';

const mockBearer = randomBytes(32).toString('base64url');

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('uses the configured bearer key for GET requests and preserves the API envelope', async () => {
  let requestUrl: URL | undefined;
  let requestInit: RequestInit | undefined;
  const client = new LunidexApiClient(
    {
      LUNIDEX_API_KEY: mockBearer,
      LUNIDEX_API_BASE_URL: 'http://127.0.0.1:43117/api/v1',
    },
    async (input, init) => {
      requestUrl = new URL(String(input));
      requestInit = init;
      return jsonResponse({ data: [{ id: 'mock-card' }], meta: { nextCursor: 'next' } });
    },
  );

  const result = await client.get('cards', { limit: 12, language: 'fr', cursor: 'opaque value' });

  assert.deepEqual(result, { data: [{ id: 'mock-card' }], meta: { nextCursor: 'next' } });
  assert.equal(requestUrl?.pathname, '/api/v1/cards');
  assert.equal(requestUrl?.searchParams.get('limit'), '12');
  assert.equal(requestUrl?.searchParams.get('language'), 'fr');
  assert.equal(requestUrl?.searchParams.get('cursor'), 'opaque value');
  assert.equal(requestInit?.method, 'GET');
  assert.equal(requestInit?.cache, 'no-store');
  assert.equal(new Headers(requestInit?.headers).get('accept'), 'application/json');
  assert.ok(
    new Headers(requestInit?.headers).get('authorization') === `Bearer ${mockBearer}`,
    'the server must send the configured bearer key',
  );
});

test('sends supported JSON writes with the bearer key and transaction idempotency header', async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const client = new LunidexApiClient(
    {
      LUNIDEX_API_KEY: mockBearer,
      LUNIDEX_API_BASE_URL: 'http://127.0.0.1:43120/api/v1',
    },
    async (input, init) => {
      requests.push({ url: new URL(String(input)), init: init ?? {} });
      return jsonResponse({ data: { saved: true } });
    },
  );
  const cardBody = { language: 'en', variant: 'normal', quantity: 2 };
  const transactionBody = {
    expectedRevision: 3,
    kind: 'buy',
    cardmarketProductId: 12345,
    language: 'en',
    date: '2026-09-28',
    quantity: 1,
    unitPriceCents: 2500,
  };

  await client.put('cards/base1-001', cardBody);
  await client.post('sealed/transactions', transactionBody, {
    idempotencyKey: 'mcp-create-20260928-0001',
  });
  await client.patch('sealed/transactions/00000000-0000-4000-8000-000000000002', {
    ...transactionBody,
    revision: 1,
  });

  assert.deepEqual(
    requests.map(({ url, init }) => ({
      method: init.method,
      pathname: url.pathname,
      body: JSON.parse(String(init.body)),
      authorization: new Headers(init.headers).get('authorization'),
      contentType: new Headers(init.headers).get('content-type'),
      idempotencyKey: new Headers(init.headers).get('idempotency-key'),
      cache: init.cache,
    })),
    [
      {
        method: 'PUT',
        pathname: '/api/v1/cards/base1-001',
        body: cardBody,
        authorization: `Bearer ${mockBearer}`,
        contentType: 'application/json',
        idempotencyKey: null,
        cache: 'no-store',
      },
      {
        method: 'POST',
        pathname: '/api/v1/sealed/transactions',
        body: transactionBody,
        authorization: `Bearer ${mockBearer}`,
        contentType: 'application/json',
        idempotencyKey: 'mcp-create-20260928-0001',
        cache: 'no-store',
      },
      {
        method: 'PATCH',
        pathname: '/api/v1/sealed/transactions/00000000-0000-4000-8000-000000000002',
        body: { ...transactionBody, revision: 1 },
        authorization: `Bearer ${mockBearer}`,
        contentType: 'application/json',
        idempotencyKey: null,
        cache: 'no-store',
      },
    ],
  );
});

test('requires a non-blank key and does not make an API request when it is missing', async () => {
  let wasCalled = false;
  const client = new LunidexApiClient({ LUNIDEX_API_KEY: '  ' }, async () => {
    wasCalled = true;
    return jsonResponse({ data: null });
  });

  await assert.rejects(client.get('me'), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    assert.match(error.message, /LUNIDEX_API_KEY/);
    return true;
  });
  assert.equal(wasCalled, false);
});

test('defaults to production and rejects unsafe API base URLs', () => {
  assert.equal(
    readLunidexConfig({ LUNIDEX_API_KEY: mockBearer }).apiBaseUrl.href,
    `${DEFAULT_API_BASE_URL}/`,
  );
  assert.throws(
    () =>
      readLunidexConfig({
        LUNIDEX_API_KEY: mockBearer,
        LUNIDEX_API_BASE_URL: 'http://api.example.test/api/v1',
      }),
    ConfigurationError,
  );
  assert.throws(
    () =>
      readLunidexConfig({
        LUNIDEX_API_KEY: mockBearer,
        LUNIDEX_API_BASE_URL: 'https://user:pass@lunidex.app/api/v1',
      }),
    ConfigurationError,
  );
});

test('preserves API error codes and messages but omits details and redacts the key', async () => {
  const client = new LunidexApiClient(
    { LUNIDEX_API_KEY: mockBearer },
    async () =>
      jsonResponse(
        {
          error: {
            code: 'INVALID_API_KEY',
            message: `Rejected token ${mockBearer}`,
            details: { privateFixture: 'must not be forwarded' },
          },
        },
        401,
      ),
  );

  await assert.rejects(client.get('me'), (error: unknown) => {
    assert.ok(error instanceof LunidexApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'INVALID_API_KEY');
    assert.equal(error.message, 'Rejected token [redacted]');
    assert.equal(error.message.includes(mockBearer), false);
    return true;
  });
});

test('maps a non-JSON HTTP failure to a safe status error', async () => {
  const client = new LunidexApiClient(
    { LUNIDEX_API_KEY: mockBearer },
    async () => new Response('private upstream body', { status: 503 }),
  );

  await assert.rejects(client.get('summary'), (error: unknown) => {
    assert.ok(error instanceof LunidexApiError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'HTTP_503');
    assert.equal(error.message.includes('private upstream body'), false);
    return true;
  });
});
