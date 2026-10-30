# Obsidian MCP Server

[![CI](https://github.com/smith-and-web/obsidian-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/smith-and-web/obsidian-mcp-server/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@smith-and-web/obsidian-mcp-server)](https://www.npmjs.com/package/@smith-and-web/obsidian-mcp-server)
[![Docker](https://img.shields.io/badge/ghcr.io-latest-blue)](https://ghcr.io/smith-and-web/obsidian-mcp-server)
[![License](https://img.shields.io/github/license/smith-and-web/obsidian-mcp-server)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue)](https://www.typescriptlang.org/)
[![Sponsor](https://img.shields.io/github/sponsors/smith-and-web?label=Sponsor&logo=github)](https://github.com/sponsors/smith-and-web)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that enables AI assistants like Claude to interact with your Obsidian vault. Access your notes, create content, manage tags, and search your knowledge base through natural conversation.

## Features

### Note Management
- **CRUD Operations**: Create, read, update, and delete notes (with safety confirmation)
- **Write Modes**: Overwrite, append, or prepend content
- **Batch Reading**: Read multiple notes in a single request
- **File Info**: Get metadata without reading content (efficient for large vaults)
- **Move/Duplicate**: Reorganize your vault structure
- **Section Operations**: Read, append, or replace specific sections by heading

### Frontmatter & Tags
- **Frontmatter Parsing**: Get/set YAML frontmatter as structured JSON (powered by gray-matter)
- **Tag Management**: Add/remove tags (frontmatter or inline)
- **Tag Auditing**: Find notes missing required tags
- **Tag Search**: List all tags with usage counts

### Search & Links
- **Full-Text Search**: Search content and filenames with context
- **Backlinks**: Find all notes linking to a specific note
- **Broken Links**: Detect wiki-links that don't resolve
- **Find & Replace**: Bulk text replacement with regex support

### Semantic Search (optional)
- **Search by meaning**: hybrid vector + full-text retrieval over heading-aware chunks, backed by Postgres + [pgvector](https://github.com/pgvector/pgvector) and local embeddings from [Ollama](https://ollama.com)
- **Similar notes**: nearest notes to a given note, by whole-note embedding
- **Incremental indexer**: a second process from the same image that polls the vault and re-embeds only what changed; works over NFS/SMB where inotify does not
- **Nothing leaves your network**: embeddings are computed locally; the feature is off entirely unless `DATABASE_URL` is set

### Directory Operations
- **Create/Delete/Rename**: Full directory management
- **List Contents**: Browse vault structure

### Performance
- **Token Optimization**: Optional compact response mode (40-60% smaller responses)
- **Efficient Scanning**: Get file info without reading content
- **SSE Transport**: Remote access without local installation

## Quick Start

**How clients connect:** the server speaks MCP over **HTTP + SSE only** (there is no stdio mode). You start it (npx, Docker or from source), then point a client at `http://HOST:PORT/sse`. Clients that only support stdio servers connect through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), as shown below. It listens on **all network interfaces** on `PORT`, so set an `API_KEY` (see [Authentication](#authentication)) or keep it on loopback (for example `-p 127.0.0.1:3001:3000` in Docker) unless you want the whole network to have read/write access to your vault.

### npx (Quickest)

Requires Node.js 20.19 or newer. This starts the server in the foreground (default port 3000):

```bash
VAULT_PATH=/path/to/your/vault npx @smith-and-web/obsidian-mcp-server
```

With options:

```bash
VAULT_PATH=/path/to/vault PORT=3001 COMPACT_RESPONSES=true npx @smith-and-web/obsidian-mcp-server
```

### Docker (Recommended for Production)

**Using the pre-built image from GitHub Container Registry:**

```bash
docker run -d \
  --name obsidian-mcp \
  -v /path/to/your/vault:/vault:rw \
  -p 127.0.0.1:3001:3000 \
  -e VAULT_PATH=/vault \
  ghcr.io/smith-and-web/obsidian-mcp-server:latest
```

`latest` follows the newest release; pin a version tag (for example `:1.6.0`) for production. Drop `127.0.0.1:` only if you set `API_KEY` and want other machines to connect.

**Or with Docker Compose:**

1. **Create a `docker-compose.yml`:**
   ```yaml
   services:
     obsidian-mcp:
       image: ghcr.io/smith-and-web/obsidian-mcp-server:latest
       container_name: obsidian-mcp
       restart: unless-stopped
       volumes:
         - /path/to/your/vault:/vault:rw
       ports:
         - "127.0.0.1:3001:3000"
       environment:
         - VAULT_PATH=/vault
   ```

2. **Start the server**
   ```bash
   docker compose up -d
   ```

3. **Verify it's running**
   ```bash
   curl http://localhost:3001/health
   ```

### Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set environment variables**
   ```bash
   export VAULT_PATH=/path/to/your/vault
   export PORT=3000
   ```

3. **Start the server**
   ```bash
   npm start
   # Or with auto-reload:
   npm run dev
   ```

## AI Assistant Configuration

### Claude Desktop

Add to your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Option 1: Local server (via mcp-remote)**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3001/sse"]
    }
  }
}
```

**Option 2: Remote server with HTTPS**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-domain.com/sse"]
    }
  }
}
```

The server must already be running (see Quick Start). Claude Desktop launches `mcp-remote`, which bridges its stdio to the server's SSE endpoint; Claude Desktop cannot launch this server directly, because the server does not speak stdio.

### Cursor

Add to your Cursor MCP settings (Settings → MCP):

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3001/sse"]
    }
  }
}
```

### Other MCP Clients

**Claude Code** supports SSE servers directly:

```bash
claude mcp add --transport sse obsidian http://localhost:3001/sse
# with an API key:
claude mcp add --transport sse obsidian https://your-host/sse --header "Authorization: Bearer your-secret-key"
```

Any other MCP-compatible client can connect using `mcp-remote`:

```bash
npx mcp-remote http://localhost:3001/sse
```

Or connect directly to the SSE endpoint at `http://localhost:3001/sse` if the client supports SSE servers natively.

## Available Tools

### Note Operations
| Tool | Description |
|------|-------------|
| `read-note` | Read note contents (supports `frontmatterOnly` for efficiency) |
| `read-multiple-notes` | Batch read multiple notes |
| `create-note` | Create a new note |
| `edit-note` | Replace note contents |
| `write-note` | Write with modes: overwrite, append, or prepend |
| `delete-note` | Delete a note (requires confirmation) |
| `move-note` | Move/rename a note |
| `duplicate-note` | Copy a note to a new location |
| `get-notes-info` | Get file metadata without reading content |

### Directory Operations
| Tool | Description |
|------|-------------|
| `list-vault` | List files and directories |
| `create-directory` | Create a new directory |
| `delete-directory` | Delete a directory (with recursive option) |
| `rename-directory` | Rename/move a directory |

### Frontmatter & Tags
| Tool | Description |
|------|-------------|
| `get-frontmatter` | Get YAML frontmatter as JSON |
| `update-frontmatter` | Update frontmatter fields in place (untouched fields keep their exact text; invalid YAML is refused) |
| `add-tags` | Add tags to frontmatter or inline |
| `remove-tags` | Remove tags from note |
| `list-tags` | List all tags with counts |
| `find-notes-by-tag` | Find notes with a specific tag |
| `search-missing-tag` | Find notes missing a tag |
| `audit-tags` | Audit folder for required tags |

### Search & Links
| Tool | Description |
|------|-------------|
| `search-vault` | Full-text search with context |
| `get-backlinks` | Find notes linking to a note |
| `find-broken-links` | Find unresolved wiki-links |
| `find-replace` | Bulk find and replace |

### Semantic Search (only when `DATABASE_URL` is set)
| Tool | Description |
|------|-------------|
| `semantic-search` | Hybrid vector + full-text search; filters by `directory`, `tags`, frontmatter `type` and `status`; `mode: hybrid|vector|text` |
| `similar-notes` | Notes nearest to a note by centroid embedding |
| `index-status` | Model, counts, last indexer run and lag |
| `reindex-note` | Re-index one note immediately |
| `search-feedback` | Record a search rating and used or expected paths; available only with the learn log enabled |
| `recommend-notes` | Find notes similar to positive examples and unlike negative examples, using `best_score` or `average_vector`; requires semantic search |
| `maintenance-decision` | Record an explicit accept or reject decision on a maintenance finding; requires semantic search |

See [Semantic search](#semantic-search) for setup.

### Section Operations
| Tool | Description |
|------|-------------|
| `read-section` | Read content under a heading |
| `append-to-section` | Append to a section |
| `replace-section` | Replace section content |
| `append-to-file` | Append to end of file |
| `insert-at-marker` | Insert at a text marker |
| `list-headings` | List all headings in a note |

## Architecture

```
┌─────────────────┐     HTTPS/SSE      ┌──────────────────┐
│  Claude Desktop │ ◄────────────────► │   MCP Server     │
└─────────────────┘                    │   (Express.js)   │
                                       └────────┬─────────┘
                                                │
                                       ┌────────▼─────────┐
                                       │   VaultManager   │
                                       │   (File System)  │
                                       └────────┬─────────┘
                                                │
                                       ┌────────▼─────────┐
                                       │  Obsidian Vault  │
                                       │   (Markdown)     │
                                       └──────────────────┘
```

## Project Structure

```
obsidian-mcp-server/
├── src/
│   ├── index.ts              # Express server entry point
│   ├── vault/
│   │   ├── VaultManager.ts   # Core vault operations
│   │   └── frontmatter.ts    # YAML parsing utilities
│   ├── tools/
│   │   ├── definitions.ts    # MCP tool schemas
│   │   ├── handlers.ts       # Tool execution logic
│   │   └── index.ts          # Tool exports
│   ├── server/
│   │   ├── mcp.ts            # MCP protocol handlers
│   │   └── middleware.ts     # Express middleware
│   ├── index/                # Optional semantic search
│   │   ├── config.ts         # DATABASE_URL / OLLAMA_URL / EMBED_MODEL
│   │   ├── exclusions.ts     # What the indexer never reads
│   │   ├── chunker.ts        # Heading-aware chunking
│   │   ├── embedder.ts       # Ollama client (+ a fake for tests)
│   │   ├── ranking.ts        # Fusion, weights, per-note cap and env validation
│   │   ├── store.ts          # pgvector schema, upserts, hybrid search
│   │   ├── scanner.ts        # Vault walk and change detection
│   │   └── SearchService.ts  # What the MCP tools call
│   ├── maintain/             # Report configuration, decisions, renderer and worker
│   ├── maintain.ts           # Report-only maintenance CLI
│   ├── learn/                # Learn log, redaction, configuration and reports
│   ├── learn-report.ts       # Read-only learn-report CLI
│   ├── eval/                 # Golden validation, metrics and fixed ranking grid
│   ├── eval.ts               # Read-only brain-eval CLI entry point
│   ├── indexer.ts            # Indexer entry point (second container)
│   └── types/
│       └── index.ts          # TypeScript type definitions
├── sql/001_schema.sql        # Index schema (dimension substituted at start)
├── tests/                    # Vitest unit tests
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `VAULT_PATH` | `/vault` | Path to Obsidian vault |
| `COMPACT_RESPONSES` | `false` | Enable minified response keys for 40-60% smaller responses |
| `API_KEY` | *(none)* | API key for authentication. When set, requires a Bearer token (compared in constant time) |
| `REQUIRE_TAILSCALE_LOGIN` | *(none)* | Optional. Require the `Tailscale-User-Login` header (set by `tailscale serve`) to equal this login. Only trustworthy when the server is reachable solely through `tailscale serve` on loopback |
| `SSE_KEEPALIVE_SECONDS` | `30` | Seconds between `: ping` SSE comments on `GET /sse` streams; `0` disables. Some clients drop a stream that has carried no bytes for about five minutes and reconnect without sending `initialize` again, which loses the session's client name |
| `MCP_INSTRUCTIONS_FILE` | *(none)* | Optional. Path to a text/Markdown file sent to clients as the MCP `instructions` in the `initialize` result: what this vault is and when to use it. Most clients add it to the model's context. A missing file is a startup error. Keep it short (some clients truncate around 2 KB) |
| `MCP_INSTRUCTIONS` | *(none)* | Same, inline. Ignored when `MCP_INSTRUCTIONS_FILE` is set |
| `DATABASE_URL` | *(none)* | Postgres + pgvector connection string. **Enables semantic search**; unset = feature off |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server for embeddings |
| `EMBED_MODEL` | `nomic-embed-text` | Ollama embedding model; dimension is discovered from it |
| `LEARN_LOG` | `false` | Enable the optional learn log; invalid configuration disables logging |
| `LEARN_REDACT_PATTERNS_FILE` | unset | Required readable regex file when logging is enabled |
| `LEARN_RETENTION_DAYS` | `30` | Days before query text, embeddings and feedback notes are cleared; integer 1–3650 |
| `INDEX_COLLECTION` | `default` | Name of this vault's collection in the shared database |
| `MAINTAIN_REPORT_DIR` | required unless dry | Existing writable directory for maintenance reports |
| `MAINTAIN_REPORT_VAULT_DIR` | empty | Vault-relative report directory, used in recorded report paths |
| `MAINTAIN_TZ` | `UTC` | IANA timezone for report timestamps and ISO weeks |
| `MAINTAIN_LINK_COSINE` | `0.85` | Missing-link cosine threshold, strictly between 0 and 1 |
| `MAINTAIN_DUP_COSINE` | `0.92` | Near-duplicate cosine threshold, strictly between 0 and 1 |
| `MAINTAIN_DUP_TITLE_SIM` | `0.6` | Near-duplicate title similarity, strictly between 0 and 1 |
| `MAINTAIN_HUB_DAYS` | `14` | Linked-note update gap for stale hubs, integer 1–365 |
| `MAINTAIN_SUMMARY_DROP` | `0.05` | Summary/body cosine drop threshold, strictly between 0 and 1 |
| `MAINTAIN_MAX_PER_CLASS` | `10` | New findings per class per run, integer 1–100 |
| `SEARCH_FUSION` | `rrf` | Fusion: `rrf` (weighted reciprocal rank) or `dbsf` (distribution-based score fusion) |
| `SEARCH_RRF_K` | `60` | RRF rank constant, integer 1–1000; validated but unused under DBSF |
| `SEARCH_W_VECTOR` | `1` | Vector-leg weight, finite number 0–10 |
| `SEARCH_W_TEXT` | `1` | Full-text-leg weight, finite number 0–10; both weights cannot be zero |
| `SEARCH_PER_NOTE_CAP` | `0` | Maximum chunks per note, integer 0–8; 0 means no cap |
| `SEARCH_TRAILS` | `off` | Trails ranking mode: `off`, `shadow` or `on` |
| `SEARCH_TRAILS_W` | `0.5` | Trails boost weight, finite number greater than 0 and at most 10 |
| `SEARCH_TRAILS_ANCHORS` | `3` | Number of distinct leading candidate notes used as anchors, integer 1–8 |
| `INDEX_INTERVAL_SECONDS` | `60` | Indexer only: seconds between vault scans |
| `INDEX_VERBOSE` | `false` | Indexer only: log every file indexed or removed |
| `EMBED_BATCH_SIZE` | `16` | Texts per Ollama request |
| `EMBED_PROVIDER` | `ollama` | `ollama`, or `fake` (deterministic hash embeddings for tests and smoke runs; not for real search) |
| `EMBED_DIM` | *(auto)* | Embedding dimension for the `fake` provider (default 64); ignored with Ollama, where it is discovered from the model |

## Learn log

The optional measurement layer requires semantic search and is off by default. It records the three search tools (`semantic-search`, `similar-notes`, `search-vault`), successful reads (`read-note`, `read-multiple-notes`, `read-section`), explicit feedback and session start/close with client names. Sessions are the legacy SSE stream (`GET /sse` + `/message`) and, since 1.10.1, `POST /sse` clients: `initialize` returns an `Mcp-Session-Id` header, later requests that echo it are logged under that session, and `DELETE /sse` with the header closes it. `POST /sse` requests without the header are logged with client name `post` and no session. Search ranking is unchanged; search never reads these logs.

Set `LEARN_LOG=true` and `LEARN_REDACT_PATTERNS_FILE` to a readable UTF-8 file. Blank lines and comments are ignored, whitespace is trimmed, and each other line is a JavaScript regex source compiled case-insensitively. An example file is:

```text
# comment
\bexample-term\b
```

Eight built-in patterns also detect private-key headers, access-key shapes, JWTs, hosted Git tokens, secret assignments, bearer credentials, URL token parameters and 64-character hex strings. Sensitive queries (including similar-note paths) and their embeddings are cleared before storage. Sensitive string parameters become `[redacted]`; sensitive feedback notes are cleared, sensitive feedback paths are dropped, and sensitive read paths are never logged. Site-specific patterns belong in the external file. An invalid configuration disables logging, never search, and is reported at startup.

Logged searches return an additive `requestId`. Pass it to a read's optional `requestId` argument, then call `search-feedback` with `requestId`, `rating` (`positive`, `negative`, `neutral`) and `usedPaths`. `expectedPaths` and a short `note` are optional. `source` defaults to `agent`; use `user` only for explicit human feedback. Unknown ids return `{ recorded: false, reason: 'unknown requestId' }`. Reads with unknown ids are recorded without a link.

Search, read and session writes are fire and forget: they never delay tool responses and failures are logged with `learn-log:`. Feedback is awaited. The indexer loop applies retention at most daily, excluding `--once`. After `LEARN_RETENTION_DAYS` (default 30), query text, query embeddings and feedback notes are cleared. Paths, ranks, timestamps, checked parameters, client names and feedback paths remain. `sql/002_learning.sql` creates the four learn tables even when logging is off; the embedding column is recreated after a dimension reset. Keep learn-table data out of database dumps and exclude raw database files from backups when query retention is required.

Run the read-only report against an existing database:

```bash
node dist/learn-report.js --days 30 --out /existing-directory/learn-report.json
```

`--days` defaults to 30 (range 1–365); the output directory must already exist. It uses a read-only connection, ignores ranking and logging environment settings, and outputs counts and rates without query text. Stdout lists dotted keys in report order, followed by `VOLUME GATE: pass|fail`.

The report covers the selected collection and time window. Sessions include counts by client and the median closed duration in minutes. Searches include counts by tool and redacted share. Linked semantic reads use the minimum rank of the read path: `usedAt1`, `usedAt3`, `usedAt8` are shares of linked reads, and `missRate` is the share absent from results. `linkedSearchRate` is the share of semantic searches with a linked read, and `linkedSemanticPerDay` is their daily count. Reformulation and fallback rates count session-linked semantic searches followed within 120 seconds by another semantic search or text search. Feedback coverage is the share of semantic searches with feedback; source counts and negative rates include all feedback. Zero-denominator rates and empty medians are `null`; numbers are rounded to four decimals. The volume gate passes at a rounded 30 linked semantic searches per day. Feedback from agents measures compliance; user corrections provide independent labels.

## Semantic search

Off by default. Setting `DATABASE_URL` turns it on in both the server (four extra tools) and the indexer (a second process that keeps the index current). Everything runs locally: Postgres with the pgvector extension, and Ollama for embeddings.

### How it works

- **The vault stays the source of truth.** The index is a derivative you can drop and rebuild (`--reindex`).
- **Chunking is heading-aware.** Notes split on H1–H3; sections longer than ~800 tokens split further with overlap; each chunk carries its breadcrumb (`Title › H2 › H3`). Chunk 0 is the title plus the frontmatter `summary`, so a one-line summary is the strongest signal for "which note answers this".
- **Retrieval is hybrid.** Cosine similarity over an HNSW index and Postgres full-text search run side by side and are fused with configurable weighted reciprocal rank fusion (the default) or distribution-based score fusion (DBSF), so paraphrases and exact identifiers (hostnames, ticket numbers) both work.
- **Change detection is a poll**, not a watcher, because inotify does not propagate over NFS or SMB. The indexer stats every file each interval, hashes only files whose mtime or size moved, and re-embeds only files whose content changed.
- **Exclusions are enforced by path before any read:** `.obsidian/`, `.trash/`, `.git/`, Synology `#recycle/` `@eaDir/` `@tmp/`, AppleDouble `._*`, dotfiles, non-`.md` files, any directory containing a `.noindex` file, and any note with frontmatter `index: false`.
- **Links resolve like Obsidian does.** `[[Areas/note]]` resolves by path; `[[note]]` resolves if exactly one note in the vault has that basename, and stays unresolved (recorded, `NULL` target) when two do. Deleting one of two duplicates re-resolves the other the next time it is indexed.
- **The model is a schema fact.** The embedding model and dimension are recorded in the database on first run; a different model refuses to index until `--reindex`.

### Evaluating search quality (`brain-eval`)

Build with `npm run build`, then run with the same database, collection and embedding
configuration as the index:

```bash
node dist/eval.js --golden /private/golden.json --grid --out /private/runs/grid.json
# Or evaluate one configuration alongside the baseline:
node dist/eval.js --golden /private/golden.json --config '{"wText":1.5,"perNoteCap":2}' --out /private/runs/candidate.json
# npm run eval -- <the same arguments> also works.
```

The output directory must already exist. The CLI opens the database read-only: it never
applies schema changes, reindexes or writes to the index. The embedding model and dimension
must match the stored metadata, and every expected note must already exist in the collection.
Every query is embedded once and its vector reused across configurations. The fixed grid
contains 40 configurations, starting with the v1.8.0 baseline `rrf-k60-v1-t1-cap0`.
The CLI ignores ambient `SEARCH_*` ranking settings; `--config` merges only the supplied
fields over the baseline. Invalid ranking environment settings fail server startup.

Golden files are private evaluation data, with exactly these keys:

```json
{
  "version": 1,
  "created": "2026-01-01",
  "notes": "Synthetic example only",
  "queries": [
    {
      "id": "example-1",
      "category": "exact-id",
      "query": "synthetic search phrase",
      "expected": ["Example.md"]
    }
  ]
}
```

Query ids must be unique, query strings non-empty, and expected lists non-empty with
unique `.md` paths. Categories are `exact-id`, `paraphrase`, `decision-why`, `multi-hop`,
and `recent`, reported in that order. Unknown keys are rejected. Keep golden sets and
evaluation reports outside a public code repository.

Metrics use unique note paths in result order, after requesting eight chunks:

- `mrr`: mean reciprocal rank of the first expected note, or zero for a miss.
- `recall5`: a **hit rate at 5**, meaning any expected note in the first five notes.
- `ndcg8`: binary-relevance normalised discounted cumulative gain at eight notes.
- `distinctNotes`: mean number of distinct notes returned. Metrics are also broken down
  by category, and the JSON report rounds them to four decimal places.

A candidate must improve MRR by at least 0.0300, preserve every category's hit rate,
and preserve every query whose baseline hit was within five. Comparisons round metrics
to integer ten-thousandths. Passing candidates are ordered by higher MRR, hit rate, then
NDCG; ties prefer fewer changed ranking fields, then the lexicographically smaller id.
If none passes, the baseline wins with `changed: false`. The JSON includes the golden
file's SHA-256, per-query note lists, gate reasons, and the winning environment variables;
stdout prints the ranking table, category comparison and final `WINNER` line.

Exit codes: `0` for a completed report (including no ranking change), `2` for input
problems (arguments, golden validation, model mismatch or missing expected paths), and
`1` for other runtime failures (database, embedding service or output writes).

Searches require pgvector 0.8.0 or newer: each transaction uses strict-order iterative
HNSW scans and filtered searches raise `hnsw.ef_search` to 100. Default RRF scores match
v1.8.0, with exact ties ordered by chunk position then id. DBSF scores range from zero
to the sum of the two leg weights.

### Frontmatter the index understands

```yaml
---
title: ubuntubox — NFS mount gate     # else first H1, else file name
type: area                            # filterable: semantic-search { type }
status: active                        # filterable: semantic-search { status }
tags: [infra, nas]                    # filterable: semantic-search { tags }
summary: One line that answers "what is this note about".
index: true                           # false = never indexed
---
```

**Invalid frontmatter is reported, not hidden.** A note whose `---` block is not valid YAML (the usual cause is an unquoted value containing `: `, such as `summary: Finished it: all done`; quote it: `summary: "Finished it: all done"`) is still indexed by its body, but without its metadata. The indexer logs `WARN invalid frontmatter in <path>: <YAML error>` when it indexes such a note and again at every start, each pass line carries `invalid_frontmatter=<count>`, and `index-status` returns `invalidFrontmatter: { count, notes: [{ path, error }] }` (first 20). `reindex-note` returns a `warning`. Fix the note and the flag clears on the next pass.

### Setup

1. **Database**: any Postgres 16+ with pgvector. The schema is created on first start from `sql/001_schema.sql`; nothing to run by hand. HNSW index builds need shared memory: give the Postgres container `shm_size: 1g`.
2. **Embeddings**: `ollama pull nomic-embed-text` (768-d, 8k context) or `bge-m3` (1024-d).
3. **Server**: add `DATABASE_URL`, `OLLAMA_URL`, `EMBED_MODEL` (and optionally `INDEX_COLLECTION`) to the server's environment. The `/health` endpoint reports `semanticSearch: enabled`.
4. **Indexer**: run the same image again with `command: ["node", "dist/indexer.js"]`, the same environment, and the vault mounted **read-only**. `node dist/indexer.js --once --verbose` does a single pass and exits non-zero if any file failed.

```yaml
services:
  obsidian-mcp:
    image: ghcr.io/smith-and-web/obsidian-mcp-server:latest
    environment:
      VAULT_PATH: /vault
      API_KEY: ${API_KEY}
      DATABASE_URL: postgres://brain:${DB_PASSWORD}@brain-db:5432/brain
      OLLAMA_URL: http://ollama:11434
      EMBED_MODEL: nomic-embed-text
      INDEX_COLLECTION: secondbrain
    volumes:
      - /path/to/vault:/vault:rw
    ports: ["127.0.0.1:3001:3000"]

  obsidian-indexer:
    image: ghcr.io/smith-and-web/obsidian-mcp-server:latest
    command: ["node", "dist/indexer.js"]
    environment:
      VAULT_PATH: /vault
      DATABASE_URL: postgres://brain:${DB_PASSWORD}@brain-db:5432/brain
      OLLAMA_URL: http://ollama:11434
      EMBED_MODEL: nomic-embed-text
      INDEX_COLLECTION: secondbrain
      INDEX_INTERVAL_SECONDS: "60"
    volumes:
      - /path/to/vault:/vault:ro

  brain-db:
    image: pgvector/pgvector:0.8.2-pg16
    shm_size: 1g
    environment:
      POSTGRES_DB: brain
      POSTGRES_USER: brain
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - ./brain-db:/var/lib/postgresql/data

  ollama:
    image: ollama/ollama:latest
    volumes:
      - ./ollama:/root/.ollama
```

### Indexer CLI

| Command | Does |
|---|---|
| `node dist/indexer.js` | Run forever, one pass every `INDEX_INTERVAL_SECONDS`; stops cleanly on SIGTERM |
| `node dist/indexer.js --once` | One pass; exit 1 if any file errored |
| `node dist/indexer.js --reindex` | Drop this collection and rebuild (required after changing `EMBED_MODEL`) |
| `npx -p @smith-and-web/obsidian-mcp-server obsidian-mcp-indexer` | The same indexer from the npm package (also accepts `--once`, `--reindex`, `--verbose`) |
| `--verbose` / `INDEX_VERBOSE=true` | Log every file indexed or removed |

### Security notes

- The indexer needs only read access to the vault; mount it `:ro`.
- Chunk text is stored in Postgres in clear. Treat the database as you treat the vault: same network boundary, same backup policy, and don't index material that should not share an access key with the rest of the vault (use `index: false` or a `.noindex` directory).
- Embeddings never leave the Ollama host. No external API is involved anywhere in this feature.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sse` | GET | SSE endpoint for MCP |
| `/sse` | POST | Direct MCP protocol calls |
| `/message` | POST | SSE transport messages |

## Authentication

The server supports optional API key authentication. When `API_KEY` is set, all `/sse` and `/message` endpoints require authentication. The `/health` endpoint remains public.

### Enabling Authentication

Set the `API_KEY` environment variable:

```bash
# Docker
docker run -d \
  --name obsidian-mcp \
  -v /path/to/vault:/vault:rw \
  -p 3001:3000 \
  -e VAULT_PATH=/vault \
  -e API_KEY=your-secret-key \
  ghcr.io/smith-and-web/obsidian-mcp-server:latest

# npx
API_KEY=your-secret-key VAULT_PATH=/path/to/vault npx @smith-and-web/obsidian-mcp-server
```

### Authentication Method

Clients send the key in the **Authorization header**:

```
Authorization: Bearer your-secret-key
```

The `?api_key=` query parameter was **removed in 1.6.0** (it ends up in access logs and client history). Clients that used it must switch to the header, for example `mcp-remote` with `--header "Authorization: Bearer your-secret-key"`.

### Tailscale login (optional second factor)

Behind `tailscale serve` on loopback, set `REQUIRE_TAILSCALE_LOGIN=you@example.com`. Requests then also need the `Tailscale-User-Login` header that serve adds for tailnet users; anything else gets `403`. Do not rely on this if the port is reachable any other way, because the header can be forged by a direct client.

### Client Configuration with API Key

**Claude Desktop / Cursor (via mcp-remote):**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://your-domain.com/sse",
        "--header", "Authorization: Bearer your-secret-key"
      ]
    }
  }
}
```

**Claude Code:**
```bash
claude mcp add --transport sse obsidian https://your-domain.com/sse --header "Authorization: Bearer your-secret-key"
```

### Security Considerations

- **Generate strong keys**: Use a random string of at least 32 characters
- **HTTPS required**: Always use HTTPS when exposing the server remotely to prevent key interception
- **File Access**: The server has full read/write access to the mounted vault, but every path is confined to it (paths that escape the vault, such as `../../etc/passwd`, are rejected; fixed in 1.4.1)
- **Bind address**: the server listens on all interfaces. In Docker, publish to loopback (`127.0.0.1:3001:3000`) unless remote access is intended
- **CORS**: Currently allows all origins. Restrict in production if needed
- **Key in logs**: only send the key in the `Authorization` header; the old `?api_key=` query parameter was removed because URLs end up in access logs
- **Network security**: Consider additional layers like VPN or firewall rules for sensitive vaults

## Deployment with NGINX Proxy Manager

For remote access with SSL:

1. Add a Proxy Host:
   - Domain: `obsidian.yourdomain.com`
   - Forward Hostname: `obsidian-mcp` (container name)
   - Forward Port: `3000`
   - Websockets are not required (SSE is plain HTTP); the Advanced block below is what matters

2. SSL Tab: Request Let's Encrypt certificate

3. Advanced Tab (for SSE):
   ```nginx
   proxy_buffering off;
   proxy_cache off;
   proxy_set_header Connection '';
   proxy_http_version 1.1;
   chunked_transfer_encoding off;
   ```

## Private access with Tailscale

If your clients are on a [Tailscale](https://tailscale.com) tailnet you can skip the public reverse proxy entirely. Keep the container on loopback and let `tailscale serve` publish it with a tailnet-only HTTPS certificate:

```bash
docker run -d --name obsidian-mcp -v /path/to/vault:/vault:rw -p 127.0.0.1:3001:3000 \
  -e API_KEY=your-secret-key -e REQUIRE_TAILSCALE_LOGIN=you@example.com \
  ghcr.io/smith-and-web/obsidian-mcp-server:latest
sudo tailscale serve --bg --https=443 http://127.0.0.1:3001
```

Clients then use `https://<machine>.<tailnet>.ts.net/sse` with the `Authorization: Bearer` header. Never enable Tailscale Funnel for this server. See [Tailscale login](#tailscale-login-optional-second-factor) for what `REQUIRE_TAILSCALE_LOGIN` does and does not protect against.

## Troubleshooting

### Container Issues
```bash
# View logs
docker-compose logs -f obsidian-mcp

# Restart
docker-compose restart

# Rebuild
docker-compose up -d --build
```

### Vault Access
```bash
# Check host mount
ls -la /path/to/your/vault

# Check container access
docker exec obsidian-mcp ls -la /vault
```

### Connection and auth errors
- `401 Unauthorized`: missing or wrong `Authorization: Bearer <key>` header (the `?api_key=` query parameter is no longer accepted).
- `403 Forbidden`: `REQUIRE_TAILSCALE_LOGIN` is set and the request did not arrive through `tailscale serve` as that user.
- `Path escapes vault`: the requested path resolves outside `VAULT_PATH`; use a path relative to the vault.
- Search results are missing a note's `summary`, tags or type filters: check `index-status` for `invalidFrontmatter` (or the indexer log for `WARN invalid frontmatter`); the note's YAML is invalid and was indexed without its metadata.
- SSE connection drops behind a reverse proxy: turn proxy buffering off (see the NGINX block above), check the certificate, and verify the firewall allows the port.
- Claude Desktop starts but shows no tools: the server must already be running and the config must use `mcp-remote` (the server has no stdio mode).

## Development

### Quick Start

```bash
# Clone and install
git clone https://github.com/smith-and-web/obsidian-mcp-server.git
cd obsidian-mcp-server
make install

# Run with example vault
make dev

# Test connection
make test-connection
```

### Available Commands

Run `make help` to see all available commands:

```
Development:
  make install         Install dependencies
  make dev             Run server with hot-reload
  make start           Run server in production mode
  make test-connection Test server connectivity

Docker:
  make docker-build    Build Docker image
  make docker-up       Start Docker container
  make docker-down     Stop Docker container
  make docker-logs     View container logs
  make docker-restart  Restart container
  make docker-shell    Open shell in container
```

### API Testing with Bruno

The repository includes a [Bruno](https://www.usebruno.com/) collection for testing the core tools (the four semantic-search tools need `DATABASE_URL` and a running index).

1. Install Bruno (free, open-source API client)
2. Open the collection from `./bruno/obsidian-mcp`
3. Select the `local` or `remote` environment
4. Run requests to test each tool

The collection is organized by category:
- `health/` - Server health and tool listing
- `notes/` - Note CRUD operations
- `directories/` - Directory operations
- `frontmatter/` - Frontmatter operations
- `tags/` - Tag management
- `search/` - Search and find-replace
- `links/` - Backlinks and broken links
- `sections/` - Section-based operations

### Example Vault

An example vault is included in `./examples/test-vault/` for development and testing. It includes sample notes with tags, links, and sections to test all features.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io) - Protocol specification
- [Obsidian](https://obsidian.md) - Knowledge base application
- [Claude](https://claude.ai) - AI assistant by Anthropic

## Maintenance worker

Run `node dist/maintain.js` (or `npm run maintain`) from the same image as the server, with `DATABASE_URL`, `INDEX_COLLECTION`, `VAULT_PATH` and `MAINTAIN_REPORT_DIR` configured. Schedule it weekly with your host's scheduler. `--dry` prints candidate counts and hygiene metrics without recording a run or writing a report. The index must already exist.

Eight deterministic checks find missing links, unlinked mentions, uniquely repairable unresolved links, missing `index` or `aliases` frontmatter, stale summaries, near-duplicates, stale project or area hubs, and unlinked co-read pairs. Notes with type `journal` or `inbox` are excluded as targets. An unlinked mention counts only in a note's prose (not its frontmatter, first H1, code, wikilinks or markdown links) and only as a whole word, case-insensitively, with hyphens part of the word; the worker reads the source note from `VAULT_PATH` to check. Near-duplicate pairs skip notes that already link to each other and pairs of `plan` notes. The indexer records summary/body cosine history when content changes, and maintenance backfills baselines for older notes. Search ranking stays unchanged; co-read findings use derived trails.

| Class | Purpose | Graduable |
|---|---|---|
| `link-related` | Similar notes missing a link | yes |
| `link-mention` | Unlinked prose mentions | yes |
| `link-repair` | Uniquely repairable unresolved links | yes |
| `fm-missing` | Missing index or aliases keys | yes |
| `summary-refresh` | Summary/body similarity fell | yes |
| `merge-duplicate` | Near-duplicate notes | no |
| `hub-review` | Stale hubs | no |
| `link-coread` | Unlinked pairs above both trails thresholds | yes |

`MAINTAIN_COREAD_MIN_WEIGHT` defaults to `1.5` (number greater than 0, at most 1000); `MAINTAIN_COREAD_MIN_EVENTS` defaults to `2` (integer 1–1000). Empty trails produce no findings. Existing body and configured frontmatter links suppress co-read suggestions in either direction.

Each ISO week produces `Brain maintenance YYYY-Www.md` in the configured output directory. Reports are draft notes with `index: false`, stable finding ids, accept/reject checkboxes, trends and acceptance counts. They stay out of search and the link graph. A rerun parses ticks first and atomically replaces only that week's report; moved reports are still discovered by their `maintenance_report` frontmatter.

Tick one checkbox per finding, or explicitly ask the assistant to call `maintenance-decision` with `finding: "f17"`, `decision: "accept"` or `"reject"`, and an optional reason. Conflicting ticks record no decision. A checkbox never overrides an earlier decision; an explicit tool call may change one. Rejected findings are never proposed again. Fixed findings resolve without counting as acceptance. New findings are capped per class, with at most 50 open findings listed in a report.

This stage is report-only: accepting records a decision and changes no note. Apply accepted findings yourself. Near-duplicate merges and hub reviews remain report-only permanently. The worker never edits existing notes; its only vault write is its own report.

`recommend-notes` takes 1–10 `positive` paths, up to 10 `negative` paths, an optional integer `k` (1–50), `type` and `directory`. It excludes the examples. `best_score` compares the nearest positive and negative; `average_vector` uses the positive mean, moved away from the negative mean when present. Neither tool requires learn logging; sensitive decision reasons are stored as null using the active redaction patterns or the built-ins.


## Trails

Run `npm run trails` (`node dist/trails.js`) with `DATABASE_URL` and `VAULT_PATH` set. The index must already exist. Scheduling the nightly run is the host's job. `--dry` rebuilds in a rolled-back transaction and reports edge counts, all six heat buckets, and YAML round-trip failures without writing files or a run row. `--clear-heat` removes heat from every indexed document regardless of type; it cannot be combined with `--dry`.

Edges count the strongest event per session and local day: search reads 1.0, untied session reads 0.5, agent feedback 2.0, user feedback 3.0. Negative feedback is excluded. Weights decay over the configured window. Heat sums distinct session-days per note and maps the score to buckets 0–5. Unread notes have bucket 0. Heat writes never bump `updated`, never add an absent `heat: 0`, and skip recent, raced, invalid or restyled notes. The write cap and master switch bound changes. The generated note is a Breadcrumbs list note; an existing file without its ownership marker is never overwritten.

| Variable | Default | Rule / purpose |
|---|---|---|
| `INDEX_COLLECTION` | `default` | Collection shared with the indexer |
| `TRAILS_TZ` | `UTC` | IANA zone for session-days and timestamps |
| `TRAILS_WINDOW_DAYS` | `180` | Integer 7–3650 |
| `TRAILS_HALF_LIFE_DAYS` | `30` | Integer 1–365 |
| `TRAILS_HEAT_THRESHOLDS` | `1,3,6,12,24` | Five strictly ascending positive boundaries |
| `TRAILS_HEAT_TYPES` | empty | Comma-separated note types; empty writes none |
| `TRAILS_WRITE_HEAT` | `false` | Strict `true` or `false` master switch |
| `TRAILS_HEAT_MIN_AGE_MINUTES` | `30` | Integer 0–1440 |
| `TRAILS_HEAT_MAX_WRITES` | `400` | Integer 1–5000 |
| `TRAILS_NOTE_PATH` | empty | Vault-relative `.md` path without `..`; empty disables note |
| `TRAILS_NOTE_PER_NOTE` | `5` | Integer 1–20 partners per source |
| `TRAILS_NOTE_MAX_SOURCES` | `60` | Integer 1–500 |
| `TRAILS_NOTE_MIN_WEIGHT` | `1.0` | Number 0–1000 |

Set `INDEX_FRONTMATTER_LINK_KEYS=up,down,same,next,prev` to index typed frontmatter wikilinks like body links. Set `INDEX_VOLATILE_KEYS=heat` to ignore heat-only changes for embedding and history. Both default to empty; comma-separated keys are trimmed, empty items dropped, and each must contain only letters, digits, `_` or `-`. Invalid keys refuse startup. These settings apply to scans and explicit reindexing.

`documents.frontmatter` keeps the old value of a volatile key until other note content changes. Heat consumers read `note_heat`, never the potentially stale frontmatter value.

### Backfill hub links

`npm run backfill-up -- --plan /tmp/up-plan.json` generates a reviewable plan without editing notes. It chooses hubs already linking to each child, ordered by centroid similarity then path, and skips children already carrying the field. Basename ambiguity is checked against every markdown file in the vault, including unindexed notes. Non-round-tripping YAML is listed under `reformat`.

Review the plan before `npm run backfill-up -- --plan /tmp/up-plan.json --apply`. Changed checksums are skipped; writes add a quoted flow list without changing `updated` or unrelated text. `--revert` removes only a value matching the plan, including a list restyled into block form. Keep the plan for rollback.

Options: required `--plan <file>`, exclusive `--apply` / `--revert` (default dry), `--field <key>` (default `up`), `--hub-types <list>` (default `project,area`), `--child-types <list>` (default `reference,decision,plan`), and `--max <1-10>` (default `3`). Environment: `DATABASE_URL`, `INDEX_COLLECTION`, `VAULT_PATH`. Both CLIs exit 2 for usage/configuration errors, 1 for runtime failures, and 0 on success.

## Related notes endpoint and Obsidian plugin

`GET /api/related?path=notes%2Fa.md&k=8` uses the same bearer authentication and optional
Tailscale login check as the MCP routes. Semantic search must be enabled. `path` is a
vault-relative Markdown path (up to 1024 characters); a leading slash is stripped and
`.md` is appended when missing. `k` is an integer from 1 to 20, default 8.

The response contains `path`, `title`, `heat` (score and bucket, or `null`), `trails`
(read-together neighbours with `path`, `title`, `weight`, `events`, `lastAt`, `linked`),
and `similar` (centroid neighbours with `path`, `title`, `score`, `linked`). Resolved
links in either direction set `linked`. Weights are rounded to one decimal and scores
to two. Invalid queries return 400, unindexed notes 404, disabled semantic search 503,
and store failures a generic 500. These reads create no search or note-read log rows,
so browsing the sidebar does not feed trails.

The **MCP Related Notes** plugin lives in `obsidian-plugin/` and requires desktop
Obsidian 1.13.0 or newer. Download `main.js`, `manifest.json` and `styles.css` from the
matching GitHub release into `.obsidian/plugins/mcp-related-notes/`, then enable it
in Obsidian. In its settings, enter the server URL and bearer token. Only the URL,
result limit and startup preference are saved in the vault; the password field saves
the token in Obsidian's per-device local storage. Configure the token separately on
each device.

Use **Open related notes** to open the right sidebar. It opens at startup by default,
refreshes 400 ms after changing the active Markdown note, and caches each note for five
minutes. **Refresh** bypasses that note's cache. **Read together** shows trail event
counts; **Similar** shows similarity scores; the title displays the heat bucket when
available. Click a title to open the note (modifier-click opens another pane). **Link**
adds a wikilink to the active note's `## Related` section, creating that section if
needed and preserving CRLF line endings. Existing identical links are left alone.
There is no telemetry and no network operation other than the related endpoint.

To develop the plugin:

```bash
cd obsidian-plugin
npm ci
npm test
npm run lint
npm run build
```

`main.js` is ignored build output. CI validates the plugin separately on Node 22.
A `v*` tag builds and tests it, requires the manifest version to equal the tag without
`v`, and uploads the three assets to a GitHub release (creating the release if needed).
The server package and plugin manifest versions must match; add a new `versions.json`
key for every release, keeping older keys. Tags also trigger the existing image and
npm publishing workflows.


## Trails shadow ranking

Trails rerank existing fused candidates after the per-note cap and before the top-k
slice. The first distinct candidate notes act as anchors; undirected trail weights
from those anchors determine an extra reciprocal-rank boost. Candidates are never
added or dropped. The RRF constant is the configured value for RRF fusion and 60
for DBSF. Other search tools keep their existing behavior.

`SEARCH_TRAILS=off` is the default and runs no weights query. `shadow` returns the
same live results, scores and ranker id while logging the alternate top-k order in
`search_log.shadow`: `{ ranker, results: [{ path, ord, rank }] }`, with 1-based ranks.
This requires learn logging to be enabled. `on` returns the boosted order and adds
`-tr<w>a<anchors>` to the ranker id. A weights query failure is logged and returns
the original order with no shadow object; it cannot abort the search transaction.

`learn-report` includes a **Trails shadow** section (`trailsShadow` in JSON) for
searches in the report window that have a shadow and at least one linked read.
`searches` counts those searches, `top1Differs` is the share whose first note
changes, and `mrrLive` / `mrrShadow` average the reciprocal rank of each search's
first-read note (zero if absent). Repeated chunks use the note's minimum rank.
Empty-window rates are `null`, and nonempty rates are rounded to four decimals.

Evaluate trails independently of the existing ranking grid:

```bash
node dist/eval.js --golden /private/golden.json --out /private/trails-eval.json \
  --config '{"perNoteCap":2,"trails":{"w":0.5,"anchors":3}}'
```

The optional `trails` object requires exactly numeric `w` and integer `anchors`
within the environment ranges. It enables trails only for that candidate run;
the baseline, grid and configs without trails retain their existing behavior.
The candidate id receives the same suffix as an enabled server ranker.

**Switch-on rule:** collect at least 30 days of shadow data and 300 qualifying
searches before considering `on`. Switch only if `mrrShadow >= mrrLive + 0.02`
and the trails eval above passes the stage 1 diversity rule against a baseline
run with `--config '{"perNoteCap":2}'` (the production ranking): no regressions,
no category recall@5 drop, and nDCG@8 not lower. Otherwise keep `shadow` and record
the measurements. Switching production ranking on is a later decision.
