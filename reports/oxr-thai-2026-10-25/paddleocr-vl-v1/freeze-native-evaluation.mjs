// Freeze the actual native evaluation inputs and runner before gold is mounted.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const report=path.resolve('reports/oxr-thai-2026-10-25/paddleocr-vl-v1');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>fs.readFile(p);
const readJson=async p=>JSON.parse(await read(p));
const lockBytes=await read(path.join(root,'harness-lock.json'));
const harnessLock=JSON.parse(lockBytes);
const harnessLockSha=(await fs.readFile(path.join(root,'harness-lock.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(lockBytes),harnessLockSha);
const protocolBytes=await read(path.join(root,'protocol.json'));
const protocolSha=(await fs.readFile(path.join(root,'protocol.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(protocolBytes),protocolSha);
assert.equal(harnessLock.protocolSha256,protocolSha);
const amendmentBytes=await read(path.join(root,'protocol-amendment.json'));
const amendment=JSON.parse(amendmentBytes);
const amendmentSha=(await fs.readFile(path.join(root,'protocol-amendment.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(amendmentBytes),amendmentSha);
assert.equal(amendment.pinnedHarness.sha256,harnessLockSha);
assert.equal(amendment.amends.sha256,protocolSha);
for(const source of harnessLock.scripts){
 const file=path.resolve(process.cwd(),source.path);
 assert.equal(hash(await read(file)),source.sha256,`Frozen source changed: ${source.path}`);
}
const inputBytes=await read(path.join(root,'native-input.json'));
const projectedBytes=await read(path.join(root,'projected.json'));
const sidecarBytes=await read(path.join(root,'table-sidecar.json'));
const protocol=await readJson(path.join(root,'protocol.json'));
const inferenceFreeze=await readJson(path.join(root,'inference-freeze.json'));
assert.equal(hash(inputBytes),inferenceFreeze.nativeInputSha256);
assert.equal(hash(projectedBytes),inferenceFreeze.projectedJsonSha256);
assert.equal(hash(sidecarBytes),inferenceFreeze.tableSidecarSha256);
assert.equal(inferenceFreeze.harnessLockSha256,harnessLockSha);
assert.equal(inferenceFreeze.protocolAmendmentSha256,amendmentSha);
const rawRun=path.join(root,'inference/attempt-2/model-output');
const actualModelResults=[];
async function inventory(relative){
 const file=path.join(rawRun,relative),stat=await fs.stat(file);
 if(stat.isDirectory())for(const name of (await fs.readdir(file)).sort())await inventory(path.join(relative,name));
 else actualModelResults.push({path:relative.replaceAll('\\','/'),bytes:stat.size,sha256:hash(await read(file))});
}
for(const name of (await fs.readdir(rawRun)).sort())await inventory(name);
assert.deepEqual(actualModelResults,inferenceFreeze.modelResults,'Raw model results changed after their inference freeze');
const candidate=JSON.parse(inputBytes);
assert.deepEqual(candidate.arms.map(a=>a.parser),['plain','table']);
const baselinePath=path.resolve('.local/thai-table-chunking-20261025/run-v2/native-input.json');
const baseline=JSON.parse(await read(baselinePath));
assert.equal(hash(await read(baselinePath)),protocol.comparison.existingPaddleArms.sha256);
assert.deepEqual(baseline.arms.map(a=>({arm:a.parser,contentSha256:a.contentSha256})),protocol.comparison.existingPaddleArms.arms);
const runnerPath=path.join(report,'run-native-vl.ps1');
const nativeScripts=['../table-chunking/native.test.js','../table-chunking/launch-native.mjs','../real-native/native.config.mjs','../real-native/metrics.mjs','../table-chunking/table-profile.mjs'];
const pinned=new Map(harnessLock.scripts.map(s=>[s.path,s.sha256]));
for(const script of nativeScripts)assert.ok(pinned.has(path.relative(process.cwd(),path.normalize(path.join(report,script))).replaceAll('\\','/')),`Native source missing from pre-inference harness lock: ${script}`);
const value={schemaVersion:1,status:'frozen-before-native-evaluation',protocolSha256:harnessLock.protocolSha256,protocolAmendmentSha256:amendmentSha,harnessLockSha256:harnessLockSha,candidate:{nativeInputSha256:hash(inputBytes),projectedJsonSha256:hash(projectedBytes),tableSidecarSha256:hash(sidecarBytes),inferenceFreezeSha256:hash(await read(path.join(root,'inference-freeze.json'))),rawModelResults:actualModelResults,arms:candidate.arms.map(a=>({parser:a.parser,contentSha256:a.contentSha256}))},existingPaddle:{path:'.local/thai-table-chunking-20261025/run-v2/native-input.json',sha256:hash(await read(baselinePath)),arms:baseline.arms.map(a=>({parser:a.parser,contentSha256:a.contentSha256}))},native:{image:'sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39',cpu:2,memoryBytes:6442450944,network:'none',goldPath:'reports/oxr-thai-2026-10-25/real-native/gold.json',runnerPath:path.relative(process.cwd(),runnerPath).replaceAll('\\','/'),runnerSha256:hash(await read(runnerPath)),sourceFiles:Object.fromEntries(nativeScripts.map(script=>[script,pinned.get(path.relative(process.cwd(),path.normalize(path.join(report,script))).replaceAll('\\','/'))]))}};
const text=JSON.stringify(value,null,2)+'\n';
await fs.writeFile(path.join(root,'native-evaluation-lock.json'),text,{flag:'wx'});
await fs.writeFile(path.join(report,'native-evaluation-lock.json'),text,{flag:'wx'});
const digest=hash(text);
await fs.writeFile(path.join(root,'native-evaluation-lock.sha256'),digest+'  native-evaluation-lock.json\n',{flag:'wx'});
await fs.writeFile(path.join(report,'native-evaluation-lock.sha256'),digest+'  native-evaluation-lock.json\n',{flag:'wx'});
console.log(JSON.stringify({nativeEvaluationLockSha256:digest,candidateArms:value.candidate.arms,runnerSha256:value.native.runnerSha256},null,2));
