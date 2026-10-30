import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { atomicFrontmatterEdit, sameExceptKey } from '../src/vault/atomicEdit.js';
import { setFrontmatterField } from '../src/vault/frontmatter.js';
const now = new Date('2026-11-01T12:00:00Z');
const opts = { now, minAgeMs: 0, onlyKey: 'heat' };
const edit = doc => setFrontmatterField(doc, 'heat', 3);
let root;
afterEach(async () => { vi.restoreAllMocks(); if(root) await fs.rm(root, {recursive:true,force:true}); });
async function fixture(text) { root = await fs.mkdtemp(path.join(os.tmpdir(),'heat-')); const file=path.join(root,'x.md'); await fs.writeFile(file,text); await fs.utimes(file,new Date(0),new Date(0)); return file; }
describe('atomic frontmatter edits', () => {
  it('compares all lines except the named top-level key', () => { expect(sameExceptKey('a\nheat: 1\n','a\nheat: 3\n','heat')).toBe(true); expect(sameExceptKey('a\nheat: 1\n','b\nheat: 3\n','heat')).toBe(false); });
  it('adds a number and detects an unchanged edit', async () => { const file=await fixture('---\ntitle: X\n---\nBody\n'); expect(await atomicFrontmatterEdit(file,edit,opts)).toBe('written'); expect(await fs.readFile(file,'utf8')).toContain('heat: 3\n'); expect(await atomicFrontmatterEdit(file,edit,opts)).toBe('unchanged'); });
  it('skips recent and missing files', async () => { const file=await fixture('---\ntitle: X\n---\n'); await fs.utimes(file,new Date(now-60000),new Date(now-60000)); expect(await atomicFrontmatterEdit(file,edit,{...opts,minAgeMs:1800000})).toBe('recent'); expect(await atomicFrontmatterEdit(file+'missing',edit,opts)).toBe('missing'); });
  it('rejects invalid and absent frontmatter', async () => { for(const text of ['---\ntitle: a: b\n---\n','Body only']) { const file=await fixture(text); expect(await atomicFrontmatterEdit(file,edit,opts)).toBe('invalid'); expect(await fs.readFile(file,'utf8')).toBe(text); await fs.rm(root,{recursive:true}); } });
  it('rejects restyling and reports it during checkOnly', async () => { const text='---\ntitle: X\ntags:\n    - one\n---\nBody\n'; const file=await fixture(text); for(const checkOnly of [false,true]) expect(await atomicFrontmatterEdit(file,edit,{...opts,checkOnly})).toBe('roundtrip'); expect(await fs.readFile(file,'utf8')).toBe(text); });
  it('detects a change between stats and cleans the temp file', async () => { const file=await fixture('---\ntitle: X\n---\nBody\n'); const real=fs.stat.bind(fs); let calls=0; vi.spyOn(fs,'stat').mockImplementation(async (...args) => { if(args[0]===file && ++calls===2) await fs.writeFile(file,'concurrent edit'); return real(...args); }); expect(await atomicFrontmatterEdit(file,edit,opts)).toBe('raced'); expect(await fs.readFile(file,'utf8')).toBe('concurrent edit'); expect(await fs.readdir(root)).toEqual(['x.md']); });
});
