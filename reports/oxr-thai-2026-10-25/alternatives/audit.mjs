// Verify frozen controls and retain local evidence hashes. Does not run inference.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]);
const baseline=path.resolve(process.argv[3]);
const dest=path.resolve(process.argv[4]);
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const oldManifest=await read(path.join(dest,'..','evidence-manifest.json'));
for(const [file,digest] of Object.entries(oldManifest.files))assert.equal(await hash(path.join(baseline,file)),digest,file);
const before=await read(path.join(root,'models-before-bounded.json'));
const after=await read(path.join(root,'models-after.json'));
assert.deepEqual(after,before,'Model bytes/package versions changed during offline inference');
const old=await read(path.join(baseline,'results.json'));
const current=await read(path.join(root,'results.json'));
for(const row of old.parsing)assert.deepEqual(current.parsing.find(x=>x.id===row.id&&x.parser===row.parser),row);
for(const arm of old.arms)assert.deepEqual(current.arms.find(x=>x.variant===arm.variant&&x.parser===arm.parser&&x.chunker===arm.chunker),arm);
const oldPrepared=await read(path.join(baseline,'prepared.json'));
const prepared=await read(path.join(root,'prepared.json'));
assert.deepEqual(prepared.records.slice(0,oldPrepared.records.length),oldPrepared.records);
const pdfs=(await fs.readdir(baseline)).filter(x=>x.endsWith('.pdf'));
assert.equal(pdfs.length,8);
for(const name of pdfs){
 const digest=await hash(path.join(baseline,name));
 assert.equal(await hash(path.join(root,name)),digest,name);
 for(const parser of ['docling','paddle1280']){
  const raw=await read(path.join(root,'parsed',name.replace('.pdf','-'+parser+'.json')));
  assert.equal(raw.inputSha256,digest);assert.equal(raw.status,'PARSED');
 }
}
assert.equal(current.arms.length,22);
assert.ok(current.arms.every(a=>a.tokenOverflow===0&&a.maxTokens<=512&&a.queries===24));
assert.ok(prepared.records.filter(r=>r.parser==='paddle1280').every(r=>r.unparsedTableBlocks===0));
const state=await read(path.join(root,'paddle-bounded-state.json'));
assert.equal(state.ExitCode,0);assert.equal(state.OOMKilled,false);
const summary={frozenEvidenceHashes:Object.keys(oldManifest.files).length,identicalPdfs:pdfs.length,
 unchangedParsingRows:old.parsing.length,unchangedRetrievalArms:old.arms.length,
 unchangedModelConfigFiles:after.models.length,evaluationArms:current.arms.length,
 tokenOverflows:0,completedDoclingInputs:8,completedPaddle1280Inputs:8};
await fs.writeFile(path.join(root,'audit.json'),JSON.stringify(summary,null,2));
const manifest=await read(path.join(dest,'evidence-manifest.json'));
const extra=['audit.json','models-before.json','models-before-bounded.json','models-after.json',
 'docling-runtime.json','docling-setup.json','docling-run.log',
 'paddle-setup.json','paddle-resolved-setup.yaml','paddle-runtime-attempt1.json','paddle-resolved-run-attempt1.yaml',
 'paddle-attempt1-events.jsonl','paddle-run.log','paddle-run2.log','paddle-run2-state.json','paddle-runtime.json','paddle-resolved-run.yaml',
 'paddle1280-runtime.json','paddle1280-resolved-run.yaml','paddle1280-resources.json','paddle-bounded.log','paddle-bounded-state.json',
 'build.log','govern.log','document-tests.log','metric-tests.log','chunker-regression.log','link-check.json','evaluate.py'];
for(const name of extra)manifest.files[name]=await hash(path.join(root,name));
manifest.parserImage='sha256:79397a0f5fea3a2445a1a15a684f67948211f5b369f055e054e8c531df4a3e34';
manifest.evaluatorImage='sha256:9bee2c31dc0efee6f2564eab273f9c815961a1635c08a29805849524974163e7';
manifest.sourceFiles={};
for(const name of ['Dockerfile','run_parser.py','prepare.mjs','fingerprint.py','audit.mjs','../prepare.mjs','../evaluate.py','../summarize.mjs','../test_metrics.py'])manifest.sourceFiles[name]=await hash(path.join(dest,name));
for(const [name,digest] of Object.entries(manifest.files))assert.equal(await hash(path.join(root,name)),digest);
await fs.writeFile(path.join(dest,'evidence-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({...summary,evidenceHashes:Object.keys(manifest.files).length},null,2));
