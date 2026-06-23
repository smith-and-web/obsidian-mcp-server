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
└── types/
    └── index.ts            # Shared types

tests/                       # Vitest specs (*.test.js) — mirror the src module under test
examples/test-vault/         # Sample vault used by examples and manual testing
```

> Note: source is `.ts`; the existing test files are `.test.js`. Match that convention when adding tests.

## Adding a new tool (the common change)

1. Add the tool's schema to `src/tools/definitions.ts` (`name`, `description`, `inputSchema`).
2. Implement the operation as a method on `VaultManager` in `src/vault/VaultManager.ts`.
3. Wire it in the dispatch `switch` in `src/tools/handlers.ts` (`case 'tool-name': ...`).
4. Add a Vitest spec under `tests/`.
5. Update `README.md` (Features/tool list) and `CHANGELOG.md`.

## Code style

- `async`/`await` for all async work; no raw `.then()` chains.
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
- `COMPACT_RESPONSES` — `"true"` enables token-optimized compact response keys.
- `NODE_ENV` — `development` | `production`.

See `env.example` for the full list.
