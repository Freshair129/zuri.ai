// Seal report/raw artifact hashes after OCR and native evaluation are complete.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import assert from 'node:assert/strict';

const root=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const report=path.resolve('reports/oxr-thai-2026-10-25/paddleocr-vl-v1');
const hashBytes=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>fs.readFile(p);
const readJson=async p=>JSON.parse(await read(p));
const hashFile=p=>new Promise((resolve,reject)=>{const h=createHash('sha256');const stream=createReadStream(p);stream.on('data',c=>h.update(c));stream.on('error',reject);stream.on('end',()=>resolve(h.digest('hex')));});
const parser=await readJson(path.join(root,'inference/attempt-2/model-output/run-result.json'));
assert.equal(parser.status,'PARSED');
for(const arm of ['plain','table']){
 const result=await readJson(path.join(root,`native-vl-${arm}/native-results.json`));
 assert.equal(result.status,'COMPLETED',`native arm incomplete: ${arm}`);
}
const protocol=await readJson(path.join(root,'protocol.json'));
const protocolAmendment=await readJson(path.join(root,'protocol-amendment.json'));
const harnessLock=await readJson(path.join(root,'harness-lock.json'));
const nativeLock=await readJson(path.join(root,'native-evaluation-lock.json'));
const prior=await readJson(path.resolve('reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json'));
const collect=async(base,skipModelCache=false)=>{
 const result=[];
 async function walk(relative){
  if(skipModelCache&&relative.split(path.sep)[0]==='model-cache')return;
  const full=path.join(base,relative),stat=await fs.lstat(full);
  if(stat.isSymbolicLink())throw Error(`Evidence contains symlink: ${relative}`);
  if(stat.isDirectory())for(const name of (await fs.readdir(full)).sort())await walk(path.join(relative,name));
  else result.push({path:path.relative(process.cwd(),full).replaceAll('\\','/'),bytes:stat.size,sha256:await hashFile(full)});
 }
 for(const name of (await fs.readdir(base)).sort())await walk(name);
 return result;
};
const rawArtifacts=await collect(root,true);
const reportArtifacts=await collect(report);
const goldSha256=String(prior.frozen.goldSha256).toLowerCase();
assert.match(goldSha256,/^[a-f0-9]{64}$/u);
const manifest={schemaVersion:1,status:'sealed-nonproduction-experiment',generatedAt:new Date().toISOString(),
 protocol:{sha256:hashBytes(await read(path.join(root,'protocol.json'))),amendmentSha256:hashBytes(await read(path.join(root,'protocol-amendment.json'))),harnessLockSha256:hashBytes(await read(path.join(root,'harness-lock.json'))),nativeEvaluationLockSha256:hashBytes(await read(path.join(root,'native-evaluation-lock.json')))},
 goldSha256,modelCacheManifestSha256:hashBytes(await read(path.join(root,'model-cache-manifest.json'))),modelCacheFiles:(await readJson(path.join(root,'model-cache-manifest.json'))).files.length,
 rawArtifacts,reportArtifacts};
const text=JSON.stringify(manifest,null,2)+'\n';
await fs.writeFile(path.join(root,'evidence-manifest.json'),text,{flag:'wx'});
await fs.writeFile(path.join(report,'evidence-manifest.json'),text,{flag:'wx'});
console.log(JSON.stringify({evidenceManifestSha256:hashBytes(text),rawArtifacts:rawArtifacts.length,reportArtifacts:reportArtifacts.length,modelCacheFiles:manifest.modelCacheFiles,goldSha256},null,2));
