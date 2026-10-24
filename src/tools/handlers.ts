/**
 * MCP Tool Handlers
 * Maps tool names to VaultManager method calls
 */

import type { VaultManager } from '../vault/VaultManager.js';
import type { SearchService } from '../index/SearchService.js';
import { BUILTIN_PATTERNS, isSensitive } from '../learn/redact.js';
import { normalisePath } from '../learn/log.js';
import { NO_CONTEXT, type CallContext, type LearnLog } from '../learn/log.js';

export interface ToolArguments {
  path?: string;
  paths?: string | string[];
  content?: string;
  frontmatterOnly?: boolean;
  confirm?: string;
  from?: string;
  to?: string;
  source?: string;
  destination?: string;
  mode?: 'overwrite' | 'append' | 'prepend' | 'hybrid' | 'vector' | 'text';
  recursive?: boolean;
  directory?: string;
  updates?: Record<string, unknown>;
  createIfMissing?: boolean;
  tags?: string[];
  location?: 'frontmatter' | 'inline' | 'both';
  includeFiles?: boolean;
  tag?: string;
  matchExact?: boolean;
  requiredTags?: string[];
  query?: string;
  searchContent?: boolean;
  searchFilenames?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  includeContext?: boolean;
  contextLines?: number;
  heading?: string;
  marker?: string;
  position?: 'before' | 'after';
  level?: number;
  find?: string;
  replace?: string;
  useRegex?: boolean;
  wholeWord?: boolean;
  dryRun?: boolean;
  k?: number;
  type?: string;
  status?: string;
  requestId?: string;
  rating?: string;
  usedPaths?: string[];
  expectedPaths?: string[];
  note?: string;
  positive?: string[];
  negative?: string[];
  strategy?: string;
  finding?: string;
  decision?: string;
}

/**
 * Execute a tool call against the VaultManager
 */
export async function executeToolCall(
  name: string,
  args: ToolArguments,
  vaultManager: VaultManager,
  search?: SearchService | null,
  ctx: CallContext = NO_CONTEXT,
  learn: LearnLog | null = null
): Promise<unknown> {
  switch (name) {
    // Note Operations
    case 'read-note': {
      const result = await vaultManager.readNote(args.path!, {
        frontmatterOnly: args.frontmatterOnly,
      });
      learn?.logReads(ctx, name, [args.path!], args.requestId ?? null);
      return result;
    }
    case 'read-multiple-notes': {
      const result = await vaultManager.readMultipleNotes(args.paths as string[], {
        frontmatterOnly: args.frontmatterOnly,
      });
      learn?.logReads(
        ctx,
        name,
        result.results.map(r => r.path),
        args.requestId ?? null
      );
      return result;
    }
    case 'create-note':
      return vaultManager.createNote(args.path!, args.content!);
    case 'edit-note':
      return vaultManager.editNote(args.path!, args.content!);
    case 'delete-note':
      return vaultManager.deleteNote(args.path!, { confirm: args.confirm });
    case 'move-note':
      return vaultManager.moveNote(args.from!, args.to!);
    case 'duplicate-note':
      return vaultManager.duplicateNote(args.source!, args.destination!);
    case 'write-note':
      return vaultManager.writeNote(args.path!, args.content!, {
        mode: args.mode as 'overwrite' | 'append' | 'prepend' | undefined,
      });
    case 'get-notes-info':
      return vaultManager.getNotesInfo(args.paths!);

    // Directory Operations
    case 'create-directory':
      return vaultManager.createDirectory(args.path!);
    case 'delete-directory':
      return vaultManager.deleteDirectory(args.path!, { recursive: args.recursive });
    case 'rename-directory':
      return vaultManager.renameDirectory(args.from!, args.to!);
    case 'list-vault':
      return vaultManager.listVault(args.directory);

    // Frontmatter Operations
    case 'get-frontmatter':
      return vaultManager.getFrontmatter(args.path!);
    case 'update-frontmatter':
      return vaultManager.updateFrontmatter(args.path!, args.updates!, {
        createIfMissing: args.createIfMissing,
      });

    // Tag Operations
    case 'add-tags':
      return vaultManager.addTags(args.path!, args.tags!, {
        location: args.location as 'frontmatter' | 'inline',
      });
    case 'remove-tags':
      return vaultManager.removeTags(args.path!, args.tags!, {
        location: args.location as 'frontmatter' | 'inline' | 'both',
      });
    case 'list-tags':
      return vaultManager.listTags({ directory: args.directory, includeFiles: args.includeFiles });
    case 'find-notes-by-tag':
      return vaultManager.findNotesByTag(args.tag!, {
        directory: args.directory,
        matchExact: args.matchExact,
      });
    case 'search-missing-tag':
      return vaultManager.searchMissingTag(args.tag!, { directory: args.directory });
    case 'audit-tags':
      return vaultManager.auditTags(args.directory!, args.requiredTags!);

    // Search Operations
    case 'search-vault': {
      const result = await vaultManager.searchVault(args.query!, {
        directory: args.directory,
        searchContent: args.searchContent,
        searchFilenames: args.searchFilenames,
        caseSensitive: args.caseSensitive,
        maxResults: args.maxResults,
        includeContext: args.includeContext,
        contextLines: args.contextLines,
      });
      if (!learn || !args.query!.trim()) return result;
      const id = learn.newRequestId();
      learn.logSearch({
        id,
        ctx,
        tool: name,
        query: args.query!.trim(),
        embedding: null,
        params: {
          directory: args.directory,
          searchContent: args.searchContent,
          searchFilenames: args.searchFilenames,
          caseSensitive: args.caseSensitive,
          maxResults: args.maxResults,
        },
        ranker: 'text-scan',
        results: result.results.map((r, i) => ({ path: r.path, rank: i + 1 })),
      });
      return { ...result, requestId: id };
    }

    // Link Operations
    case 'get-backlinks':
      return vaultManager.getBacklinks(args.path!, { directory: args.directory });
    case 'find-broken-links':
      return vaultManager.findBrokenLinks({ directory: args.directory });

    // Section Operations
    case 'append-to-file':
      return vaultManager.appendToFile(args.path!, args.content!);
    case 'append-to-section':
      return vaultManager.appendToSection(args.path!, args.heading!, args.content!);
    case 'replace-section':
      return vaultManager.replaceSection(args.path!, args.heading!, args.content!);
    case 'insert-at-marker':
      return vaultManager.insertAtMarker(args.path!, args.marker!, args.content!, args.position);
    case 'read-section': {
      const result = await vaultManager.readSection(args.path!, args.heading!);
      learn?.logReads(ctx, name, [args.path!], args.requestId ?? null);
      return result;
    }
    case 'list-headings':
      return vaultManager.listHeadings(args.path!, args.level ?? null);

    // Find and Replace
    case 'find-replace':
      return vaultManager.findReplace(args.path!, args.find!, args.replace!, {
        useRegex: args.useRegex,
        caseSensitive: args.caseSensitive,
        wholeWord: args.wholeWord,
        recursive: args.recursive,
        dryRun: args.dryRun,
      });

    // Semantic Search (optional)
    case 'semantic-search':
      return requireSearch(search, name).semanticSearch(
        args.query!,
        {
          k: args.k,
          mode: args.mode as 'hybrid' | 'vector' | 'text' | undefined,
          directory: args.directory,
          tags: args.tags,
          type: args.type,
          status: args.status,
        },
        ctx
      );
    case 'similar-notes':
      return requireSearch(search, name).similarNotes(args.path!, args.k, ctx);
    case 'search-feedback':
      if (!learn) throw new Error('search-feedback requires LEARN_LOG=true and semantic search');
      return learn.recordFeedback(args);
    case 'recommend-notes': {
      const service = requireSearch(search, name);
      for (const [field, values, min] of [
        ['positive', args.positive, 1],
        ['negative', args.negative === undefined ? [] : args.negative, 0],
      ] as const) {
        if (
          !Array.isArray(values) ||
          values.length < min ||
          values.length > 10 ||
          values.some(v => typeof v !== 'string')
        )
          throw new Error(`Invalid ${field}: expected ${min} to 10 strings`);
      }
      const k = args.k === undefined ? 10 : args.k;
      if (!Number.isInteger(k) || k < 1 || k > 50)
        throw new Error('Invalid k: expected an integer from 1 to 50');
      const strategy = args.strategy ?? 'best_score';
      if (strategy !== 'best_score' && strategy !== 'average_vector')
        throw new Error('Invalid strategy: expected best_score or average_vector');
      const positive = args.positive!.map(normalisePath),
        negative = (args.negative === undefined ? [] : args.negative).map(normalisePath);
      const missing = await service.store.missingPaths([...positive, ...negative]);
      if (missing.length) throw new Error(`Unknown notes: ${missing.join(', ')}`);
      const results = await service.store.recommendNotes({
        positive,
        negative,
        k,
        strategy,
        type: args.type,
        directory: args.directory,
      });
      return { strategy, positive, negative, results };
    }
    case 'maintenance-decision': {
      const service = requireSearch(search, name);
      if (typeof args.finding !== 'string' || !/^f?(\d+)$/.test(args.finding))
        throw new Error('Invalid finding: expected an id like f17');
      if (args.decision !== 'accept' && args.decision !== 'reject')
        throw new Error('Invalid decision: expected accept or reject');
      const id = Number(args.finding.replace(/^f/, ''));
      const note =
        typeof args.note === 'string' &&
        !isSensitive(args.note, learn?.patterns ?? BUILTIN_PATTERNS)
          ? args.note
          : null;
      const row = await service.store.decideFinding(
        id,
        args.decision === 'accept' ? 'accepted' : 'rejected',
        'tool',
        note,
        false
      );
      if (!row) return { recorded: false, reason: 'unknown finding' };
      await service.store.refreshClassCounts();
      return {
        recorded: true,
        finding: { id: `f${row.id}`, class: row.class, paths: row.paths, status: row.status },
      };
    }
    case 'index-status':
      return requireSearch(search, name).indexStatus();
    case 'reindex-note':
      return requireSearch(search, name).reindexNote(args.path!);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function requireSearch(search: SearchService | null | undefined, tool: string): SearchService {
  if (!search) {
    throw new Error(
      `${tool} is unavailable: semantic search is not configured (DATABASE_URL unset)`
    );
  }
  return search;
}
