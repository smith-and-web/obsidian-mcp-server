# Obsidian MCP Server

[![CI](https://github.com/smith-and-web/obsidian-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/smith-and-web/obsidian-mcp-server/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@smith-and-web/obsidian-mcp-server)](https://www.npmjs.com/package/@smith-and-web/obsidian-mcp-server)
[![Docker](https://img.shields.io/badge/ghcr.io-latest-blue)](https://ghcr.io/smith-and-web/obsidian-mcp-server)
[![License](https://img.shields.io/github/license/smith-and-web/obsidian-mcp-server)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
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
│   └── types/
│       └── index.ts          # TypeScript type definitions
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
