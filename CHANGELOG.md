# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.11.1] - 2026-10-24

### Fixed
- Maintenance `merge-duplicate` no longer proposes a pair where either note links to the other (a hub and its child notes) or where both notes are `type: plan`. Similarity thresholds are unchanged.
- Maintenance `link-mention` checks the source note's prose only: frontmatter, the first H1, fenced and inline code, wikilinks, embeds and markdown links are excluded, and the target's title or alias must appear as a whole word, case-insensitively, with hyphens counted as word characters (so `kindling` does not match `kindling-splash`). The worker reads the note from `VAULT_PATH`; the chunk index still narrows candidates.
- Notes under `Journal/` get no `link-mention` or `link-related` findings, as source or target.

### Changed
- The `nearDuplicatePairs` and `missingLinkPairs` hygiene metrics use the same filters, so they can drop from 1.11.0 values without any vault change.

## [1.11.0] - 2026-10-23

### Added
- Report-only maintenance worker (`node dist/maintain.js`, or `npm run maintain`): seven deterministic checks, weekly draft reports with checkbox decisions, hygiene trends and acceptance counts per change class.
- `doc_history` baselines and summary/body cosine history written transactionally by the indexer; additive `sql/003_maintenance.sql` schema.
- `recommend-notes` with positive and negative examples and two strategies, and `maintenance-decision` for explicit decisions in chat. Both are available with semantic search, independently of learn logging.

### Changed
- Search ranking is unchanged. Maintenance writes only its own report file and never edits existing notes. Accepting a finding records the decision; changes are applied by hand.

## [1.10.2] - 2026-10-23

### Fixed
- Legacy SSE streams (`GET /sse`) no longer go idle. The server writes an SSE comment (`: ping`) every `SSE_KEEPALIVE_SECONDS` (default 30; `0` disables). Claude Code dropped a stream that had carried no bytes for about six minutes and reconnected without sending `initialize` again, so later calls in a long session had no client name and no session row. Every SSE parser ignores comment lines, so clients need no change.

## [1.10.1] - 2026-10-23

### Fixed
- Learn-log sessions for `POST /sse` clients (Streamable HTTP, including mcp-remote). `initialize` now returns an `Mcp-Session-Id` header and records the session with `transport = 'post'` and the client's name; later requests that send the header are logged with that session id and client name, looked up from the database after a restart. Before this, every `POST /sse` search and read was logged with no session and client name `post`, so session-based report metrics were empty.
- `DELETE /sse` with an `Mcp-Session-Id` header closes the session and answers `204`.

### Changed
- `sql/002_learning.sql` allows `transport IN ('sse', 'post')` and replaces the 1.10.0 constraint on existing databases once, by name.
- mcp-remote's connection test (`mcp-remote-fallback-test`) gets a session header but no session row.
- `POST /sse` requests without the header and the legacy `GET /sse` + `/message` path are unchanged.

## [1.10.0] - 2026-10-23

### Added
- An optional learn log for searches, note reads, explicit feedback and SSE session lifecycle, off by default. Configure `LEARN_LOG`, `LEARN_REDACT_PATTERNS_FILE` and `LEARN_RETENTION_DAYS` (30 days by default).
- A `requestId` on logged search results and an optional `requestId` argument on the three read tools to link reads to searches.
- The `search-feedback` tool and the read-only `learn-report` CLI.
- `sql/002_learning.sql`, with pattern redaction before storage and daily query-text, embedding and feedback-note retention in the indexer loop.

### Changed
- Search ranking is unchanged. Learn logs are never read back into search.

## [1.9.1] - 2026-10-23

### Fixed
- `search()` and `upsertDocument()` rethrow the original error when `ROLLBACK` also fails, instead of masking it with the `ROLLBACK` error.
- A client whose `ROLLBACK` failed is destroyed rather than returned to the pool, so a dead connection cannot fail later queries.

## [1.9.0] - 2026-10-22

### Added
- Configurable search ranking: `SEARCH_FUSION`, `SEARCH_RRF_K`, `SEARCH_W_VECTOR`, `SEARCH_W_TEXT` and `SEARCH_PER_NOTE_CAP`.
- The read-only `brain-eval` CLI for golden-query evaluation, a fixed ranking grid, regression gates and deterministic winner selection.
- The `documents_status` index for frontmatter status filters.

### Changed
- Fusion runs in TypeScript. The defaults reproduce v1.8.0 scores exactly; exact ties are now ordered by chunk position, then id.
- Searches set `hnsw.iterative_scan = strict_order`, and `hnsw.ef_search = 100` when filtered. Requires pgvector 0.8.0 or newer for iterative scans.
- Under `SEARCH_FUSION=dbsf`, `score` ranges from 0 to `wVector + wText` instead of the RRF scale.

## [1.8.0] - 2026-10-19

### Added
- **Server instructions.** `MCP_INSTRUCTIONS_FILE` (or inline `MCP_INSTRUCTIONS`) sets the `instructions` field of the `initialize` result, on both the SSE transport and the direct `POST /sse` path. Clients such as Claude Code, Claude Desktop and Codex pass it to the model, so one file describes the vault and when to use it for every harness. Unset = no change. A configured file that cannot be read fails startup.

## [1.7.1] - 2026-10-14

### Fixed
- **`update-frontmatter`, `add-tags` and `remove-tags` no longer corrupt frontmatter.** They parsed the note to an object and dumped it again, which turned a date-looking `title: 2026-10-14` into a UTC timestamp, shifted `created`/`updated` to UTC, restyled flow lists into block lists, folded long strings, and dropped comments and empty lists. They now edit the YAML in place (using `yaml`): every field that is not touched keeps its exact text, new strings that a YAML 1.1 reader would misread (date-only values, `yes`/`no`, numbers) are quoted, line endings are preserved, and frontmatter that is not valid YAML is refused with a clear error instead of being overwritten.
- **Section tools failed on headings containing regex characters.** `read-section`, `append-to-section` and `replace-section` built a regular expression from the heading text, so `## Status (2026-10-14)` (or any heading with `( ) [ ] + * ? . | $`) was "not found". Headings are now matched literally.

### Added
- Dependency: `yaml` (round-trip YAML editing).

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
