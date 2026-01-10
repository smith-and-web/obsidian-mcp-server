/**
 * VaultManager - Core class for Obsidian vault operations
 */

import fs from 'fs/promises';
import path from 'path';
import { parseFrontmatter, serializeFrontmatter, reconstructContent } from './frontmatter.js';

export class VaultManager {
  constructor(vaultPath, options = {}) {
    this.vaultPath = vaultPath;
    this.compactResponses = options.compactResponses || false;
  }

  /**
   * Minify response object keys for token optimization (40-60% smaller)
   * Maps verbose keys to short keys when compact mode is enabled
   */
  _compact(obj) {
    if (!this.compactResponses) return obj;

    const keyMap = {
      path: 'p',
      content: 'c',
      frontmatter: 'fm',
      hasFrontmatter: 'hfm',
      directory: 'd',
      files: 'f',
      directories: 'ds',
      created: 'cr',
      updated: 'up',
      deleted: 'del',
      moved: 'mv',
      duplicated: 'dup',
      renamed: 'rn',
      appended: 'ap',
      replaced: 'rp',
      inserted: 'ins',
      tags: 't',
      added: 'add',
      removed: 'rm',
      location: 'loc',
      results: 'r',
      errors: 'e',
      totalFiles: 'tf',
      totalMatches: 'tm',
      filesMatched: 'fmd',
      matches: 'm',
      line: 'l',
      context: 'ctx',
      before: 'b',
      after: 'a',
      size: 'sz',
      modified: 'mod',
      name: 'n',
      extension: 'ext',
      successful: 'ok',
      failed: 'fail',
      totalRequested: 'req'
    };

    const compact = {};
    for (const [key, value] of Object.entries(obj)) {
      const newKey = keyMap[key] || key;
      if (Array.isArray(value)) {
        compact[newKey] = value.map(v => typeof v === 'object' && v !== null ? this._compact(v) : v);
      } else if (typeof value === 'object' && value !== null) {
        compact[newKey] = this._compact(value);
      } else {
        compact[newKey] = value;
      }
    }
    return compact;
  }

  // Re-export frontmatter utilities as methods for backward compatibility
  parseFrontmatter(content) {
    return parseFrontmatter(content);
  }

  serializeFrontmatter(frontmatter) {
    return serializeFrontmatter(frontmatter);
  }

  // ============================================
  // Note CRUD Operations
  // ============================================

  async readNote(notePath, options = {}) {
    const { frontmatterOnly = false } = options;
    const fullPath = path.join(this.vaultPath, notePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    if (frontmatterOnly) {
      const { frontmatter, raw } = this.parseFrontmatter(content);
      return {
        path: notePath,
        hasFrontmatter: !!frontmatter,
        frontmatter: frontmatter || null,
        raw: raw || null
      };
    }

    return { path: notePath, content };
  }

  async readMultipleNotes(paths, options = {}) {
    const { frontmatterOnly = false } = options;
    const results = [];
    const errors = [];

    for (const notePath of paths) {
      try {
        const result = await this.readNote(notePath, { frontmatterOnly });
        results.push(result);
      } catch (err) {
        errors.push({ path: notePath, error: err.message });
      }
    }

    return {
      totalRequested: paths.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  async createNote(notePath, content) {
    const fullPath = path.join(this.vaultPath, notePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    return { path: notePath, created: true };
  }

  async editNote(notePath, content) {
    const fullPath = path.join(this.vaultPath, notePath);
    await fs.writeFile(fullPath, content, 'utf-8');
    return { path: notePath, updated: true };
  }

  async deleteNote(notePath, options = {}) {
    const { confirm } = options;
    const fullPath = path.join(this.vaultPath, notePath);
    const filename = path.basename(notePath);

    // Safety: require confirmation matching the filename
    if (confirm !== filename) {
      return {
        path: notePath,
        deleted: false,
        error: `Safety check failed: confirm must match filename "${filename}". Pass confirm: "${filename}" to delete.`
      };
    }

    await fs.unlink(fullPath);
    return this._compact({ path: notePath, deleted: true });
  }

  async moveNote(fromPath, toPath) {
    const fullFromPath = path.join(this.vaultPath, fromPath);
    const fullToPath = path.join(this.vaultPath, toPath);
    const dir = path.dirname(fullToPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(fullFromPath, fullToPath);
    return { from: fromPath, to: toPath, moved: true };
  }

  async duplicateNote(sourcePath, destPath) {
    const fullSourcePath = path.join(this.vaultPath, sourcePath);
    const fullDestPath = path.join(this.vaultPath, destPath);

    // Check source exists
    await fs.stat(fullSourcePath);

    // Check destination doesn't exist
    try {
      await fs.stat(fullDestPath);
      throw new Error(`Destination already exists: ${destPath}`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Create parent directory if needed
    const dir = path.dirname(fullDestPath);
    await fs.mkdir(dir, { recursive: true });

    // Copy the file
    await fs.copyFile(fullSourcePath, fullDestPath);

    return this._compact({ source: sourcePath, destination: destPath, duplicated: true });
  }

  /**
   * Unified write operation with multiple modes
   * @param {string} notePath - Path to the note
   * @param {string} content - Content to write
   * @param {object} options - Write options
   * @param {'overwrite'|'append'|'prepend'} options.mode - Write mode (default: overwrite)
   */
  async writeNote(notePath, content, options = {}) {
    const { mode = 'overwrite' } = options;
    const fullPath = path.join(this.vaultPath, notePath);

    switch (mode) {
      case 'append': {
        await fs.appendFile(fullPath, content, 'utf-8');
        return this._compact({ path: notePath, mode, written: true });
      }

      case 'prepend': {
        const existing = await fs.readFile(fullPath, 'utf-8');
        await fs.writeFile(fullPath, content + existing, 'utf-8');
        return this._compact({ path: notePath, mode, written: true });
      }

      case 'overwrite':
      default: {
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return this._compact({ path: notePath, mode, written: true });
      }
    }
  }

  /**
   * Get file info without reading content (efficient for scanning)
   * @param {string|string[]} paths - Path(s) to get info for
   */
  async getNotesInfo(paths) {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    const results = [];
    const errors = [];

    for (const notePath of pathArray) {
      try {
        const fullPath = path.join(this.vaultPath, notePath);
        const stats = await fs.stat(fullPath);

        // Quick frontmatter check - read first 1KB to check for ---
        const fd = await fs.open(fullPath, 'r');
        const buffer = Buffer.alloc(1024);
        await fd.read(buffer, 0, 1024, 0);
        await fd.close();
        const preview = buffer.toString('utf-8');
        const hasFrontmatter = preview.trimStart().startsWith('---');

        results.push({
          path: notePath,
          name: path.basename(notePath, '.md'),
          extension: path.extname(notePath),
          size: stats.size,
          modified: stats.mtime.toISOString(),
          created: stats.birthtime.toISOString(),
          hasFrontmatter
        });
      } catch (err) {
        errors.push({ path: notePath, error: err.message });
      }
    }

    const response = {
      totalRequested: pathArray.length,
      successful: results.length,
      failed: errors.length,
      results,
      ...(errors.length > 0 && { errors })
    };

    return this._compact(response);
  }

  // ============================================
  // Directory Operations
  // ============================================

  async createDirectory(dirPath) {
    const fullPath = path.join(this.vaultPath, dirPath);
    await fs.mkdir(fullPath, { recursive: true });
    return { path: dirPath, created: true };
  }

  async deleteDirectory(dirPath, options = {}) {
    const { recursive = false } = options;
    const fullPath = path.join(this.vaultPath, dirPath);

    const stats = await fs.stat(fullPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }

    const entries = await fs.readdir(fullPath);
    if (entries.length > 0 && !recursive) {
      throw new Error(`Directory is not empty: ${dirPath}. Use recursive=true to delete non-empty directories.`);
    }

    if (recursive) {
      await fs.rm(fullPath, { recursive: true });
    } else {
      await fs.rmdir(fullPath);
    }

    return { path: dirPath, deleted: true, recursive };
  }

  async renameDirectory(fromPath, toPath) {
    const fullFromPath = path.join(this.vaultPath, fromPath);
    const fullToPath = path.join(this.vaultPath, toPath);

    const stats = await fs.stat(fullFromPath);
    if (!stats.isDirectory()) {
      throw new Error(`Source path is not a directory: ${fromPath}`);
    }

    try {
      await fs.stat(fullToPath);
      throw new Error(`Destination already exists: ${toPath}`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const parentDir = path.dirname(fullToPath);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.rename(fullFromPath, fullToPath);

    return { from: fromPath, to: toPath, renamed: true };
  }

  async listVault(directory = '') {
    const fullPath = path.join(this.vaultPath, directory);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const files = [];
    const dirs = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const relativePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        dirs.push(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }

    return { directory, files, directories: dirs };
  }

  // ============================================
  // Frontmatter Operations
  // ============================================

  async getFrontmatter(notePath) {
    const fullPath = path.join(this.vaultPath, notePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    const { frontmatter, raw } = this.parseFrontmatter(content);

    if (!frontmatter) {
      return { path: notePath, hasFrontmatter: false, frontmatter: null };
    }

    return { path: notePath, hasFrontmatter: true, frontmatter, raw };
  }

  async updateFrontmatter(notePath, updates, options = {}) {
    const { createIfMissing = true } = options;
    const fullPath = path.join(this.vaultPath, notePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    const { frontmatter, body } = this.parseFrontmatter(content);

    let newFrontmatter;
    if (frontmatter) {
      newFrontmatter = { ...frontmatter, ...updates };
    } else if (createIfMissing) {
      newFrontmatter = { ...updates };
    } else {
      throw new Error(`No frontmatter found in ${notePath} and createIfMissing is false`);
    }

    // Remove null/undefined values
    for (const key of Object.keys(newFrontmatter)) {
      if (newFrontmatter[key] === null || newFrontmatter[key] === undefined) {
        delete newFrontmatter[key];
      }
    }

    const serialized = this.serializeFrontmatter(newFrontmatter);
    const newContent = `---\n${serialized}\n---\n${body}`;

    await fs.writeFile(fullPath, newContent, 'utf-8');

    return {
      path: notePath,
      updated: true,
      frontmatter: newFrontmatter,
      fieldsUpdated: Object.keys(updates)
    };
  }

  // ============================================
  // Tag Operations
  // ============================================

  async addTags(notePath, tags, options = {}) {
    const { location = 'frontmatter' } = options;
    const fullPath = path.join(this.vaultPath, notePath);
    let content = await fs.readFile(fullPath, 'utf-8');

    if (location === 'frontmatter') {
      const { frontmatter, body } = this.parseFrontmatter(content);
      const newFrontmatter = frontmatter || {};

      const existingTags = Array.isArray(newFrontmatter.tags) ? newFrontmatter.tags : [];
      const tagsToAdd = tags.filter(t => !existingTags.includes(t));
      newFrontmatter.tags = [...existingTags, ...tagsToAdd];

      const serialized = this.serializeFrontmatter(newFrontmatter);
      const newContent = `---\n${serialized}\n---\n${body}`;

      await fs.writeFile(fullPath, newContent, 'utf-8');
      return {
        path: notePath,
        tags: tagsToAdd,
        added: true,
        location: 'frontmatter',
        allTags: newFrontmatter.tags
      };
    } else {
      const tagString = tags.map(t => `#${t}`).join(' ');
      content += `\n\n${tagString}`;

      await fs.writeFile(fullPath, content, 'utf-8');
      return { path: notePath, tags, added: true, location: 'inline' };
    }
  }

  async removeTags(notePath, tags, options = {}) {
    const { location = 'both' } = options;
    const fullPath = path.join(this.vaultPath, notePath);
    let content = await fs.readFile(fullPath, 'utf-8');

    const removedFrom = [];

    if (location === 'frontmatter' || location === 'both') {
      const { frontmatter, body } = this.parseFrontmatter(content);

      if (frontmatter && Array.isArray(frontmatter.tags)) {
        const originalLength = frontmatter.tags.length;
        frontmatter.tags = frontmatter.tags.filter(t => !tags.includes(t));

        if (frontmatter.tags.length < originalLength) {
          removedFrom.push('frontmatter');
          const serialized = this.serializeFrontmatter(frontmatter);
          content = `---\n${serialized}\n---\n${body}`;
        }
      }
    }

    if (location === 'inline' || location === 'both') {
      const originalContent = content;
      for (const tag of tags) {
        const tagRegex = new RegExp(`#${tag}(?![a-zA-Z0-9_/-])\\s*`, 'g');
        content = content.replace(tagRegex, '');
      }
      if (content !== originalContent) {
        removedFrom.push('inline');
      }
    }

    await fs.writeFile(fullPath, content, 'utf-8');
    return { path: notePath, tags, removed: true, removedFrom };
  }

  async listTags(options = {}) {
    const { directory = '', includeFiles = false } = options;
    const searchPath = directory ? path.join(this.vaultPath, directory) : this.vaultPath;

    const tagCounts = {};
    const tagFiles = {};

    await this._collectTagsFromDirectory(searchPath, directory, tagCounts, tagFiles);

    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => {
        const result = { tag, count };
        if (includeFiles) {
          result.files = tagFiles[tag];
        }
        return result;
      });

    return {
      directory: directory || '(entire vault)',
      totalTags: sortedTags.length,
      totalUsages: Object.values(tagCounts).reduce((a, b) => a + b, 0),
      tags: sortedTags
    };
  }

  async _collectTagsFromDirectory(dir, basePath, tagCounts, tagFiles) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await this._collectTagsFromDirectory(fullPath, relativePath, tagCounts, tagFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');

          // Find inline tags
          const inlineTagRegex = /#([a-zA-Z0-9_/-]+)/g;
          let match;
          while ((match = inlineTagRegex.exec(content)) !== null) {
            const tag = match[1];
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            if (!tagFiles[tag]) tagFiles[tag] = [];
            if (!tagFiles[tag].includes(relativePath)) {
              tagFiles[tag].push(relativePath);
            }
          }

          // Check frontmatter tags
          const { frontmatter } = this.parseFrontmatter(content);
          if (frontmatter && frontmatter.tags && Array.isArray(frontmatter.tags)) {
            for (const tag of frontmatter.tags) {
              tagCounts[tag] = (tagCounts[tag] || 0) + 1;
              if (!tagFiles[tag]) tagFiles[tag] = [];
              if (!tagFiles[tag].includes(relativePath)) {
                tagFiles[tag].push(relativePath);
              }
            }
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    }
  }

  async findNotesByTag(tag, options = {}) {
    const { directory = '', matchExact = false } = options;
    const searchPath = directory ? path.join(this.vaultPath, directory) : this.vaultPath;

    const matchingFiles = [];
    await this._findNotesByTagInDirectory(searchPath, directory, tag, matchExact, matchingFiles);

    return {
      tag,
      directory: directory || '(entire vault)',
      matchExact,
      totalFiles: matchingFiles.length,
      files: matchingFiles
    };
  }

  async _findNotesByTagInDirectory(dir, basePath, tag, matchExact, matchingFiles) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await this._findNotesByTagInDirectory(fullPath, relativePath, tag, matchExact, matchingFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          let hasTag = false;
          const tagLocations = [];

          // Check inline tags
          const inlineTagRegex = /#([a-zA-Z0-9_/-]+)/g;
          let match;
          while ((match = inlineTagRegex.exec(content)) !== null) {
            const foundTag = match[1];
            const matches = matchExact
              ? foundTag === tag
              : foundTag.toLowerCase().includes(tag.toLowerCase());

            if (matches) {
              hasTag = true;
              const beforeMatch = content.slice(0, match.index);
              const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
              tagLocations.push({ tag: foundTag, line: lineNumber, source: 'inline' });
            }
          }

          // Check frontmatter tags
          const { frontmatter } = this.parseFrontmatter(content);
          if (frontmatter && frontmatter.tags && Array.isArray(frontmatter.tags)) {
            for (const fmTag of frontmatter.tags) {
              const matches = matchExact
                ? fmTag === tag
                : fmTag.toLowerCase().includes(tag.toLowerCase());

              if (matches) {
                hasTag = true;
                tagLocations.push({ tag: fmTag, source: 'frontmatter' });
              }
            }
          }

          if (hasTag) {
            matchingFiles.push({
              path: relativePath,
              occurrences: tagLocations
            });
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    }
  }

  async searchMissingTag(tag, options = {}) {
    const { directory = '' } = options;
    const searchPath = directory ? path.join(this.vaultPath, directory) : this.vaultPath;

    const missingFiles = [];
    await this._findNotesMissingTagInDirectory(searchPath, directory, tag, missingFiles);

    return {
      tag,
      directory: directory || '(entire vault)',
      totalFiles: missingFiles.length,
      files: missingFiles
    };
  }

  async _findNotesMissingTagInDirectory(dir, basePath, tag, missingFiles) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await this._findNotesMissingTagInDirectory(fullPath, relativePath, tag, missingFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          let hasTag = false;

          const inlineTagRegex = /#([a-zA-Z0-9_/-]+)/g;
          let match;
          while ((match = inlineTagRegex.exec(content)) !== null) {
            if (match[1] === tag || match[1].startsWith(tag + '/')) {
              hasTag = true;
              break;
            }
          }

          if (!hasTag) {
            const { frontmatter } = this.parseFrontmatter(content);
            if (frontmatter && frontmatter.tags && Array.isArray(frontmatter.tags)) {
              hasTag = frontmatter.tags.some(t => t === tag || t.startsWith(tag + '/'));
            }
          }

          if (!hasTag) {
            missingFiles.push(relativePath);
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    }
  }

  async auditTags(directory, requiredTags) {
    const searchPath = directory ? path.join(this.vaultPath, directory) : this.vaultPath;

    const auditResults = [];
    await this._auditTagsInDirectory(searchPath, directory || '', requiredTags, auditResults);

    const compliant = auditResults.filter(r => r.missingTags.length === 0);
    const nonCompliant = auditResults.filter(r => r.missingTags.length > 0);

    return {
      directory: directory || '(entire vault)',
      requiredTags,
      totalFiles: auditResults.length,
      compliantFiles: compliant.length,
      nonCompliantFiles: nonCompliant.length,
      results: nonCompliant
    };
  }

  async _auditTagsInDirectory(dir, basePath, requiredTags, auditResults) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await this._auditTagsInDirectory(fullPath, relativePath, requiredTags, auditResults);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const fileTags = new Set();

          const inlineTagRegex = /#([a-zA-Z0-9_/-]+)/g;
          let match;
          while ((match = inlineTagRegex.exec(content)) !== null) {
            fileTags.add(match[1]);
          }

          const { frontmatter } = this.parseFrontmatter(content);
          if (frontmatter && frontmatter.tags && Array.isArray(frontmatter.tags)) {
            frontmatter.tags.forEach(t => fileTags.add(t));
          }

          const missingTags = requiredTags.filter(reqTag => {
            return !Array.from(fileTags).some(t => t === reqTag || t.startsWith(reqTag + '/'));
          });

          auditResults.push({
            path: relativePath,
            missingTags,
            existingTags: Array.from(fileTags)
          });
        } catch (err) {
          // Skip files that can't be read
        }
      }
    }
  }

  // ============================================
  // Search Operations
  // ============================================

  async searchVault(query, options = {}) {
    const {
      directory = '',
      searchContent = true,
      searchFilenames = true,
      caseSensitive = false,
      maxResults = 100,
      includeContext = true,
      contextLines = 2
    } = options;

    const results = [];
    const searchPath = directory ? path.join(this.vaultPath, directory) : this.vaultPath;

    await this._searchDirectoryEnhanced(searchPath, query, results, directory, {
      searchContent,
      searchFilenames,
      caseSensitive,
      maxResults,
      includeContext,
      contextLines
    });

    return {
      query,
      options: { directory, searchContent, searchFilenames, caseSensitive },
      totalMatches: results.reduce((sum, r) => sum + (r.matches ? r.matches.length : 1), 0),
      filesMatched: results.length,
      results
    };
  }

  async _searchDirectoryEnhanced(dir, query, results, basePath = '', options) {
    if (results.length >= options.maxResults) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    const queryToMatch = options.caseSensitive ? query : query.toLowerCase();

    for (const entry of entries) {
      if (results.length >= options.maxResults) break;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await this._searchDirectoryEnhanced(fullPath, query, results, relativePath, options);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const fileResult = { path: relativePath, matches: [] };

        if (options.searchFilenames) {
          const filenameToMatch = options.caseSensitive ? entry.name : entry.name.toLowerCase();
          if (filenameToMatch.includes(queryToMatch)) {
            fileResult.filenameMatch = true;
          }
        }

        if (options.searchContent) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const contentToMatch = options.caseSensitive ? content : content.toLowerCase();

            if (contentToMatch.includes(queryToMatch)) {
              const lines = content.split('\n');

              for (let i = 0; i < lines.length; i++) {
                const lineToMatch = options.caseSensitive ? lines[i] : lines[i].toLowerCase();
                if (lineToMatch.includes(queryToMatch)) {
                  const match = {
                    line: i + 1,
                    content: lines[i].trim()
                  };

                  if (options.includeContext && options.contextLines > 0) {
                    const contextStart = Math.max(0, i - options.contextLines);
                    const contextEnd = Math.min(lines.length - 1, i + options.contextLines);
                    match.context = {
                      before: lines.slice(contextStart, i).map((l, idx) => ({
                        line: contextStart + idx + 1,
                        content: l.trim()
                      })),
                      after: lines.slice(i + 1, contextEnd + 1).map((l, idx) => ({
                        line: i + 2 + idx,
                        content: l.trim()
                      }))
                    };
                  }

                  fileResult.matches.push(match);
                }
              }
            }
          } catch (err) {
            // Skip files that can't be read
          }
        }

        if (fileResult.filenameMatch || fileResult.matches.length > 0) {
          results.push(fileResult);
        }
      }
    }
  }

  // ============================================
  // Link Operations
  // ============================================

  async getBacklinks(notePath, options = {}) {
    const { directory = '' } = options;
    const searchPath = directory ? path.join(this.vaultPath, directory) : this.vaultPath;

    const noteNameWithExt = path.basename(notePath);
    const noteName = noteNameWithExt.replace(/\.md$/, '');

    const backlinks = [];
    await this._findBacklinksInDirectory(searchPath, directory, noteName, notePath, backlinks);

    return {
      note: notePath,
      directory: directory || '(entire vault)',
      totalBacklinks: backlinks.reduce((sum, f) => sum + f.links.length, 0),
      filesLinking: backlinks.length,
      results: backlinks
    };
  }

  async _findBacklinksInDirectory(dir, basePath, noteName, originalPath, backlinks) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await this._findBacklinksInDirectory(fullPath, relativePath, noteName, originalPath, backlinks);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (relativePath === originalPath) continue;

        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
          const fileBacklinks = [];
          let match;

          while ((match = wikiLinkRegex.exec(content)) !== null) {
            const linkTarget = match[1].trim();
            const linkLower = linkTarget.toLowerCase();
            const noteNameLower = noteName.toLowerCase();

            if (linkLower === noteNameLower ||
                linkLower === noteNameLower + '.md' ||
                linkLower === originalPath.toLowerCase() ||
                linkLower === originalPath.toLowerCase().replace(/\.md$/, '')) {

              const beforeMatch = content.slice(0, match.index);
              const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
              const lines = content.split('\n');
              const lineContent = lines[lineNumber - 1].trim();

              fileBacklinks.push({
                link: linkTarget,
                line: lineNumber,
                context: lineContent
              });
            }
          }

          if (fileBacklinks.length > 0) {
            backlinks.push({
              path: relativePath,
              links: fileBacklinks
            });
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    }
  }

  async findBrokenLinks(options = {}) {
    const { directory = '' } = options;
    const searchPath = directory ? path.join(this.vaultPath, directory) : this.vaultPath;

    const existingNotes = new Set();
    await this._collectNotePaths(this.vaultPath, '', existingNotes);

    const brokenLinks = [];
    await this._findBrokenLinksInDirectory(searchPath, directory, existingNotes, brokenLinks);

    return {
      directory: directory || '(entire vault)',
      totalBrokenLinks: brokenLinks.reduce((sum, f) => sum + f.brokenLinks.length, 0),
      filesWithBrokenLinks: brokenLinks.length,
      results: brokenLinks
    };
  }

  async _collectNotePaths(dir, basePath, existingNotes) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await this._collectNotePaths(fullPath, relativePath, existingNotes);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const withoutExt = relativePath.slice(0, -3);
        const justName = entry.name.slice(0, -3);
        existingNotes.add(relativePath);
        existingNotes.add(withoutExt);
        existingNotes.add(justName);
        existingNotes.add(justName.toLowerCase());
        existingNotes.add(withoutExt.toLowerCase());
      }
    }
  }

  async _findBrokenLinksInDirectory(dir, basePath, existingNotes, brokenLinks) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await this._findBrokenLinksInDirectory(fullPath, relativePath, existingNotes, brokenLinks);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
          const fileBrokenLinks = [];
          let match;

          while ((match = wikiLinkRegex.exec(content)) !== null) {
            const linkTarget = match[1].trim();

            if (linkTarget.startsWith('http') || linkTarget.startsWith('#') || linkTarget.startsWith('!')) {
              continue;
            }

            const linkLower = linkTarget.toLowerCase();
            const linkWithMd = linkTarget + '.md';
            const linkWithMdLower = linkWithMd.toLowerCase();

            const exists = existingNotes.has(linkTarget) ||
                          existingNotes.has(linkLower) ||
                          existingNotes.has(linkWithMd) ||
                          existingNotes.has(linkWithMdLower);

            if (!exists) {
              const beforeMatch = content.slice(0, match.index);
              const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

              fileBrokenLinks.push({
                link: linkTarget,
                line: lineNumber
              });
            }
          }

          if (fileBrokenLinks.length > 0) {
            brokenLinks.push({
              path: relativePath,
              brokenLinks: fileBrokenLinks
            });
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    }
  }

  // ============================================
  // Section Operations
  // ============================================

  async appendToFile(notePath, content) {
    const fullPath = path.join(this.vaultPath, notePath);
    await fs.appendFile(fullPath, '\n' + content, 'utf-8');
    return { path: notePath, appended: true };
  }

  async appendToSection(notePath, heading, content) {
    const fullPath = path.join(this.vaultPath, notePath);
    let fileContent = await fs.readFile(fullPath, 'utf-8');

    const headingRegex = new RegExp(`^${heading}\\s*$`, 'm');
    const match = fileContent.match(headingRegex);

    if (!match) {
      throw new Error(`Heading "${heading}" not found in ${notePath}`);
    }

    const headingLevel = (heading.match(/^#+/) || ['#'])[0].length;
    const nextHeadingRegex = new RegExp(`^#{1,${headingLevel}}\\s+.+$`, 'm');

    const afterHeading = fileContent.slice(match.index + match[0].length);
    const nextMatch = afterHeading.match(nextHeadingRegex);

    let insertPos;
    if (nextMatch) {
      insertPos = match.index + match[0].length + nextMatch.index;
    } else {
      insertPos = fileContent.length;
    }

    const newContent =
      fileContent.slice(0, insertPos) +
      '\n' + content + '\n' +
      fileContent.slice(insertPos);

    await fs.writeFile(fullPath, newContent, 'utf-8');
    return { path: notePath, heading, appended: true };
  }

  async replaceSection(notePath, heading, newContent) {
    const fullPath = path.join(this.vaultPath, notePath);
    let fileContent = await fs.readFile(fullPath, 'utf-8');

    const headingRegex = new RegExp(`^${heading}\\s*$`, 'm');
    const match = fileContent.match(headingRegex);

    if (!match) {
      throw new Error(`Heading "${heading}" not found in ${notePath}`);
    }

    const headingLevel = (heading.match(/^#+/) || ['#'])[0].length;
    const nextHeadingRegex = new RegExp(`^#{1,${headingLevel}}\\s+.+$`, 'm');

    const afterHeading = fileContent.slice(match.index + match[0].length);
    const nextMatch = afterHeading.match(nextHeadingRegex);

    let sectionEnd;
    if (nextMatch) {
      sectionEnd = match.index + match[0].length + nextMatch.index;
    } else {
      sectionEnd = fileContent.length;
    }

    const updatedContent =
      fileContent.slice(0, match.index + match[0].length) +
      '\n' + newContent + '\n' +
      fileContent.slice(sectionEnd);

    await fs.writeFile(fullPath, updatedContent, 'utf-8');
    return { path: notePath, heading, replaced: true };
  }

  async insertAtMarker(notePath, marker, content, position = 'after') {
    const fullPath = path.join(this.vaultPath, notePath);
    let fileContent = await fs.readFile(fullPath, 'utf-8');

    const markerIndex = fileContent.indexOf(marker);
    if (markerIndex === -1) {
      throw new Error(`Marker "${marker}" not found in ${notePath}`);
    }

    let insertPos;
    if (position === 'after') {
      insertPos = markerIndex + marker.length;
    } else {
      insertPos = markerIndex;
    }

    const newContent =
      fileContent.slice(0, insertPos) +
      '\n' + content + '\n' +
      fileContent.slice(insertPos);

    await fs.writeFile(fullPath, newContent, 'utf-8');
    return { path: notePath, marker, inserted: true, position };
  }

  async readSection(notePath, heading) {
    const fullPath = path.join(this.vaultPath, notePath);
    const fileContent = await fs.readFile(fullPath, 'utf-8');

    const headingRegex = new RegExp(`^${heading}\\s*$`, 'm');
    const match = fileContent.match(headingRegex);

    if (!match) {
      throw new Error(`Heading "${heading}" not found in ${notePath}`);
    }

    const headingLevel = (heading.match(/^#+/) || ['#'])[0].length;
    const nextHeadingRegex = new RegExp(`^#{1,${headingLevel}}\\s+.+$`, 'm');

    const afterHeading = fileContent.slice(match.index + match[0].length);
    const nextMatch = afterHeading.match(nextHeadingRegex);

    let sectionEnd;
    if (nextMatch) {
      sectionEnd = match.index + match[0].length + nextMatch.index;
    } else {
      sectionEnd = fileContent.length;
    }

    const sectionContent = fileContent.slice(match.index + match[0].length, sectionEnd).trim();

    return { path: notePath, heading, content: sectionContent };
  }

  async listHeadings(notePath, level = null) {
    const fullPath = path.join(this.vaultPath, notePath);
    const fileContent = await fs.readFile(fullPath, 'utf-8');

    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings = [];
    let match;

    while ((match = headingRegex.exec(fileContent)) !== null) {
      const headingLevel = match[1].length;
      const headingText = match[2].trim();

      if (level === null || headingLevel === level) {
        headings.push({
          level: headingLevel,
          text: headingText,
          full: match[1] + ' ' + headingText
        });
      }
    }

    return { path: notePath, headings, count: headings.length };
  }

  // ============================================
  // Find and Replace
  // ============================================

  async findReplace(targetPath, find, replace, options = {}) {
    const {
      useRegex = false,
      caseSensitive = true,
      wholeWord = false,
      recursive = false,
      dryRun = false
    } = options;

    const fullPath = path.join(this.vaultPath, targetPath);
    const stats = await fs.stat(fullPath);
    const changes = [];

    if (stats.isDirectory()) {
      await this._findReplaceInDirectory(
        fullPath,
        targetPath,
        find,
        replace,
        { useRegex, caseSensitive, wholeWord, recursive, dryRun },
        changes
      );
    } else {
      await this._findReplaceInFile(
        fullPath,
        targetPath,
        find,
        replace,
        { useRegex, caseSensitive, wholeWord, dryRun },
        changes
      );
    }

    const filesModified = changes.filter(c => c.replacements > 0).length;
    const totalReplacements = changes.reduce((sum, c) => sum + c.replacements, 0);

    return {
      filesModified,
      totalReplacements,
      changes,
      dryRun
    };
  }

  async _findReplaceInDirectory(dirPath, relativePath, find, replace, options, changes) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      const entryRelativePath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        if (options.recursive) {
          await this._findReplaceInDirectory(
            fullPath,
            entryRelativePath,
            find,
            replace,
            options,
            changes
          );
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        await this._findReplaceInFile(
          fullPath,
          entryRelativePath,
          find,
          replace,
          options,
          changes
        );
      }
    }
  }

  async _findReplaceInFile(fullPath, relativePath, find, replace, options, changes) {
    let content = await fs.readFile(fullPath, 'utf-8');
    const originalContent = content;

    let pattern;
    if (options.useRegex) {
      const flags = options.caseSensitive ? 'g' : 'gi';
      pattern = new RegExp(find, flags);
    } else {
      let escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      if (options.wholeWord) {
        escapedFind = `\\b${escapedFind}\\b`;
      }

      const flags = options.caseSensitive ? 'g' : 'gi';
      pattern = new RegExp(escapedFind, flags);
    }

    const matches = content.match(pattern);
    const replacements = matches ? matches.length : 0;

    if (replacements > 0) {
      content = content.replace(pattern, replace);

      if (!options.dryRun) {
        await fs.writeFile(fullPath, content, 'utf-8');
      }

      changes.push({
        file: relativePath,
        replacements,
        preview: this._getReplacementPreview(originalContent, content, find, 3)
      });
    }
  }

  _getReplacementPreview(oldContent, newContent, find, maxExamples = 3) {
    const lines = oldContent.split('\n');
    const examples = [];

    for (let i = 0; i < lines.length && examples.length < maxExamples; i++) {
      if (lines[i].toLowerCase().includes(find.toLowerCase())) {
        examples.push({
          line: i + 1,
          before: lines[i].trim(),
          after: newContent.split('\n')[i].trim()
        });
      }
    }

    return examples;
  }
}
