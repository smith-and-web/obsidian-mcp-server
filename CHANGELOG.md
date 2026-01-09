# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
