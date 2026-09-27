import type { McpServer } from '@modelcontextprotocol/server';
import { fetchPublicOpenApiDocument, redactCredential } from './api.js';

export function registerLunidexResources(server: McpServer): void {
  server.registerResource(
    'api-openapi',
    'lunidex://api/openapi',
    {
      description: 'The public OpenAPI 3.1 specification for the Lunidex API.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const document = await fetchPublicOpenApiDocument();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: redactCredential(JSON.stringify(document)),
          },
        ],
      };
    },
  );
}
