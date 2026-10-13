import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { VaultManager } from '../src/vault/VaultManager.js';

/**
 * Every VaultManager operation must stay inside VAULT_PATH. These tests use a
 * vault nested under a temp directory with a sibling "outside" directory, so an
 * escape is observable as a real file read or write.
 */
describe('VaultManager path containment', () => {
  let root;
  let vaultPath;
  let vaultManager;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-mcp-'));
    vaultPath = path.join(root, 'vault');
    await fs.mkdir(vaultPath, { recursive: true });
    await fs.writeFile(path.join(root, 'secret.txt'), 'outside the vault');
    await fs.writeFile(path.join(vaultPath, 'inside.md'), '# Inside');
    vaultManager = new VaultManager(vaultPath);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads a normal vault-relative path', async () => {
    const result = await vaultManager.readNote('inside.md');
    expect(result.content).toBe('# Inside');
  });

  it('treats a leading slash as vault-relative', async () => {
    const result = await vaultManager.readNote('/inside.md');
    expect(result.content).toBe('# Inside');
  });

  it('refuses ../ traversal on read', async () => {
    await expect(vaultManager.readNote('../secret.txt')).rejects.toThrow(/escapes vault/);
  });

  it('refuses nested traversal that resolves outside', async () => {
    await expect(vaultManager.readNote('a/b/../../../secret.txt')).rejects.toThrow(/escapes vault/);
  });

  it('contains an absolute path by treating it as vault-relative', async () => {
    // /tmp/.../secret.txt becomes <vault>/tmp/.../secret.txt, which does not exist.
    // The point is that the real file outside the vault is never reached.
    await expect(vaultManager.readNote(path.join(root, 'secret.txt'))).rejects.toThrow(/ENOENT/);
  });

  it('refuses NUL bytes', async () => {
    await expect(vaultManager.readNote('inside.md\0.txt')).rejects.toThrow(/Invalid path/);
  });

  it('refuses traversal on write, and writes nothing outside', async () => {
    await expect(vaultManager.writeNote('../escaped.md', 'x')).rejects.toThrow(/escapes vault/);
    await expect(fs.access(path.join(root, 'escaped.md'))).rejects.toThrow();
  });

  it('refuses traversal on delete', async () => {
    await expect(vaultManager.deleteNote('../secret.txt', { confirm: 'yes' })).rejects.toThrow(
      /escapes vault/
    );
    const stillThere = await fs.readFile(path.join(root, 'secret.txt'), 'utf-8');
    expect(stillThere).toBe('outside the vault');
  });

  it('refuses traversal on list-vault and directory operations', async () => {
    await expect(vaultManager.listVault('..')).rejects.toThrow(/escapes vault/);
    await expect(vaultManager.createDirectory('../newdir')).rejects.toThrow(/escapes vault/);
    await expect(vaultManager.moveNote('inside.md', '../moved.md')).rejects.toThrow(
      /escapes vault/
    );
  });

  it('refuses traversal through the directory option of search tools', async () => {
    await expect(vaultManager.searchVault('secret', { directory: '..' })).rejects.toThrow(
      /escapes vault/
    );
    await expect(vaultManager.listTags({ directory: '../' })).rejects.toThrow(/escapes vault/);
  });
});
