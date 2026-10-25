// Failure-path fixtures only: these never produce native acceptance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const source=path.dirname(fileURLToPath(import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const mode of ['missing','failed'])test(`evaluator preserves both ${mode} arms and exits nonzero`,async()=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'zuri-thai-evaluator-test-'));
 try{
  const raw=path.join(base,'raw');await fs.mkdir(raw);
  for(const name of ['evaluate.mjs','metrics.mjs','gold.json'])await fs.copyFile(path.join(source,name),path.join(base,name));
  const goldBytes=await fs.readFile(path.join(base,'gold.json')),gold=JSON.parse(goldBytes);
  const put=async(name,value)=>{const file=path.join(raw,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value));};
  await put('frozen-inputs.json',{goldSha256:hash(goldBytes).toUpperCase(),files:{}});
  await put('projected.json',[]);await put('native-input.json',{arms:[]});
  for(const arm of ['baseline','paddle']){
   for(const repetition of [1,2]){
    await put(`${arm}-${repetition}-state.json`,{ExitCode:0,OOMKilled:false,StartedAt:'2000-01-01T00:00:00Z',FinishedAt:'2000-01-01T00:00:01Z'});
    await put(`${arm}-${repetition}/resources.json`,{memoryPeakBytes:0});
    for(const doc of gold.documents)await put(`${arm}-${repetition}/${doc.id}.json`,{status:'TEST_FIXTURE',elapsedMs:0});
   }
   if(mode==='failed')await put(`native-${arm}/native-results.json`,{status:'FAILED',error:{message:'unit fixture failure'},queries:[]});
   else if(arm==='paddle')await put(`native-${arm}-state.json`,{ExitCode:1});
  }
  const run=spawnSync(process.execPath,[path.join(base,'evaluate.mjs'),raw],{encoding:'utf8'});
  assert.equal(run.status,1,run.stderr);
  const report=JSON.parse(await fs.readFile(path.join(base,'measurement-summary.json'),'utf8'));
  assert.deepEqual(report.native.map(r=>r.status),mode==='failed'?['FAILED','FAILED']:['NOT_RUN','HARNESS_FAILED']);
 }finally{
  assert.equal(path.dirname(base),path.resolve(os.tmpdir()));
  assert.ok(path.basename(base).startsWith('zuri-thai-evaluator-test-'));
  await fs.rm(base,{recursive:true,force:true});
 }
});
