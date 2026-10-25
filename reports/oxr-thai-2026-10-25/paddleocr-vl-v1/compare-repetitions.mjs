// Blind repeat-consistency check; reads parser output only, never QA or gold.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {projectPages} from './paddle-html-adapter.mjs';

const root=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>fs.readFile(p);
const readJson=async p=>JSON.parse(await read(p));
const harnessLock=await readJson(path.join(root,'harness-lock.json'));
const harnessLockSha=(await fs.readFile(path.join(root,'harness-lock.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(await read(path.join(root,'harness-lock.json'))),harnessLockSha,'frozen harness lock digest mismatch');
assert.equal(harnessLock.status,'frozen-before-inference');
const amendmentBytes=await read(path.join(root,'protocol-amendment.json'));
const amendmentSha=(await fs.readFile(path.join(root,'protocol-amendment.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(amendmentBytes),amendmentSha,'frozen protocol amendment digest mismatch');
const amendment=JSON.parse(amendmentBytes);
assert.equal(amendment.pinnedHarness.sha256,harnessLockSha,'protocol amendment does not bind the harness lock');
const protocolBytes=await read(path.join(root,'protocol.json'));
const protocolSha=(await fs.readFile(path.join(root,'protocol.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(protocolBytes),protocolSha,'frozen protocol digest mismatch');
assert.equal(amendment.amends.sha256,protocolSha,'protocol amendment binds a different protocol');
for(const source of harnessLock.scripts){
 const file=path.resolve(process.cwd(),source.path);
 assert.equal(hash(await read(file)),source.sha256,`frozen harness source changed: ${source.path}`);
}
const expectedPageCoverage=new Map(amendment.controls.pageCoverage.expected.map(x=>[x.id,x]));
async function readRepeat(repetition,id){
 const directory=path.join(root,`inference/attempt-2/model-output/repeat-${repetition}`,id);
 const names=(await fs.readdir(directory)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const json=names.filter(n=>n.endsWith('.json'));
 const markdown=names.filter(n=>n.endsWith('.md'));
 assert.ok(json.length>0,`no JSON output for repeat ${repetition}/${id}`);
 const pages=[];
 for(const name of json){const value=await readJson(path.join(directory,name));pages.push(...(Array.isArray(value)?value:[value]));}
 const projection=projectPages(pages);
 const expected=expectedPageCoverage.get(id);
 assert.ok(expected,`frozen expected page count missing for ${id}`);
 assert.equal(json.length,expected.count,`repeat ${repetition}/${id}: JSON count differs from PDF page count`);
 assert.deepEqual(projection.pages.map(p=>p.page_index),expected.pageIndexes,`repeat ${repetition}/${id}: page_index coverage is incomplete, duplicated or reordered`);
 const semantic={pageCount:projection.pages.length,text:projection.text,tables:projection.tables.map(t=>({page:t.page,rows:t.rows,html:t.html}))};
 return {semanticSha256:hash(JSON.stringify(semantic)),projectionSha256:hash(projection.text),tableCount:projection.tables.length,pageCount:projection.pages.length,
  json:await Promise.all(json.map(async name=>({name,sha256:hash(await fs.readFile(path.join(directory,name)))}))),
  markdown:await Promise.all(markdown.map(async name=>({name,sha256:hash(await fs.readFile(path.join(directory,name)))})))};
}
const documents=[];
for(const id of ['economy','population']){
 const first=await readRepeat(1,id),second=await readRepeat(2,id);
 documents.push({id,repeat1:first,repeat2:second,semanticMatch:first.semanticSha256===second.semanticSha256,projectionMatch:first.projectionSha256===second.projectionSha256,
  markdownMatch:JSON.stringify(first.markdown.map(x=>x.sha256))===JSON.stringify(second.markdown.map(x=>x.sha256))});
}
const result={selection:'repeat-1 is the predeclared primary; repeat-2 is diagnostic only. No evaluation-gold-based choice.',documents,
 allSemanticMatch:documents.every(d=>d.semanticMatch),allProjectionMatch:documents.every(d=>d.projectionMatch)};
await fs.writeFile(path.join(root,'repeat-consistency.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({allSemanticMatch:result.allSemanticMatch,allProjectionMatch:result.allProjectionMatch,documents:documents.map(({id,semanticMatch,projectionMatch,markdownMatch})=>({id,semanticMatch,projectionMatch,markdownMatch}))},null,2));
