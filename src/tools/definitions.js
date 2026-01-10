/**
 * MCP Tool Definitions
 * Schema definitions for all available tools
 */

export const toolDefinitions = [
  // ============================================
  // Note Operations
  // ============================================
  {
    name: 'read-note',
    description:
      'Read the contents of a note. Use frontmatterOnly=true to get just the YAML frontmatter as JSON (saves tokens on large files).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        frontmatterOnly: {
          type: 'boolean',
          description: 'Return only frontmatter as JSON instead of full content (default: false)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read-multiple-notes',
    description:
      'Read multiple notes in a single request. Much more efficient than multiple read-note calls. Supports frontmatterOnly option for token-efficient auditing.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of note paths to read',
        },
        frontmatterOnly: {
          type: 'boolean',
          description: 'Return only frontmatter as JSON instead of full content (default: false)',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'create-note',
    description: 'Create a new note',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path for the new note' },
        content: { type: 'string', description: 'Content of the note' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit-note',
    description: 'Edit an existing note',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        content: { type: 'string', description: 'New content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete-note',
    description: 'Delete a note. Requires confirm parameter matching the filename for safety.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        confirm: {
          type: 'string',
          description: 'Must match the filename (e.g., "note.md") to confirm deletion',
        },
      },
      required: ['path', 'confirm'],
    },
  },
  {
    name: 'move-note',
    description: 'Move a note to a different location',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current path' },
        to: { type: 'string', description: 'New path' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'duplicate-note',
    description:
      'Create a copy of an existing note with a new name/path. The original note is preserved.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Path to the source note to duplicate' },
        destination: { type: 'string', description: 'Path for the new duplicated note' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'write-note',
    description:
      "Write content to a note with multiple modes: overwrite (replace all), append (add to end), or prepend (add to beginning). Creates the file if it doesn't exist (for overwrite mode).",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        content: { type: 'string', description: 'Content to write' },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append', 'prepend'],
          description: "Write mode: 'overwrite' (default), 'append', or 'prepend'",
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'get-notes-info',
    description:
      'Get file info (size, dates, frontmatter presence) for one or more notes without reading full content. Efficient for scanning/auditing large vaults.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          oneOf: [
            { type: 'string', description: 'Single note path' },
            { type: 'array', items: { type: 'string' }, description: 'Array of note paths' },
          ],
          description: 'Path(s) to get info for',
        },
      },
      required: ['paths'],
    },
  },

  // ============================================
  // Directory Operations
  // ============================================
  {
    name: 'create-directory',
    description: 'Create a new directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path for the new directory' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete-directory',
    description:
      'Delete a directory. By default only deletes empty directories. Use recursive=true to delete non-empty directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the directory to delete' },
        recursive: {
          type: 'boolean',
          description: 'Delete non-empty directories and all contents (default: false)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'rename-directory',
    description: 'Rename or move a directory and all its contents to a new location',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current directory path' },
        to: { type: 'string', description: 'New directory path' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'list-vault',
    description: 'List all files in the vault',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Optional directory to list' },
      },
    },
  },

  // ============================================
  // Frontmatter Operations
  // ============================================
  {
    name: 'get-frontmatter',
    description:
      'Get the YAML frontmatter from a note as structured JSON. Returns the parsed frontmatter object and the raw YAML string.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
      },
      required: ['path'],
    },
  },
  {
    name: 'update-frontmatter',
    description:
      "Update specific fields in a note's YAML frontmatter without touching the content. Merges updates with existing frontmatter. Set a field to null to remove it.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        updates: {
          type: 'object',
          description: "Object with fields to update (e.g., {status: 'complete', priority: 1})",
        },
        createIfMissing: {
          type: 'boolean',
          description: "Create frontmatter if note doesn't have one (default: true)",
        },
      },
      required: ['path', 'updates'],
    },
  },

  // ============================================
  // Tag Operations
  // ============================================
  {
    name: 'add-tags',
    description:
      "Add tags to a note. By default adds to YAML frontmatter tags array (creates if missing). Use location='inline' for #tag syntax at end of file.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to add (without # prefix)',
        },
        location: {
          type: 'string',
          enum: ['frontmatter', 'inline'],
          description: "Where to add tags: 'frontmatter' (default) or 'inline'",
        },
      },
      required: ['path', 'tags'],
    },
  },
  {
    name: 'remove-tags',
    description:
      'Remove tags from a note. By default removes from both frontmatter and inline locations.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to remove (without # prefix)',
        },
        location: {
          type: 'string',
          enum: ['frontmatter', 'inline', 'both'],
          description: "Where to remove from: 'frontmatter', 'inline', or 'both' (default)",
        },
      },
      required: ['path', 'tags'],
    },
  },
  {
    name: 'list-tags',
    description:
      'List all tags in the vault (or directory) with usage counts. Finds both inline #tags and frontmatter tags.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Limit to specific directory (optional)' },
        includeFiles: {
          type: 'boolean',
          description: 'Include list of files for each tag (default: false)',
        },
      },
    },
  },
  {
    name: 'find-notes-by-tag',
    description: 'Find all notes that have a specific tag (inline or in frontmatter).',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag to search for (without # prefix)' },
        directory: { type: 'string', description: 'Limit search to specific directory (optional)' },
        matchExact: {
          type: 'boolean',
          description: 'Require exact match vs partial match (default: false)',
        },
      },
      required: ['tag'],
    },
  },
  {
    name: 'search-missing-tag',
    description:
      'Find all notes that are MISSING a specific tag. Useful for auditing tag compliance.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag that should be present (without # prefix)' },
        directory: { type: 'string', description: 'Limit search to specific directory (optional)' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'audit-tags',
    description:
      'Audit a folder for tag compliance. Returns files that are missing any of the required tags.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to audit' },
        requiredTags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of tags that should be present in each file',
        },
      },
      required: ['directory', 'requiredTags'],
    },
  },

  // ============================================
  // Search Operations
  // ============================================
  {
    name: 'search-vault',
    description:
      'Search notes in the vault with structured results including line numbers and context. Can search content, filenames, or both. Supports directory filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        directory: { type: 'string', description: 'Limit search to specific directory (optional)' },
        searchContent: {
          type: 'boolean',
          description: 'Search within file content (default: true)',
        },
        searchFilenames: { type: 'boolean', description: 'Search in filenames (default: true)' },
        caseSensitive: { type: 'boolean', description: 'Case-sensitive search (default: false)' },
        maxResults: {
          type: 'number',
          description: 'Maximum number of files to return (default: 100)',
        },
        includeContext: {
          type: 'boolean',
          description: 'Include surrounding lines for context (default: true)',
        },
        contextLines: {
          type: 'number',
          description: 'Number of context lines before/after match (default: 2)',
        },
      },
      required: ['query'],
    },
  },

  // ============================================
  // Link Operations
  // ============================================
  {
    name: 'get-backlinks',
    description:
      'Find all notes that link TO a specific note (reverse link lookup). Useful for understanding note relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note to find backlinks for' },
        directory: { type: 'string', description: 'Limit search to specific directory (optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'find-broken-links',
    description:
      "Find wiki-links [[like this]] that don't resolve to any existing note in the vault.",
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Limit search to specific directory (optional)' },
      },
    },
  },

  // ============================================
  // Section Operations
  // ============================================
  {
    name: 'append-to-file',
    description:
      'Append content to the end of a file without reading it first (efficient for large files)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        content: { type: 'string', description: 'Content to append' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'append-to-section',
    description: 'Append content to the end of a specific markdown section (under a heading)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        heading: { type: 'string', description: "Markdown heading (e.g., '### Thinking Style')" },
        content: { type: 'string', description: 'Content to append to the section' },
      },
      required: ['path', 'heading', 'content'],
    },
  },
  {
    name: 'replace-section',
    description: 'Replace all content under a specific markdown heading',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        heading: { type: 'string', description: "Markdown heading (e.g., '### Thinking Style')" },
        content: { type: 'string', description: 'New content for the section' },
      },
      required: ['path', 'heading', 'content'],
    },
  },
  {
    name: 'insert-at-marker',
    description: 'Insert content before or after a specific text marker',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        marker: { type: 'string', description: 'Text marker to find' },
        content: { type: 'string', description: 'Content to insert' },
        position: {
          type: 'string',
          enum: ['before', 'after'],
          description: 'Insert before or after the marker (default: after)',
        },
      },
      required: ['path', 'marker', 'content'],
    },
  },
  {
    name: 'read-section',
    description:
      'Read only the content under a specific markdown heading (efficient for large files)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        heading: { type: 'string', description: "Markdown heading (e.g., '### Thinking Style')" },
      },
      required: ['path', 'heading'],
    },
  },
  {
    name: 'list-headings',
    description: 'List all markdown headings in a note, optionally filtered by level',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        level: {
          type: 'number',
          description: 'Optional: Filter by heading level (1-6)',
          minimum: 1,
          maximum: 6,
        },
      },
      required: ['path'],
    },
  },

  // ============================================
  // Find and Replace
  // ============================================
  {
    name: 'find-replace',
    description:
      'Find and replace text across one or multiple files. Supports regex, whole word matching, and dry-run mode. Extremely efficient for bulk replacements.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to file or directory' },
        find: { type: 'string', description: 'Text or regex pattern to find' },
        replace: { type: 'string', description: 'Replacement text' },
        useRegex: { type: 'boolean', description: 'Treat find as regex pattern (default: false)' },
        caseSensitive: { type: 'boolean', description: 'Case sensitive matching (default: true)' },
        wholeWord: { type: 'boolean', description: 'Match whole words only (default: false)' },
        recursive: {
          type: 'boolean',
          description: 'Search subdirectories if path is a directory (default: false)',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview changes without modifying files (default: false)',
        },
      },
      required: ['path', 'find', 'replace'],
    },
  },
];
