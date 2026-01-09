# Obsidian MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that enables AI assistants like Claude to interact with your Obsidian vault. Access your notes, create content, manage tags, and search your knowledge base through natural conversation.

## Features

### Note Management
- **CRUD Operations**: Create, read, update, and delete notes
- **Batch Reading**: Read multiple notes in a single request
- **Move/Duplicate**: Reorganize your vault structure
- **Section Operations**: Read, append, or replace specific sections by heading

### Frontmatter & Tags
- **Frontmatter Parsing**: Get/set YAML frontmatter as structured JSON
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

## Quick Start

### Docker (Recommended)

1. **Clone the repository**
   ```bash
   git clone https://github.com/joshsmith/obsidian-mcp-server.git
   cd obsidian-mcp-server
   ```

2. **Configure your vault path** in `docker-compose.yml`:
   ```yaml
   volumes:
     - /path/to/your/vault:/vault:rw
   ```

3. **Start the server**
   ```bash
   docker-compose up -d
   ```

4. **Verify it's running**
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
      "args": ["-y", "@anthropic-ai/mcp-client-sse", "http://localhost:3001/sse"]
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
      "args": ["-y", "@anthropic-ai/mcp-client-sse", "https://your-domain.com/sse"]
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
| `delete-note` | Delete a note |
| `move-note` | Move/rename a note |
| `duplicate-note` | Copy a note to a new location |

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

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sse` | GET | SSE endpoint for MCP |
| `/sse` | POST | Direct MCP protocol calls |
| `/message` | POST | SSE transport messages |

## Security Considerations

- **No Authentication**: The server has no built-in authentication. Secure access through:
  - Network-level security (firewall, VPN)
  - Reverse proxy with authentication (NGINX, Traefik)
  - SSL/TLS termination
- **File Access**: The server has full read/write access to the mounted vault
- **CORS**: Currently allows all origins. Restrict in production if needed.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io) - Protocol specification
- [Obsidian](https://obsidian.md) - Knowledge base application
- [Claude](https://claude.ai) - AI assistant by Anthropic
