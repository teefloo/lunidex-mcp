import {
  ConfigurationError,
  readLunidexApiBaseUrl,
  readLunidexConfig,
} from './config.js';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export interface ApiErrorBody {
  code: string;
  message: string;
}

export class LunidexApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LunidexApiError';
  }
}

export type QueryValue = string | number | boolean | undefined;
export type Query = Record<string, QueryValue>;
export type FetchFunction = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new LunidexApiError(
      response.status,
      'RESPONSE_TOO_LARGE',
      'The Lunidex API response exceeded the configured size limit.',
    );
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new LunidexApiError(
          response.status,
          'RESPONSE_TOO_LARGE',
          'The Lunidex API response exceeded the configured size limit.',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function redactCredential(text: string, apiKey = process.env.LUNIDEX_API_KEY?.trim() || ''): string {
  const withoutSecret = apiKey ? text.replaceAll(apiKey, '[redacted]') : text;
  return withoutSecret.replace(/[\u0000-\u001f\u007f]/g, ' ');
}

function safeApiMessage(message: string, apiKey: string): string {
  return redactCredential(message, apiKey).slice(0, 1000);
}

function getPublicApiError(
  payload: unknown,
  response: Response,
  apiKey: string,
): LunidexApiError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const { code, message } = payload.error;
    if (typeof code === 'string' && typeof message === 'string') {
      const safeCode =
        /^[A-Za-z0-9_-]{1,128}$/.test(code) && (!apiKey || !code.includes(apiKey))
          ? code
          : 'API_ERROR';
      return new LunidexApiError(
        response.status,
        safeCode,
        safeApiMessage(message, apiKey),
      );
    }
  }

  return new LunidexApiError(
    response.status,
    `HTTP_${response.status}`,
    `Lunidex API request failed with HTTP ${response.status}.`,
  );
}

function parseResponseText(text: string, response: Response, apiKey: string): unknown {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) throw getPublicApiError(null, response, apiKey);
    throw new LunidexApiError(
      response.status,
      'INVALID_RESPONSE',
      'The Lunidex API returned an unreadable response.',
    );
  }

  if (!response.ok) throw getPublicApiError(payload, response, apiKey);
  return payload;
}

function assertDataEnvelope(payload: unknown, response: Response): asserts payload is Record<string, unknown> {
  if (!isRecord(payload) || !Object.hasOwn(payload, 'data')) {
    throw new LunidexApiError(
      response.status,
      'INVALID_RESPONSE',
      'The Lunidex API returned an unexpected response shape.',
    );
  }
}

export class LunidexApiClient {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetcher: FetchFunction = fetch,
  ) {}

  async get(path: string, query: Query = {}): Promise<unknown> {
    return this.request('GET', path, undefined, query);
  }

  async put(path: string, body: unknown): Promise<unknown> {
    return this.request('PUT', path, body);
  }

  async post(
    path: string,
    body: unknown,
    options: { idempotencyKey?: string } = {},
  ): Promise<unknown> {
    return this.request('POST', path, body, {}, options.idempotencyKey);
  }

  async patch(path: string, body: unknown): Promise<unknown> {
    return this.request('PATCH', path, body);
  }

  private async request(
    method: 'GET' | 'PUT' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    query: Query = {},
    idempotencyKey?: string,
  ): Promise<unknown> {
    const { apiBaseUrl, apiKey } = readLunidexConfig(this.env);
    const url = new URL(path.replace(/^\/+/, ''), apiBaseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (idempotencyKey !== undefined) headers.set('Idempotency-Key', idempotencyKey);

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new LunidexApiError(
        0,
        'API_UNAVAILABLE',
        'Could not reach the Lunidex API. Check the network and try again.',
      );
    }

    let responseText: string;
    try {
      responseText = await readResponseText(response);
    } catch (error) {
      if (error instanceof LunidexApiError) throw error;
      throw new LunidexApiError(
        response.status,
        'INVALID_RESPONSE',
        'The Lunidex API returned an unreadable response.',
      );
    }

    const payload = parseResponseText(responseText, response, apiKey);
    assertDataEnvelope(payload, response);
    return payload;
  }
}

export async function fetchPublicOpenApiDocument(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: FetchFunction = fetch,
): Promise<unknown> {
  const url = new URL('openapi.json', readLunidexApiBaseUrl(env));
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new LunidexApiError(
      0,
      'API_UNAVAILABLE',
      'Could not reach the public Lunidex OpenAPI document.',
    );
  }

  let responseText: string;
  try {
    responseText = await readResponseText(response);
  } catch (error) {
    if (error instanceof LunidexApiError) throw error;
    throw new LunidexApiError(
      response.status,
      'INVALID_RESPONSE',
      'The public Lunidex OpenAPI document was unreadable.',
    );
  }

  const redactionToken = env.LUNIDEX_API_KEY?.trim() || '';
  let payload: unknown;
  try {
    payload = JSON.parse(responseText) as unknown;
  } catch {
    if (!response.ok) throw getPublicApiError(null, response, redactionToken);
    throw new LunidexApiError(
      response.status,
      'INVALID_RESPONSE',
      'The public Lunidex OpenAPI document was unreadable.',
    );
  }
  if (!response.ok) throw getPublicApiError(payload, response, redactionToken);
  if (!isRecord(payload)) {
    throw new LunidexApiError(
      response.status,
      'INVALID_RESPONSE',
      'The public Lunidex OpenAPI document had an unexpected shape.',
    );
  }
  return payload;
}

export function toPublicError(error: unknown): ApiErrorBody {
  if (error instanceof ConfigurationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof LunidexApiError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'The Lunidex MCP server encountered an unexpected error.',
  };
}
