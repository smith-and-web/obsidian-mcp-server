# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
