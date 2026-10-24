# Obsidian MCP Server — Project Conventions

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI assistants
interact with an Obsidian vault (notes, frontmatter, tags, search, links) over an SSE transport.

## Stack

- **Language:** TypeScript 5.x, ES modules (`"type": "module"`). Use `import`/`export`, never `require`.
- **Runtime:** Node.js >= 20.19. Build target is `dist/` via `tsc`.
- **HTTP:** Express 5.
- **MCP:** `@modelcontextprotocol/sdk`.
- **Frontmatter:** `gray-matter`.
- **Tests:** Vitest. **Lint:** ESLint + Prettier (Prettier rules are enforced *through* ESLint).

## Commands

| Task | Command |
|------|---------|
| Install | `npm install` |
| Build | `npm run build` (tsc → `dist/`) |
| Dev server (watch) | `npm run dev` |
| Test | `npm test` (`vitest run`) |
| Test (watch) | `npm run test:watch` |
| Lint | `npm run lint` (`eslint src/`) |
| Auto-fix lint/format | `npm run lint:fix` then `npm run format` |
| Format check | `npm run format:check` |

Always run `npm test` and `npm run lint` before opening a PR — both must pass clean.
Prettier violations surface as ESLint errors, so `npm run lint:fix` resolves most formatting issues.

## Layout

```
src/
├── index.ts                # Express server entrypoint & wiring
├── server/
│   ├── mcp.ts              # MCP protocol handling (SSE connection, message routing)
│   └── middleware.ts       # Express middleware (auth, etc.)
├── tools/
│   ├── definitions.ts      # Tool schemas (JSON Schema inputSchema)
│   ├── handlers.ts         # Tool execution → dispatches to VaultManager
│   └── index.ts            # Re-exports
├── vault/
│   ├── VaultManager.ts     # Core vault operations (the real logic lives here)
│   └── frontmatter.ts      # YAML frontmatter utilities (gray-matter)
├── index/                  # Optional semantic search (pgvector + Ollama); gated on DATABASE_URL
│   ├── config.ts           # Env → IndexConfig (null when DATABASE_URL unset)
│   ├── exclusions.ts       # Paths the indexer never reads (tested)
│   ├── chunker.ts          # Heading-aware chunking (tested, pure)
│   ├── embedder.ts         # Ollama client + FakeEmbedder for tests
│   ├── ranking.ts          # Configurable fusion, weights and per-note cap
│   ├── store.ts            # All SQL: schema, upserts, hybrid search
│   ├── scanner.ts          # Vault walk, change detection, one reconcile pass
│   └── SearchService.ts    # What the tools call
├── maintain/               # Maintenance configuration, decisions, reports and worker
├── maintain.ts             # Report-only maintenance CLI
├── learn/                  # Learn log, redaction, configuration and report assembly
├── learn-report.ts         # Read-only learn-report CLI entrypoint
├── eval/                   # Golden schema, metrics and ranking grid
├── eval.ts                 # Read-only brain-eval CLI entrypoint
├── indexer.ts              # Indexer entrypoint (same image, second container)
└── types/
    └── index.ts            # Shared types

sql/001_schema.sql           # Index DDL; __DIM__ substituted at start
sql/002_learning.sql         # Learn log DDL; applied even when logging is disabled
sql/003_maintenance.sql      # Additive maintenance schema; history and decisions
tests/                       # Vitest specs (*.test.js) — mirror the src module under test
examples/test-vault/         # Sample vault used by examples and manual testing
```

Semantic tools register only when a `SearchService` is passed to `createMCPServer`. The pure
modules (`chunker`, `exclusions`) have tests that need nothing; `tests/search.test.js` runs only
with `TEST_DATABASE_URL` pointing at a Postgres with pgvector (`EMBED_PROVIDER=fake`, no model needed).

> Note: source is `.ts`; the existing test files are `.test.js`. Match that convention when adding tests.

## Adding a new tool (the common change)

1. Add the tool's schema to `src/tools/definitions.ts` (`name`, `description`, `inputSchema`).
2. Implement the operation as a method on `VaultManager` in `src/vault/VaultManager.ts`.
3. Wire it in the dispatch `switch` in `src/tools/handlers.ts` (`case 'tool-name': ...`).
4. Add a Vitest spec under `tests/`.
5. Update `README.md` (Features/tool list) and `CHANGELOG.md`.

## Code style

- `async`/`await` for all async work; no raw `.then()` chains. The only exception is `.catch(...)` on fire-and-forget promises in `src/learn/log.ts`.
- Descriptive names; keep functions focused and single-purpose.
- JSDoc on public `VaultManager` methods.
- Validate and normalize vault-relative paths; never allow traversal outside `VAULT_PATH`.

## Commits & PRs

- Conventional Commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Update `CHANGELOG.md` when behavior changes.
- Update `README.md` docs when tool surface or configuration changes.
- Default branch is `main`; branch per change, open a PR against `main`.

## Configuration (runtime env)

- `VAULT_PATH` — absolute path to the Obsidian vault (required).
- `PORT` — HTTP port (default `3000`).
- `API_KEY` — bearer token for `/sse` and `/message` auth (optional; auth disabled if unset).
- `REQUIRE_TAILSCALE_LOGIN` — optional; when set, requests must carry a matching `Tailscale-User-Login` header (added by `tailscale serve`). Enforced even if `API_KEY` is unset.
- `COMPACT_RESPONSES` — `"true"` enables token-optimized compact response keys.
- `NODE_ENV` — `development` | `production`.
- `DATABASE_URL` — Postgres+pgvector; enables semantic search. `OLLAMA_URL`, `EMBED_MODEL`, `INDEX_COLLECTION`, `INDEX_INTERVAL_SECONDS` go with it.

See `env.example` for the full list.
