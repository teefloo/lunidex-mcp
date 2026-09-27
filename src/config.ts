export const DEFAULT_API_BASE_URL = 'https://lunidex.app/api/v1';

export class ConfigurationError extends Error {
  constructor(
    readonly code: 'MISSING_API_KEY' | 'INVALID_CONFIGURATION',
    message: string,
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export interface LunidexConfig {
  apiBaseUrl: URL;
  apiKey: string;
}

export function readLunidexApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): URL {
  const configuredBaseUrl = env.LUNIDEX_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  let apiBaseUrl: URL;
  try {
    apiBaseUrl = new URL(configuredBaseUrl);
  } catch {
    throw new ConfigurationError(
      'INVALID_CONFIGURATION',
      'LUNIDEX_API_BASE_URL must be a valid HTTPS URL.',
    );
  }

  const localHttpHost = new Set(['localhost', '127.0.0.1', '[::1]']);
  const isSecure = apiBaseUrl.protocol === 'https:';
  const isLocalHttp =
    apiBaseUrl.protocol === 'http:' && localHttpHost.has(apiBaseUrl.hostname);

  if (
    (!isSecure && !isLocalHttp) ||
    apiBaseUrl.username !== '' ||
    apiBaseUrl.password !== '' ||
    apiBaseUrl.search !== '' ||
    apiBaseUrl.hash !== ''
  ) {
    throw new ConfigurationError(
      'INVALID_CONFIGURATION',
      'LUNIDEX_API_BASE_URL must use HTTPS (HTTP is allowed only for localhost mock servers) and must not contain credentials, a query, or a fragment.',
    );
  }

  apiBaseUrl.pathname = `${apiBaseUrl.pathname.replace(/\/+$/, '')}/`;
  return apiBaseUrl;
}

export function readLunidexConfig(
  env: NodeJS.ProcessEnv = process.env,
): LunidexConfig {
  const apiKey = env.LUNIDEX_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigurationError(
      'MISSING_API_KEY',
      'LUNIDEX_API_KEY is not configured. Set it in the MCP server process environment.',
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new ConfigurationError(
      'INVALID_CONFIGURATION',
      'LUNIDEX_API_KEY must not contain control characters.',
    );
  }

  return { apiBaseUrl: readLunidexApiBaseUrl(env), apiKey };
}
