# Lunidex MCP server

A local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that lets MCP clients read Lunidex account data and make the account updates supported by the Lunidex API. It runs over stdio and forwards requests to `https://lunidex.app/api/v1` using an API key supplied to the server process.

## Features

- Read account details, card holdings, sealed product positions, and transactions.
- Set card quantities and create, update, or void sealed product transactions.
- Read the public Lunidex OpenAPI document through the `lunidex://api/openapi` resource.
- Keep the API key in the server environment; it is not an MCP tool argument or logged by the server.

## Requirements

- Node.js 22.13 or newer
- npm

Install dependencies and build the server:

```sh
npm ci
npm run build
```

## Connect an MCP client

1. Create a Lunidex API key. Use a `read_write` key for all tools; a read-only key can call read tools, while Lunidex will reject writes.
2. Build the project with the commands above.
3. Copy the server entry from [`config/mcp-client.example.json`](config/mcp-client.example.json) into your MCP client configuration. Replace the example path with the absolute path to this repository's `dist/index.js`, then provide `LUNIDEX_API_KEY` through the host's server environment or secret storage.
4. Restart or reconnect the MCP client so it launches the server.

The example configuration uses `node` to run the built server. The server communicates over stdio: standard output is reserved for MCP messages, so startup messages and API data are not printed there.

> [!WARNING]
> Write tools change data in the authenticated Lunidex account. Review write arguments before calling them, and do not commit a real API key or place it in a prompt or tool argument.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `LUNIDEX_API_KEY` | For account tools | Lunidex API key. Blank or missing values produce a `MISSING_API_KEY` error before an account request is sent. |
| `LUNIDEX_API_BASE_URL` | No | API base URL; defaults to `https://lunidex.app/api/v1`. Must use HTTPS, except HTTP is allowed for `localhost` and loopback mock servers. Do not include credentials, a query, or a fragment. |

The server does not load `.env` files automatically. [`.env.example`](.env.example) documents the variables; configure them in the MCP host's server environment.

## Tools

Successful calls return the Lunidex JSON response envelope as text. Structured upstream errors preserve their `code` and `message`; error details are omitted, and API keys in messages are redacted.

### Read tools

| Tool | API route | Inputs |
| --- | --- | --- |
| `get_me` | `GET /me` | None |
| `get_summary` | `GET /summary` | None |
| `list_cards` | `GET /cards` | Optional `cursor`, `limit` (1–100), `language`, `set` |
| `get_card` | `GET /cards/{cardId}` | `cardId`; optional `language` |
| `search_sealed_catalogue` | `GET /sealed/catalogue` | Optional `q` (up to 150 Unicode code points), `cursor` |
| `list_sealed_positions` | `GET /sealed/positions` | Optional `cursor`, `limit` (1–100), `language` (`unknown`, `en`, `fr`, `es`, `de`, `it`, `ja`), `productId` |
| `get_sealed_position` | `GET /sealed/positions/{productId}` | Positive integer `productId` |
| `list_sealed_transactions` | `GET /sealed/transactions` | Optional `cursor`, `limit` (1–100), `language`, `productId`, `type` (`buy`, `sell`, `exchange`), `includeVoided`, `voided` |
| `get_sealed_transaction` | `GET /sealed/transactions/{id}` | Transaction UUID `id` |

Opaque cursors are passed through unchanged; pagination behavior follows the Lunidex API.

### Write tools

| Tool | API route | Inputs |
| --- | --- | --- |
| `set_card_quantity` | `PUT /cards/{cardId}` | `cardId`, `language`, `variant` (`unspecified`, `normal`, `reverse`, `holo`), absolute `quantity` (0–10,000) |
| `create_sealed_transaction` | `POST /sealed/transactions` | Transaction draft, current account `expectedRevision`, and `idempotencyKey` (8–200 characters) |
| `update_sealed_transaction` | `PATCH /sealed/transactions/{id}` | Transaction UUID `id`, current transaction `revision`, current account `expectedRevision`, and replacement transaction draft |
| `void_sealed_transaction` | `POST /sealed/transactions/{id}/void` | Transaction UUID `id`, current transaction `revision`, and current account `expectedRevision` |

Transaction drafts include `kind` (`buy`, `sell`, `exchange`), `cardmarketProductId`, `language`, `date`, and `quantity`. Optional fields include unit price, fees, shipping, discounts, payment fees, other costs, exchange details, and allocation method (`fifo` or `manual`). Amounts are in cents. The server validates tool inputs; Lunidex applies its own permission checks, business rules, and rate limits.

`set_card_quantity` sets an absolute quantity; `0` removes that holding. Reuse the same idempotency key when retrying the same transaction creation. Update and void calls use revisions so the API can reject stale changes. The server does not expose a delete operation, and it does not automatically retry writes.

## OpenAPI resource

The `lunidex://api/openapi` resource returns the public OpenAPI 3.1 document from `GET /openapi.json`. It does not require an API key and does not send one with the request. It uses `LUNIDEX_API_BASE_URL` when configured.

## Development

```sh
npm start         # Run the TypeScript server directly
npm test          # Run tests, including a stdio smoke test with a local mock API
npm run typecheck
npm run lint
npm run build
```

The tests use local mocks and do not call the production Lunidex API or require a real account key.
