/**
 * Frontmatter parsing and serialization utilities
 * Uses gray-matter for robust YAML parsing
 */

import matter from 'gray-matter';
import type { Frontmatter, ParsedFrontmatter } from '../types/index.js';

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  try {
    const parsed = matter(content);

    // Check if there's actually frontmatter (gray-matter always returns data object)
    const hasFrontmatter = content.trim().startsWith('---');

    if (!hasFrontmatter || Object.keys(parsed.data).length === 0) {
      return { frontmatter: null, body: content, raw: null };
    }

    return {
      frontmatter: parsed.data as Frontmatter,
      body: parsed.content,
      raw: parsed.matter, // The raw YAML string between ---
    };
  } catch {
    // If gray-matter fails, return content as body with no frontmatter
    return { frontmatter: null, body: content, raw: null };
  }
}

/**
 * Serialize frontmatter object back to YAML string
 */
export function serializeFrontmatter(frontmatter: Frontmatter): string {
  // Use gray-matter's stringify but extract just the YAML portion
  const result = matter.stringify('', frontmatter);
  // Result is: ---\n{yaml}\n---\n
  // Extract just the YAML content
  const match = result.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    return match[1];
  }

  // Fallback: manual serialization for edge cases
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${item}`);
        }
      }
    } else if (value === null || value === undefined) {
      lines.push(`${key}:`);
    } else if (typeof value === 'object') {
      // Nested objects - simple one-level handling
      lines.push(`${key}:`);
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${subKey}: ${subValue}`);
      }
    } else {
      const strValue = String(value);
      if (
        strValue.includes(':') ||
        strValue.includes('#') ||
        strValue.includes("'") ||
        strValue.includes('"') ||
        strValue.includes('\n')
      ) {
        lines.push(`${key}: "${strValue.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${strValue}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Reconstruct full file content from frontmatter and body
 */
export function reconstructContent(frontmatter: Frontmatter | null, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return body;
  }
  const yaml = serializeFrontmatter(frontmatter);
  return `---\n${yaml}\n---\n${body}`;
}
