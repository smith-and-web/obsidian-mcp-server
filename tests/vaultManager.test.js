import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { VaultManager } from '../src/vault/VaultManager.js';

const TEST_VAULT = './tests/fixtures/vault';

describe('VaultManager', () => {
  let vaultManager;

  beforeEach(async () => {
    // Create test vault directory
    await fs.mkdir(TEST_VAULT, { recursive: true });
    vaultManager = new VaultManager(TEST_VAULT);
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(TEST_VAULT, { recursive: true, force: true });
  });

  describe('createNote', () => {
    it('should create a new note', async () => {
      const result = await vaultManager.createNote('test.md', '# Test');

      expect(result.created).toBe(true);
      expect(result.path).toBe('test.md');

      const content = await fs.readFile(path.join(TEST_VAULT, 'test.md'), 'utf-8');
      expect(content).toBe('# Test');
    });

    it('should create note in nested directory', async () => {
      const result = await vaultManager.createNote('folder/nested/test.md', '# Nested');

      expect(result.created).toBe(true);

      const content = await fs.readFile(path.join(TEST_VAULT, 'folder/nested/test.md'), 'utf-8');
      expect(content).toBe('# Nested');
    });
  });

  describe('readNote', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(TEST_VAULT, 'read-test.md'), '# Read Test\n\nContent');
    });

    it('should read a note', async () => {
      const result = await vaultManager.readNote('read-test.md');

      expect(result.path).toBe('read-test.md');
      expect(result.content).toContain('# Read Test');
    });

    it('should read frontmatter only when requested', async () => {
      await fs.writeFile(
        path.join(TEST_VAULT, 'frontmatter.md'),
        '---\ntitle: Test\n---\n\n# Content'
      );

      const result = await vaultManager.readNote('frontmatter.md', { frontmatterOnly: true });

      expect(result.hasFrontmatter).toBe(true);
      expect(result.frontmatter).toEqual({ title: 'Test' });
      expect(result.content).toBeUndefined();
    });
  });

  describe('deleteNote', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(TEST_VAULT, 'delete-me.md'), '# To Delete');
    });

    it('should reject deletion without confirmation', async () => {
      const result = await vaultManager.deleteNote('delete-me.md');

      expect(result.deleted).toBe(false);
      expect(result.error).toContain('Safety check failed');
    });

    it('should reject deletion with wrong confirmation', async () => {
      const result = await vaultManager.deleteNote('delete-me.md', { confirm: 'wrong.md' });

      expect(result.deleted).toBe(false);
    });

    it('should delete with correct confirmation', async () => {
      const result = await vaultManager.deleteNote('delete-me.md', { confirm: 'delete-me.md' });

      expect(result.deleted).toBe(true);

      await expect(fs.access(path.join(TEST_VAULT, 'delete-me.md'))).rejects.toThrow();
    });
  });

  describe('writeNote', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(TEST_VAULT, 'existing.md'), 'Original content');
    });

    it('should overwrite content', async () => {
      const result = await vaultManager.writeNote('existing.md', 'New content', {
        mode: 'overwrite',
      });

      expect(result.written).toBe(true);
      expect(result.mode).toBe('overwrite');

      const content = await fs.readFile(path.join(TEST_VAULT, 'existing.md'), 'utf-8');
      expect(content).toBe('New content');
    });

    it('should append content', async () => {
      const result = await vaultManager.writeNote('existing.md', ' appended', { mode: 'append' });

      expect(result.written).toBe(true);

      const content = await fs.readFile(path.join(TEST_VAULT, 'existing.md'), 'utf-8');
      expect(content).toBe('Original content appended');
    });

    it('should prepend content', async () => {
      const result = await vaultManager.writeNote('existing.md', 'prepended ', {
        mode: 'prepend',
      });

      expect(result.written).toBe(true);

      const content = await fs.readFile(path.join(TEST_VAULT, 'existing.md'), 'utf-8');
      expect(content).toBe('prepended Original content');
    });
  });

  describe('getNotesInfo', () => {
    beforeEach(async () => {
      await fs.writeFile(
        path.join(TEST_VAULT, 'info1.md'),
        '---\ntitle: Test\n---\n\n# Content'
      );
      await fs.writeFile(path.join(TEST_VAULT, 'info2.md'), '# No frontmatter');
    });

    it('should return info for single file', async () => {
      const result = await vaultManager.getNotesInfo('info1.md');

      expect(result.successful).toBe(1);
      expect(result.results[0].hasFrontmatter).toBe(true);
      expect(result.results[0].name).toBe('info1');
    });

    it('should return info for multiple files', async () => {
      const result = await vaultManager.getNotesInfo(['info1.md', 'info2.md']);

      expect(result.successful).toBe(2);
      expect(result.results[0].hasFrontmatter).toBe(true);
      expect(result.results[1].hasFrontmatter).toBe(false);
    });

    it('should handle missing files gracefully', async () => {
      const result = await vaultManager.getNotesInfo(['info1.md', 'nonexistent.md']);

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('compact responses', () => {
    it('should minify keys when enabled', async () => {
      const compactManager = new VaultManager(TEST_VAULT, { compactResponses: true });
      await fs.writeFile(path.join(TEST_VAULT, 'compact.md'), '# Test');

      const result = await compactManager.getNotesInfo('compact.md');

      // Should use minified keys
      expect(result.ok).toBe(1); // 'successful' -> 'ok'
      expect(result.r).toBeDefined(); // 'results' -> 'r'
    });
  });
});
