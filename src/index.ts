import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerLunidexResources } from './resources.js';
import { registerLunidexTools } from './tools.js';

export function createLunidexServer(): McpServer {
  const server = new McpServer({ name: 'lunidex', version: '0.1.0' });
  registerLunidexTools(server);
  registerLunidexResources(server);
  return server;
}

void serveStdio(createLunidexServer);
