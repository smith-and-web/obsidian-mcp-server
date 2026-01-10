/**
 * Type definitions for Obsidian MCP Server
 */

// Frontmatter types
export interface Frontmatter {
  [key: string]: unknown;
}

export interface ParsedFrontmatter {
  frontmatter: Frontmatter | null;
  body: string;
  raw: string | null;
}

// Note operations
export interface ReadNoteOptions {
  frontmatterOnly?: boolean;
}

export interface ReadNoteResult {
  path: string;
  content?: string;
  hasFrontmatter?: boolean;
  frontmatter?: Frontmatter | null;
  raw?: string | null;
}

export interface ReadMultipleNotesResult {
  totalRequested: number;
  successful: number;
  failed: number;
  results: ReadNoteResult[];
  errors?: Array<{ path: string; error: string }>;
}

export interface WriteNoteOptions {
  mode?: 'overwrite' | 'append' | 'prepend';
}

export interface WriteNoteResult {
  path: string;
  mode: string;
  written: boolean;
}

export interface DeleteNoteOptions {
  confirm?: string;
}

export interface DeleteNoteResult {
  path: string;
  deleted: boolean;
  error?: string;
}

export interface MoveNoteResult {
  from: string;
  to: string;
  moved: boolean;
}

export interface DuplicateNoteResult {
  source: string;
  destination: string;
  duplicated: boolean;
}

// File info
export interface NoteInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified: string;
  created: string;
  hasFrontmatter: boolean;
}

export interface GetNotesInfoResult {
  totalRequested: number;
  successful: number;
  failed: number;
  results: NoteInfo[];
  errors?: Array<{ path: string; error: string }>;
}

// Directory operations
export interface DirectoryResult {
  path: string;
  created?: boolean;
  deleted?: boolean;
  renamed?: boolean;
}

export interface DeleteDirectoryOptions {
  recursive?: boolean;
}

export interface ListVaultResult {
  directory: string;
  files: string[];
  directories: string[];
}

// Frontmatter operations
export interface GetFrontmatterResult {
  path: string;
  hasFrontmatter: boolean;
  frontmatter: Frontmatter | null;
  raw: string | null;
}

export interface UpdateFrontmatterOptions {
  createIfMissing?: boolean;
}

export interface UpdateFrontmatterResult {
  path: string;
  updated: boolean;
  frontmatter: Frontmatter;
}

// Tag operations
export interface AddTagsOptions {
  location?: 'frontmatter' | 'inline';
}

export interface RemoveTagsOptions {
  location?: 'frontmatter' | 'inline' | 'both';
}

export interface TagResult {
  path: string;
  tags: string[];
  added?: string[];
  removed?: string[];
  location?: string;
}

export interface ListTagsOptions {
  directory?: string;
  includeFiles?: boolean;
}

export interface TagInfo {
  tag: string;
  count: number;
  files?: string[];
}

export interface ListTagsResult {
  directory: string;
  totalTags: number;
  totalUsages: number;
  tags: TagInfo[];
}

export interface FindNotesByTagOptions {
  directory?: string;
  matchExact?: boolean;
}

export interface FindNotesByTagResult {
  tag: string;
  directory: string;
  matchExact: boolean;
  totalFiles: number;
  files: string[];
}

export interface SearchMissingTagResult {
  tag: string;
  directory: string;
  totalFiles: number;
  files: string[];
}

export interface AuditTagsResult {
  directory: string;
  requiredTags: string[];
  totalFiles: number;
  compliant: number;
  nonCompliant: number;
  results: Array<{
    path: string;
    missingTags: string[];
  }>;
}

// Search operations
export interface SearchOptions {
  directory?: string;
  searchContent?: boolean;
  searchFilenames?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  includeContext?: boolean;
  contextLines?: number;
}

export interface SearchMatch {
  line: number;
  content: string;
  context?: {
    before: Array<{ line: number; content: string }>;
    after: Array<{ line: number; content: string }>;
  };
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
  filenameMatch?: boolean;
}

export interface SearchResult {
  query: string;
  options: SearchOptions;
  totalMatches: number;
  filesMatched: number;
  results: SearchFileResult[];
}

// Link operations
export interface BacklinkResult {
  path: string;
  directory: string;
  totalBacklinks: number;
  backlinks: Array<{
    path: string;
    lines: number[];
  }>;
}

export interface BrokenLink {
  link: string;
  line: number;
}

export interface BrokenLinksResult {
  directory: string;
  totalBrokenLinks: number;
  filesWithBrokenLinks: number;
  results: Array<{
    path: string;
    brokenLinks: BrokenLink[];
  }>;
}

// Section operations
export interface AppendResult {
  path: string;
  appended: boolean;
}

export interface SectionResult {
  path: string;
  heading: string;
  replaced?: boolean;
  appended?: boolean;
}

export interface InsertAtMarkerResult {
  path: string;
  marker: string;
  position: string;
  inserted: boolean;
}

export interface ReadSectionResult {
  path: string;
  heading: string;
  content: string;
}

export interface HeadingInfo {
  level: number;
  text: string;
  line: number;
}

export interface ListHeadingsResult {
  path: string;
  headings: HeadingInfo[];
}

// Find and replace
export interface FindReplaceOptions {
  useRegex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  recursive?: boolean;
  dryRun?: boolean;
}

export interface FindReplaceFileResult {
  path: string;
  replacements: number;
  matches?: Array<{
    line: number;
    before: string;
    after: string;
  }>;
}

export interface FindReplaceResult {
  find: string;
  replace: string;
  options: FindReplaceOptions;
  totalFiles: number;
  totalReplacements: number;
  dryRun: boolean;
  results: FindReplaceFileResult[];
}

// VaultManager options
export interface VaultManagerOptions {
  compactResponses?: boolean;
}

// Compact key mapping
export interface CompactKeyMap {
  [key: string]: string;
}
