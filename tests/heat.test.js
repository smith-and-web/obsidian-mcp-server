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
  it('compares all lines except the named top-level key', () => { expect(sameExceptKey('---\na: X\nheat: 1\n---\n','---\na: X\nheat: 3\n---\n','heat')).toBe(true); expect(sameExceptKey('---\na: X\nheat: 1\n---\n','---\nb: X\nheat: 3\n---\n','heat')).toBe(false); });
  it('adds a number and detects an unchanged edit', async () => { const file=await fixture('---\ntitle: X\n---\nBody\n'); expect(await atomicFrontmatterEdit(file,edit,opts)).toBe('written'); expect(await fs.readFile(file,'utf8')).toContain('heat: 3\n'); expect(await atomicFrontmatterEdit(file,edit,opts)).toBe('unchanged'); });
  it('skips recent and missing files', async () => { const file=await fixture('---\ntitle: X\n---\n'); await fs.utimes(file,new Date(now-60000),new Date(now-60000)); expect(await atomicFrontmatterEdit(file,edit,{...opts,minAgeMs:1800000})).toBe('recent'); expect(await atomicFrontmatterEdit(file+'missing',edit,opts)).toBe('missing'); });
  it('rejects invalid and absent frontmatter', async () => { for(const text of ['---\ntitle: a: b\n---\n','Body only']) { const file=await fixture(text); expect(await atomicFrontmatterEdit(file,edit,opts)).toBe('invalid'); expect(await fs.readFile(file,'utf8')).toBe(text); await fs.rm(root,{recursive:true}); } });
  it('rejects restyling and reports it during checkOnly', async () => { const text='---\ntitle: X\ntags:\n    - one\n---\nBody\n'; const file=await fixture(text); for(const checkOnly of [false,true]) expect(await atomicFrontmatterEdit(file,edit,{...opts,checkOnly})).toBe('roundtrip'); expect(await fs.readFile(file,'utf8')).toBe(text); });
  it('detects a change between stats and cleans the temp file', async () => { const file=await fixture('---\ntitle: X\n---\nBody\n'); const real=fs.stat.bind(fs); let calls=0; vi.spyOn(fs,'stat').mockImplementation(async (...args) => { if(args[0]===file && ++calls===2) await fs.writeFile(file,'concurrent edit'); return real(...args); }); expect(await atomicFrontmatterEdit(file,edit,opts)).toBe('raced'); expect(await fs.readFile(file,'utf8')).toBe('concurrent edit'); expect(await fs.readdir(root)).toEqual(['x.md']); });
});

describe('complete YAML field guard', () => {
  it('removes block lists while preserving unrelated bytes', async () => {
    const before='---\ntitle: Child\nup:\n  - "[[Hub]]"\nupdated: "2026-10-01"\n---\nup: body text\n';
    const file=await fixture(before);
    expect(await atomicFrontmatterEdit(file,d=>setFrontmatterField(d,'up',null),{...opts,onlyKey:'up'})).toBe('written');
    expect(await fs.readFile(file,'utf8')).toBe('---\ntitle: Child\nupdated: "2026-10-01"\n---\nup: body text\n');
  });
  it('rejects unrelated YAML and body changes even when their text starts with the key', () => {
    const before='---\nup: ["[[Hub]]"]\ntitle: Child\n---\nup: body\n';
    expect(sameExceptKey(before,before.replace('Child','Other'),'up')).toBe(false);
    expect(sameExceptKey(before,before.replace('up: body','up: changed'),'up')).toBe(false);
  });
});

import { writeHeat } from '../src/trails/heat.js';
const config = () => ({ vaultPath:root, heatTypes:['reference'],heatMinAgeMinutes:30,heatMaxWrites:400 });
describe('heat writer',()=>{
 it('writes numbers, skips unchanged and absent zero, and clears every type',async()=>{
  const text='---\ntitle: X\nupdated: "2026-10-01"\n---\nBody\n';const file=await fixture(text);
  const store={heatCandidates:async(types,clear)=>{expect(clear ? true : types.includes('reference')).toBe(true);return [{path:'x.md',bucket:3}];}};
  expect((await writeHeat(store,config(),{now,clear:false})).heatWrites).toBe(1);
  expect((await writeHeat(store,config(),{now:new Date('2027-01-01'),clear:false})).heatUnchanged).toBe(1);
  expect((await writeHeat(store,{...config(),heatTypes:[]},{now,clear:true})).heatWrites).toBe(1);expect(await fs.readFile(file,'utf8')).toBe(text);
  const stat=await fs.stat(file);expect((await writeHeat({heatCandidates:async()=>[{path:'x.md',bucket:0}]},config(),{now,clear:false})).heatUnchanged).toBe(1);expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);
 });
 it('skips recent files, reports invalid/missing and checks round trips without writes',async()=>{
  const file=await fixture('---\ntitle: X\n---\n');await fs.utimes(file,new Date(now-60000),new Date(now-60000));const store={heatCandidates:async()=>[{path:'x.md',bucket:2}]};expect((await writeHeat(store,config(),{now,clear:false})).heatSkippedRecent).toBe(1);
  await fs.writeFile(file,'---\ntitle: X\ntags:\n    - one\n---\n');const before=await fs.readFile(file,'utf8');expect((await writeHeat(store,config(),{now,clear:false,checkOnly:true})).roundTripFailures).toEqual(['x.md']);expect(await fs.readFile(file,'utf8')).toBe(before);
  await fs.writeFile(file,'---\ntitle: a: b\n---\n');expect((await writeHeat(store,config(),{now,clear:false})).heatSkippedInvalid).toBe(1);
  await fs.rm(file);expect((await writeHeat(store,config(),{now,clear:false})).heatSkippedMissing).toBe(1);
 });
 it('stops after N successful writes',async()=>{
  await fixture('---\ntitle: X\n---\n');await fs.copyFile(path.join(root,'x.md'),path.join(root,'y.md'));await fs.utimes(path.join(root,'y.md'),new Date(0),new Date(0));
  const store={heatCandidates:async()=>[{path:'x.md',bucket:1},{path:'y.md',bucket:2}]};const result=await writeHeat(store,{...config(),heatMaxWrites:1},{now,clear:false});expect(result.heatWrites).toBe(1);expect(result.heatCapped).toBe(1);expect(await fs.readFile(path.join(root,'y.md'),'utf8')).not.toContain('heat:');
 });
});
