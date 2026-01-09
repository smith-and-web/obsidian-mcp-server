# Contributing to Obsidian MCP Server

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/obsidian-mcp-server.git
   cd obsidian-mcp-server
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

### Local Development

1. Set up a test vault:
   ```bash
   mkdir test-vault
   export VAULT_PATH=$(pwd)/test-vault
   ```

2. Run the server with auto-reload:
   ```bash
   npm run dev
   ```

3. Test endpoints:
   ```bash
   # Health check
   curl http://localhost:3000/health

   # List tools
   curl -X POST http://localhost:3000/sse \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
   ```

### Docker Development

```bash
# Build and run
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Project Structure

```
src/
├── index.js              # Express server setup
├── vault/
│   ├── VaultManager.js   # Core vault operations
│   └── frontmatter.js    # YAML utilities
├── tools/
│   ├── definitions.js    # Tool schemas (JSON Schema)
│   ├── handlers.js       # Tool execution
│   └── index.js          # Exports
└── server/
    ├── mcp.js            # MCP protocol handling
    └── middleware.js     # Express middleware
```

## Adding a New Tool

1. **Add the tool definition** in `src/tools/definitions.js`:
   ```javascript
   {
     name: 'my-new-tool',
     description: 'What the tool does',
     inputSchema: {
       type: 'object',
       properties: {
         param1: { type: 'string', description: 'Parameter description' },
       },
       required: ['param1'],
     },
   },
   ```

2. **Add the VaultManager method** in `src/vault/VaultManager.js`:
   ```javascript
   async myNewTool(param1) {
     // Implementation
     return { result: 'success' };
   }
   ```

3. **Add the handler** in `src/tools/handlers.js`:
   ```javascript
   case 'my-new-tool':
     return vaultManager.myNewTool(args.param1);
   ```

4. **Test the tool**:
   ```bash
   curl -X POST http://localhost:3000/sse \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "my-new-tool", "arguments": {"param1": "value"}}}'
   ```

## Code Style

- Use ES modules (`import`/`export`)
- Use async/await for asynchronous code
- Use descriptive variable and function names
- Add JSDoc comments for public methods
- Keep functions focused and single-purpose

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add bulk tag operations
fix: handle empty frontmatter correctly
docs: update tool documentation
refactor: extract frontmatter parsing to separate module
```

Prefixes:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Pull Request Process

1. **Update documentation** if you've changed functionality
2. **Update CHANGELOG.md** with your changes
3. **Ensure the code works** both locally and in Docker
4. **Create a pull request** with:
   - Clear title describing the change
   - Description of what changed and why
   - Any breaking changes noted

## Reporting Issues

When reporting issues, please include:

- Description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, Docker version)
- Relevant logs or error messages

## Questions?

Feel free to open an issue for questions or discussion.
