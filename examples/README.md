# Example Test Vault

This directory contains a sample Obsidian vault for testing the MCP server.

## Structure

```
test-vault/
├── Welcome.md              # Main entry point with links
├── Inbox/                  # Empty folder for new notes
├── Projects/
│   ├── Project Alpha.md    # Active project with tags
│   └── Project Beta.md     # Planning project
├── Notes/
│   ├── Meeting Notes.md    # Note with sections
│   └── Quick Note.md       # Simple note with broken link
└── Archive/
    └── Old Ideas.md        # Archived content
```

## Test Scenarios

### Tags
- `status/active`, `status/planning`, `status/archived`
- `priority/high`, `priority/medium`
- `project`, `meeting`, `notes`, `archive`

### Links
- Valid links between notes
- One broken link to test `find-broken-links`

### Sections
- Markdown headings at various levels
- Insert marker for `insert-at-marker` tool

## Usage

### Local Development
```bash
export VAULT_PATH=./examples/test-vault
npm run dev
```

### Docker Development
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

The dev compose file automatically mounts this vault.
