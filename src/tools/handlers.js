/**
 * MCP Tool Handlers
 * Maps tool names to VaultManager method calls
 */

/**
 * Execute a tool call against the VaultManager
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {VaultManager} vaultManager - VaultManager instance
 * @returns {Promise<object>} Tool result
 */
export async function executeToolCall(name, args, vaultManager) {
  switch (name) {
    // Note Operations
    case 'read-note':
      return vaultManager.readNote(args.path, { frontmatterOnly: args.frontmatterOnly });
    case 'read-multiple-notes':
      return vaultManager.readMultipleNotes(args.paths, { frontmatterOnly: args.frontmatterOnly });
    case 'create-note':
      return vaultManager.createNote(args.path, args.content);
    case 'edit-note':
      return vaultManager.editNote(args.path, args.content);
    case 'delete-note':
      return vaultManager.deleteNote(args.path, { confirm: args.confirm });
    case 'move-note':
      return vaultManager.moveNote(args.from, args.to);
    case 'duplicate-note':
      return vaultManager.duplicateNote(args.source, args.destination);
    case 'write-note':
      return vaultManager.writeNote(args.path, args.content, { mode: args.mode });
    case 'get-notes-info':
      return vaultManager.getNotesInfo(args.paths);

    // Directory Operations
    case 'create-directory':
      return vaultManager.createDirectory(args.path);
    case 'delete-directory':
      return vaultManager.deleteDirectory(args.path, { recursive: args.recursive });
    case 'rename-directory':
      return vaultManager.renameDirectory(args.from, args.to);
    case 'list-vault':
      return vaultManager.listVault(args.directory);

    // Frontmatter Operations
    case 'get-frontmatter':
      return vaultManager.getFrontmatter(args.path);
    case 'update-frontmatter':
      return vaultManager.updateFrontmatter(args.path, args.updates, {
        createIfMissing: args.createIfMissing,
      });

    // Tag Operations
    case 'add-tags':
      return vaultManager.addTags(args.path, args.tags, { location: args.location });
    case 'remove-tags':
      return vaultManager.removeTags(args.path, args.tags, { location: args.location });
    case 'list-tags':
      return vaultManager.listTags({ directory: args.directory, includeFiles: args.includeFiles });
    case 'find-notes-by-tag':
      return vaultManager.findNotesByTag(args.tag, {
        directory: args.directory,
        matchExact: args.matchExact,
      });
    case 'search-missing-tag':
      return vaultManager.searchMissingTag(args.tag, { directory: args.directory });
    case 'audit-tags':
      return vaultManager.auditTags(args.directory, args.requiredTags);

    // Search Operations
    case 'search-vault':
      return vaultManager.searchVault(args.query, {
        directory: args.directory,
        searchContent: args.searchContent,
        searchFilenames: args.searchFilenames,
        caseSensitive: args.caseSensitive,
        maxResults: args.maxResults,
        includeContext: args.includeContext,
        contextLines: args.contextLines,
      });

    // Link Operations
    case 'get-backlinks':
      return vaultManager.getBacklinks(args.path, { directory: args.directory });
    case 'find-broken-links':
      return vaultManager.findBrokenLinks({ directory: args.directory });

    // Section Operations
    case 'append-to-file':
      return vaultManager.appendToFile(args.path, args.content);
    case 'append-to-section':
      return vaultManager.appendToSection(args.path, args.heading, args.content);
    case 'replace-section':
      return vaultManager.replaceSection(args.path, args.heading, args.content);
    case 'insert-at-marker':
      return vaultManager.insertAtMarker(args.path, args.marker, args.content, args.position);
    case 'read-section':
      return vaultManager.readSection(args.path, args.heading);
    case 'list-headings':
      return vaultManager.listHeadings(args.path, args.level);

    // Find and Replace
    case 'find-replace':
      return vaultManager.findReplace(args.path, args.find, args.replace, {
        useRegex: args.useRegex,
        caseSensitive: args.caseSensitive,
        wholeWord: args.wholeWord,
        recursive: args.recursive,
        dryRun: args.dryRun,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
