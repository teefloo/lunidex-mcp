# Graph Report - lunidex-mcp  (2026-09-28)

## Corpus Check
- Corpus is ~5,459 words - fits in a single context window. You may not need a graph.

## Summary
- 145 nodes · 225 edges · 10 communities
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- MCP Server and Tools
- Package Metadata and Dependencies
- API Configuration and Parsing
- Server Tools and Resources
- TypeScript Compiler Settings
- API Client and Tool Tests
- Build TypeScript Configuration
- Development Dependencies
- Build and Test Scripts
- API Key Security Guidance

## God Nodes (most connected - your core abstractions)
1. `Lunidex MCP Server` - 22 edges
2. `Lunidex API` - 16 edges
3. `LunidexApiClient` - 10 edges
4. `registerLunidexTools()` - 10 edges
5. `compilerOptions` - 10 edges
6. `LunidexApiError` - 9 edges
7. `fetchPublicOpenApiDocument()` - 8 edges
8. `scripts` - 7 edges
9. `redactCredential()` - 6 edges
10. `getPublicApiError()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `connectInMemory()` --calls--> `registerLunidexTools()`  [EXTRACTED]
  test/tools.test.ts → src/tools.ts
- `registerLunidexResources()` --calls--> `fetchPublicOpenApiDocument()`  [EXTRACTED]
  src/resources.ts → src/api.ts
- `createLunidexServer()` --calls--> `registerLunidexTools()`  [EXTRACTED]
  src/index.ts → src/tools.ts
- `registerLunidexResources()` --calls--> `redactCredential()`  [EXTRACTED]
  src/resources.ts → src/api.ts
- `jsonResult()` --calls--> `redactCredential()`  [EXTRACTED]
  src/tools.ts → src/api.ts

## Import Cycles
- None detected.

## Communities (10 total, 0 thin omitted)

### Community 0 - "MCP Server and Tools"
Cohesion: 0.12
Nodes (26): API Error Sanitization, create_sealed_transaction (POST /sealed/transactions), Transaction Creation Idempotency Key, get_card (GET /cards/{cardId}), get_me (GET /me), get_sealed_position (GET /sealed/positions/{productId}), get_sealed_transaction (GET /sealed/transactions/{id}), get_summary (GET /summary) (+18 more)

### Community 1 - "Package Metadata and Dependencies"
Cohesion: 0.09
Nodes (18): dependencies, @modelcontextprotocol/server, zod, description, engines, node, name, private (+10 more)

### Community 2 - "API Configuration and Parsing"
Cohesion: 0.19
Nodes (16): ApiErrorBody, assertDataEnvelope(), FetchFunction, fetchPublicOpenApiDocument(), getPublicApiError(), isRecord(), LunidexApiError, parseResponseText() (+8 more)

### Community 3 - "Server Tools and Resources"
Cohesion: 0.14
Nodes (18): @modelcontextprotocol/server, Query, redactCredential(), safeApiMessage(), toPublicError(), createLunidexServer(), registerLunidexResources(), cardIdSchema (+10 more)

### Community 4 - "TypeScript Compiler Settings"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit, skipLibCheck, strict (+4 more)

### Community 5 - "API Client and Tool Tests"
Cohesion: 0.30
Nodes (4): LunidexApiClient, readTool(), registerLunidexTools(), connectInMemory()

### Community 6 - "Build TypeScript Configuration"
Cohesion: 0.18
Nodes (10): ./tsconfig.json, compilerOptions, declaration, noEmit, outDir, rootDir, sourceMap, exclude (+2 more)

### Community 7 - "Development Dependencies"
Cohesion: 0.29
Nodes (7): devDependencies, eslint, @modelcontextprotocol/client, tsx, @types/node, typescript, typescript-eslint

### Community 8 - "Build and Test Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, start, test, typecheck

### Community 9 - "API Key Security Guidance"
Cohesion: 0.50
Nodes (4): Read-Only API Key, read_write Permission, Secure MCP Host Configuration, Server-Side Lunidex API Key

## Knowledge Gaps
- **69 isolated node(s):** `name`, `version`, `private`, `description`, `type` (+64 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 76 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@modelcontextprotocol/server` connect `Server Tools and Resources` to `Package Metadata and Dependencies`, `API Client and Tool Tests`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Why does `@modelcontextprotocol/client` connect `Package Metadata and Dependencies` to `API Client and Tool Tests`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `scripts` connect `Build and Test Scripts` to `Package Metadata and Dependencies`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `registerLunidexTools()` (e.g. with `.patch()` and `.post()`) actually correct?**
  _`registerLunidexTools()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _69 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `MCP Server and Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.12307692307692308 - nodes in this community are weakly interconnected._
- **Should `Package Metadata and Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._