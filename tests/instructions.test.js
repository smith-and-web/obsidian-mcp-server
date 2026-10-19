import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstructions } from '../src/server/instructions.js';

describe('readInstructions', () => {
  it('returns undefined when nothing is configured', () => {
    expect(readInstructions({})).toBeUndefined();
  });

  it('reads MCP_INSTRUCTIONS inline, trimmed', () => {
    expect(readInstructions({ MCP_INSTRUCTIONS: '  Use me.\n' })).toBe('Use me.');
  });

  it('prefers MCP_INSTRUCTIONS_FILE over the inline value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'instr-'));
    const file = join(dir, 'instructions.md');
    writeFileSync(file, '# Brain\n\nSearch here first.\n');
    expect(readInstructions({ MCP_INSTRUCTIONS_FILE: file, MCP_INSTRUCTIONS: 'ignored' })).toBe(
      '# Brain\n\nSearch here first.'
    );
  });

  it('treats a blank value as no instructions', () => {
    expect(readInstructions({ MCP_INSTRUCTIONS: '   ' })).toBeUndefined();
  });

  it('throws when the configured file is missing', () => {
    expect(() =>
      readInstructions({ MCP_INSTRUCTIONS_FILE: '/nonexistent/instructions.md' })
    ).toThrow();
  });
});
