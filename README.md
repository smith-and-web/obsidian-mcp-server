# Obsidian MCP Server

[![CI](https://github.com/smith-and-web/obsidian-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/smith-and-web/obsidian-mcp-server/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@smith-and-web/obsidian-mcp-server)](https://www.npmjs.com/package/@smith-and-web/obsidian-mcp-server)
[![Docker](https://img.shields.io/badge/ghcr.io-latest-blue)](https://ghcr.io/smith-and-web/obsidian-mcp-server)
[![License](https://img.shields.io/github/license/smith-and-web/obsidian-mcp-server)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
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

### npx (Quickest)

Run directly without installation:

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
  -p 3001:3000 \
  -e VAULT_PATH=/vault \
  ghcr.io/smith-and-web/obsidian-mcp-server:latest
```

**Or with Docker Compose:**

1. **Create a `docker-compose.yml`:**
   ```yaml
   version: '3.8'
   services:
     obsidian-mcp:
       image: ghcr.io/smith-and-web/obsidian-mcp-server:latest
       container_name: obsidian-mcp
       restart: unless-stopped
       volumes:
         - /path/to/your/vault:/vault:rw
       ports:
         - "3001:3000"
       environment:
         - VAULT_PATH=/vault
   ```

2. **Start the server**
   ```bash
   docker-compose up -d
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

**Option 3: Direct npx (runs server locally)**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["@smith-and-web/obsidian-mcp-server"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "PORT": "3001"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings (Settings → MCP):

**Option 1: Connect to running server**
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

**Option 2: Run server directly**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["@smith-and-web/obsidian-mcp-server"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "PORT": "3001"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client can connect using `mcp-remote`:

```bash
npx mcp-remote http://localhost:3001/sse
```

Or connect directly to the SSE endpoint at `http://localhost:3001/sse`.

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
| `update-frontmatter` | Update frontmatter fields |
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
│   │   ├── store.ts          # pgvector schema, upserts, hybrid search
│   │   ├── scanner.ts        # Vault walk and change detection
│   │   └── SearchService.ts  # What the MCP tools call
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
| `API_KEY` | *(none)* | API key for authentication. When set, requires Bearer token or query param |
| `DATABASE_URL` | *(none)* | Postgres + pgvector connection string. **Enables semantic search**; unset = feature off |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server for embeddings |
| `EMBED_MODEL` | `nomic-embed-text` | Ollama embedding model; dimension is discovered from it |
| `INDEX_COLLECTION` | `default` | Name of this vault's collection in the shared database |
| `INDEX_INTERVAL_SECONDS` | `60` | Indexer only: seconds between vault scans |
| `INDEX_VERBOSE` | `false` | Indexer only: log every file indexed or removed |
| `EMBED_BATCH_SIZE` | `16` | Texts per Ollama request |

## Semantic search

Off by default. Setting `DATABASE_URL` turns it on in both the server (four extra tools) and the indexer (a second process that keeps the index current). Everything runs locally: Postgres with the pgvector extension, and Ollama for embeddings.

### How it works

- **The vault stays the source of truth.** The index is a derivative you can drop and rebuild (`--reindex`).
- **Chunking is heading-aware.** Notes split on H1–H3; sections longer than ~800 tokens split further with overlap; each chunk carries its breadcrumb (`Title › H2 › H3`). Chunk 0 is the title plus the frontmatter `summary`, so a one-line summary is the strongest signal for "which note answers this".
- **Retrieval is hybrid.** Cosine similarity over an HNSW index and Postgres full-text search run side by side and are fused with reciprocal rank fusion, so paraphrases and exact identifiers (hostnames, ticket numbers) both work.
- **Change detection is a poll**, not a watcher, because inotify does not propagate over NFS or SMB. The indexer stats every file each interval, hashes only files whose mtime or size moved, and re-embeds only files whose content changed.
- **Exclusions are enforced by path before any read:** `.obsidian/`, `.trash/`, `.git/`, Synology `#recycle/` `@eaDir/` `@tmp/`, AppleDouble `._*`, dotfiles, non-`.md` files, any directory containing a `.noindex` file, and any note with frontmatter `index: false`.
- **Links resolve like Obsidian does.** `[[Areas/note]]` resolves by path; `[[note]]` resolves if exactly one note in the vault has that basename, and stays unresolved (recorded, `NULL` target) when two do. Deleting one of two duplicates re-resolves the other the next time it is indexed.
- **The model is a schema fact.** The embedding model and dimension are recorded in the database on first run; a different model refuses to index until `--reindex`.

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
    ports: ["3001:3000"]

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

### Authentication Methods

Clients can authenticate using either method:

1. **Authorization Header** (recommended):
   ```
   Authorization: Bearer your-secret-key
   ```

2. **Query Parameter**:
   ```
   /sse?api_key=your-secret-key
   ```

### Client Configuration with API Key

**Claude Desktop / Cursor (via mcp-remote):**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://your-domain.com/sse?api_key=your-secret-key"
      ]
    }
  }
}
```

**Direct npx with API key:**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["@smith-and-web/obsidian-mcp-server"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "API_KEY": "your-secret-key"
      }
    }
  }
}
```

### Security Considerations

- **Generate strong keys**: Use a random string of at least 32 characters
- **HTTPS required**: Always use HTTPS when exposing the server remotely to prevent key interception
- **File Access**: The server has full read/write access to the mounted vault
- **CORS**: Currently allows all origins. Restrict in production if needed
- **Network security**: Consider additional layers like VPN or firewall rules for sensitive vaults

## Deployment with NGINX Proxy Manager

For remote access with SSL:

1. Add a Proxy Host:
   - Domain: `obsidian.yourdomain.com`
   - Forward Hostname: `obsidian-mcp` (container name)
   - Forward Port: `3000`
   - Enable Websockets

2. SSL Tab: Request Let's Encrypt certificate

3. Advanced Tab (for SSE):
   ```nginx
   proxy_buffering off;
   proxy_cache off;
   proxy_set_header Connection '';
   proxy_http_version 1.1;
   chunked_transfer_encoding off;
   ```

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

### SSE Connection
- Ensure websockets are enabled in your reverse proxy
- Check SSL certificate validity
- Verify firewall allows the port

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

The repository includes a [Bruno](https://www.usebruno.com/) collection for testing all 31 tools.

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
