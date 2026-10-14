# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.0] - 2026-10-14

### Added
- **Invalid frontmatter is now reported.** A note whose frontmatter is not valid YAML (typically an unquoted `key: value: more`) is still indexed by its body, but the indexer logs `WARN invalid frontmatter in <path>: <error>` when it indexes it and again at every start, each pass line shows `invalid_frontmatter=<count>`, `index-status` returns `invalidFrontmatter: { count, notes }`, and `reindex-note` returns a `warning`. Previously the metadata vanished silently and `errors` stayed 0. The index gains a nullable `documents.frontmatter_error` column, added automatically (`ADD COLUMN IF NOT EXISTS`) on the next start.

### Fixed
- `parseFrontmatter` could silently succeed with empty data the second time it saw the same invalid content, because gray-matter caches by content before parsing. It now bypasses that cache (which also stops it growing without bound).
- Test files that share the test database now run one at a time, so they cannot race while creating the schema.

### Documentation
- README: state that the server is HTTP+SSE only and listens on all interfaces; remove the "direct npx" Claude Desktop/Cursor configs, which cannot work without a stdio mode; use loopback port publishing and `docker compose` in the examples; add Claude Code and Tailscale serve setup, auth/connection troubleshooting, the `npx` indexer command, `EMBED_PROVIDER`/`EMBED_DIM`, and a note on vault path confinement; fix the duplicated auth text and the TypeScript badge.

## [1.6.0] - 2026-10-14

### Added
- `REQUIRE_TAILSCALE_LOGIN`: optional second factor. When set, requests must carry a matching `Tailscale-User-Login` header (added by `tailscale serve` for tailnet users), otherwise `403`. Enforced even when `API_KEY` is unset.

### Changed
- **Breaking:** the `?api_key=` query-parameter authentication is removed. It put the secret in access logs and client history. Use `Authorization: Bearer <key>`.
- API key comparison is now constant-time.

### Fixed (also shipped as the unpublished 1.5.1 tag)
- Ollama embedder: an unset `EMBED_BATCH_SIZE` reached the embedder as an explicit `undefined`, which overrode the default batch size and made every embed call return nothing (indexer error `chunks and embeddings length mismatch`, `semantic-search` error `expected array or sparse vector`). Defaults now apply to `undefined` options.

## [1.5.0] - 2026-10-13

### Added
- **Semantic search (optional)**: hybrid vector + full-text retrieval over the vault, backed by Postgres + pgvector and local Ollama embeddings. Enabled only when `DATABASE_URL` is set; with it unset, the tool list and behaviour are identical to 1.4.x.
- New tools: `semantic-search` (filters: `directory`, `tags`, frontmatter `type`/`status`; `mode: hybrid|vector|text`), `similar-notes`, `index-status`, `reindex-note`.
- **Indexer** (`dist/indexer.js`, bin `obsidian-mcp-indexer`): polls the vault, chunks notes by heading (H1–H3, ~800-token windows with overlap, breadcrumb prefix, title+summary head chunk), embeds changed content, and keeps `documents`/`chunks`/`links` tables current. `--once`, `--reindex`, `--verbose`. Clean stop on SIGTERM.
- `sql/001_schema.sql`, applied automatically at start with the model's dimension; the model and dimension are recorded in `meta` and a mismatch refuses to run.
- `links` table resolves wikilinks the way Obsidian's "shortest path" setting does: exact vault path first, else a basename that is unique in the vault; ambiguous basenames stay unresolved (`target_document_id IS NULL`) and are re-evaluated whenever a note with that basename is indexed.
- Exclusion rules shared by the indexer and `reindex-note`: `.obsidian/`, `.trash/`, `.git/`, `#recycle/`, `@eaDir/`, `@tmp/`, `._*`, dotfiles, non-`.md`, `.noindex` directories, `index: false` frontmatter.
- Env: `DATABASE_URL`, `OLLAMA_URL`, `EMBED_MODEL`, `INDEX_COLLECTION`, `INDEX_INTERVAL_SECONDS`, `INDEX_VERBOSE`, `EMBED_BATCH_SIZE`; `EMBED_PROVIDER=fake` for tests.
- `/health` reports `semanticSearch: enabled|disabled`.
- Dependencies: `pg`, `pgvector`.

### Changed
- `createMCPServer(vaultManager, search?)` and `executeToolCall(name, args, vaultManager, search?)` take an optional `SearchService`; `getToolDefinitions({ semantic })` returns the tool list for an instance. `toolDefinitions` is unchanged and still exported.
- Dockerfile copies `sql/`; the same image runs the server (default) or the indexer (`command: ["node", "dist/indexer.js"]`).

## [1.4.1] - 2026-10-13

### Security
- **Path containment**: every vault operation now resolves its path through a single `_resolve()` that rejects `..` traversal, absolute paths outside the vault and NUL bytes. Previously `path.join(VAULT_PATH, input)` was used unchecked, so a client holding the API key could read and write files outside the vault (for example `read-note ../../etc/hostname`). A leading `/` is still accepted and treated as vault-relative. The check is lexical; symlinks inside the vault that point outside it are not followed-checked.

## [1.4.0] - 2026-06-22

### Changed
- **TypeScript Conversion**: Entire codebase converted to TypeScript for improved type safety
- Added TypeScript build step to CI pipeline
- Updated ESLint configuration for TypeScript support
- **BREAKING**: Raised minimum Node.js version to >=20.19.0 (dropped Node 18, which reached end-of-life in April 2025). Required by the vitest 4.x toolchain, which no longer supports Node 18.

### Infrastructure
- Added `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`
- Updated Dockerfile to build TypeScript before running
- Added `npm run build` script and `prepublishOnly` hook
- Bumped dev dependencies via Dependabot (`@modelcontextprotocol/sdk` 1.25.3→1.29.0, vitest 4.0.18→4.1.9, and others)
- Dropped Node 18 from the CI test matrix (now tests Node 20 and 22)

## [1.1.0] - 2025-01-09

### Added
- `write-note` - Unified write tool with overwrite/append/prepend modes
- `get-notes-info` - Get file metadata without reading content (size, dates, frontmatter presence)
- **Token optimization** - Optional compact response mode (`COMPACT_RESPONSES=true`) reduces response size by 40-60%
- **Safe delete** - `delete-note` now requires `confirm` parameter matching filename to prevent accidents

### Changed
- **BREAKING**: `delete-note` now requires `confirm` parameter
- Replaced custom YAML parser with `gray-matter` library for more robust frontmatter handling
- Updated tool count from 29 to 31

### Infrastructure
- Added `COMPACT_RESPONSES` environment variable
- Added ESLint and Prettier for code formatting
- Added Vitest unit tests (25 tests)
- Added GitHub Actions CI pipeline
- Added GitHub issue and PR templates
- Added Dependabot configuration

## [1.0.0] - 2025-01-09

### Added

#### Note Operations
- `read-note` - Read note contents with optional `frontmatterOnly` for efficiency
- `read-multiple-notes` - Batch read multiple notes in a single request
- `create-note` - Create new notes
- `edit-note` - Edit existing notes
- `delete-note` - Delete notes
- `move-note` - Move/rename notes
- `duplicate-note` - Copy notes to new locations

#### Directory Operations
- `list-vault` - List files and directories in vault
- `create-directory` - Create new directories
- `delete-directory` - Delete directories (with recursive option)
- `rename-directory` - Rename/move directories

#### Frontmatter Operations
- `get-frontmatter` - Get YAML frontmatter as structured JSON
- `update-frontmatter` - Update/merge frontmatter fields

#### Tag Operations
- `add-tags` - Add tags to frontmatter or inline
- `remove-tags` - Remove tags from notes
- `list-tags` - List all tags with usage counts
- `find-notes-by-tag` - Find notes containing a specific tag
- `search-missing-tag` - Find notes missing a specific tag
- `audit-tags` - Audit folder for required tags compliance

#### Search Operations
- `search-vault` - Full-text search with line numbers and context
- `find-replace` - Bulk find and replace with regex support

#### Link Operations
- `get-backlinks` - Find notes linking to a specific note
- `find-broken-links` - Detect unresolved wiki-links

#### Section Operations
- `read-section` - Read content under a specific heading
- `append-to-section` - Append content to a section
- `replace-section` - Replace section content
- `append-to-file` - Append to end of file
- `insert-at-marker` - Insert content at a text marker
- `list-headings` - List all headings in a note

### Infrastructure
- Docker support with docker-compose
- SSE transport for MCP protocol
- Health check endpoint
- CORS middleware
- Modular code architecture

## [0.1.0] - 2024-12-29

### Added
- Initial release
- Basic note CRUD operations
- Simple search functionality
- SSE server implementation
