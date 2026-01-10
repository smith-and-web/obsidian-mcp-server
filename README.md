# Obsidian MCP Server

[![CI](https://github.com/smith-and-web/obsidian-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/smith-and-web/obsidian-mcp-server/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/release/smith-and-web/obsidian-mcp-server?label=version)](https://github.com/smith-and-web/obsidian-mcp-server/releases)
[![License](https://img.shields.io/github/license/smith-and-web/obsidian-mcp-server)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://www.docker.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

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

### Docker (Recommended)

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

## Claude Desktop Configuration

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

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

Or for a remote server with HTTPS:
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
│   ├── index.js              # Express server entry point
│   ├── vault/
│   │   ├── VaultManager.js   # Core vault operations
│   │   └── frontmatter.js    # YAML parsing utilities
│   ├── tools/
│   │   ├── definitions.js    # MCP tool schemas
│   │   ├── handlers.js       # Tool execution logic
│   │   └── index.js          # Tool exports
│   └── server/
│       ├── mcp.js            # MCP protocol handlers
│       └── middleware.js     # Express middleware
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

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sse` | GET | SSE endpoint for MCP |
| `/sse` | POST | Direct MCP protocol calls |
| `/message` | POST | SSE transport messages |

## Security Considerations

- **Authentication**: API key authentication is planned but not yet implemented. For now, secure access through:
  - Network-level security (firewall, VPN)
  - Reverse proxy with authentication (NGINX, Traefik)
  - SSL/TLS termination
- **File Access**: The server has full read/write access to the mounted vault
- **CORS**: Currently allows all origins. Restrict in production if needed.

> **TODO**: API key authentication will be added in a future release, allowing you to secure the server with a simple bearer token or query parameter.

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
