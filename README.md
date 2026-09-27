# Lunidex MCP server

A local, stdio-based MCP server that exposes Lunidex account reads and supported writes to MCP clients. It uses the official TypeScript MCP SDK and forwards requests to `https://lunidex.app/api/v1` with a server-side Lunidex API key.

## Design

The project uses TypeScript on Node.js and the official `@modelcontextprotocol/server` v2 SDK. The current MCP specification is `2026-07-28`; the SDK’s `serveStdio` entry supports MCP’s stdio transport and compatible clients. Stdio fits local MCP hosts that launch a server process, so there is no network-facing MCP endpoint or additional service to run.

The SDK and protocol documentation checked for this implementation:

- [MCP specification: tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP specification: transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Official TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Official TypeScript SDK: build a server](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server)
- [Official TypeScript SDK: stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)

## Requirements and build

Use Node.js 22.13 or newer and npm.

```sh
npm ci
npm run build
```

`npm start` runs the TypeScript source directly. MCP clients can also run the built server at `dist/index.js`.

## Authentication

Create a Lunidex API key with `read_write` permission to use all tools and provide it through the MCP server process environment as `LUNIDEX_API_KEY`. A read-only key can use the read tools; Lunidex rejects write tools with `INSUFFICIENT_PERMISSION`. The key is never a tool argument, is never logged by this server, and is not returned to the MCP client. A blank or absent key produces a `MISSING_API_KEY` tool error before any API request is made.

Copy [`.env.example`](.env.example) only as a reference; the server does not read `.env` files automatically. Configure the environment through your MCP host’s secure server configuration. [The sample MCP client config](config/mcp-client.example.json) contains a placeholder only. Do not put a real key in source control, a prompt, or a client-visible tool argument.

`LUNIDEX_API_BASE_URL` is optional and defaults to `https://lunidex.app/api/v1`. It must use HTTPS; plain HTTP is allowed only for `localhost`/loopback mock servers. The server adds the documented API routes to that base URL. This override is useful for a local mock API and compatible deployments.

## MCP client configuration

Copy the shape in `config/mcp-client.example.json` into your MCP client configuration. Replace the executable argument with the absolute path to this repository’s built `dist/index.js`, then set `LUNIDEX_API_KEY` in the server environment using your client’s secure configuration mechanism.

The server communicates only over stdio. Standard output is reserved for MCP messages; it does not print startup banners or API data to stdout.

## Tools and resource

Each successful tool returns the Lunidex JSON envelope, including `data` and `meta` when present, as JSON text. The `lunidex://api/openapi` resource reads the public OpenAPI document without sending the account key. The API’s structured error `code` and `message` are returned in an MCP error result; error details and unrelated body fields are omitted. Any API key present in an upstream error message is redacted.

| Tool | Lunidex route | Inputs |
| --- | --- | --- |
| `get_me` | `GET /me` | none |
| `get_summary` | `GET /summary` | none |
| `list_cards` | `GET /cards` | `cursor`, `limit` (1–100), `language`, `set` |
| `get_card` | `GET /cards/{cardId}` | `cardId`, optional `language` |
| `search_sealed_catalogue` | `GET /sealed/catalogue` | optional `q` (up to 150 characters), `cursor` |
| `list_sealed_positions` | `GET /sealed/positions` | `cursor`, `limit` (1–100), `language` (`unknown`, `en`, `fr`, `es`, `de`, `it`, `ja`), `productId` |
| `get_sealed_position` | `GET /sealed/positions/{productId}` | positive integer `productId` |
| `list_sealed_transactions` | `GET /sealed/transactions` | `cursor`, `limit` (1–100), `language`, `productId`, `type` (`buy`, `sell`, `exchange`), `includeVoided`, `voided` |
| `get_sealed_transaction` | `GET /sealed/transactions/{id}` | UUID `id` |
| `set_card_quantity` | `PUT /cards/{cardId}` | `cardId`, `language`, `variant` (`unspecified`, `normal`, `reverse`, `holo`), absolute `quantity` (0–10,000; zero removes the holding) |
| `create_sealed_transaction` | `POST /sealed/transactions` | Transaction draft, current `expectedRevision`, required `idempotencyKey` (8–200 characters) |
| `update_sealed_transaction` | `PATCH /sealed/transactions/{id}` | UUID `id`, current transaction `revision`, current account `expectedRevision`, replacement transaction draft |
| `void_sealed_transaction` | `POST /sealed/transactions/{id}/void` | UUID `id`, current transaction `revision`, current account `expectedRevision` |

Opaque cursors are passed through unchanged. Catalogue query length counts Unicode code points, with a maximum of 150. Transaction create and update inputs use the Lunidex API’s transaction draft fields, including product, language, date, quantity, prices, fees, exchange details, and allocation method where applicable. Revision fields let the API reject stale edits. The required creation idempotency key can be reused if the caller retries the same request. Other write calls are not automatically retried. Write tools change the authenticated account’s data; the Lunidex API’s own validation and rate limits still apply. The MCP exposes only writes supported by the public Lunidex API and does not expose a delete operation.

## Development checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

The protocol smoke test launches the actual stdio server and an in-process loopback mock API, including an unauthenticated read of the public OpenAPI resource. It never calls production or requires a real Lunidex account/key.
