// Freeze every pre-inference script and the common scorer before unsealing outputs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const report=path.resolve('reports/oxr-thai-2026-10-25/paddleocr-vl-v1');
const protocol=JSON.parse(await fs.readFile(path.join(root,'protocol.json'),'utf8'));
const protocolSha256=(await fs.readFile(path.join(root,'protocol.sha256'),'utf8')).trim().split(/\s+/u)[0];
const modelManifest=await fs.readFile(path.join(root,'model-cache-manifest.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=[
 'freeze-protocol.mjs','freeze-model-cache.mjs','lock-harness.mjs','protocol-amendment.mjs','bootstrap-vl.py','run-vl.py','run-vl.ps1','freeze-native-evaluation.mjs','run-native-vl.ps1',
 'paddle-html-adapter.mjs','prepare-vl.mjs','compare-repetitions.mjs','adapter.test.mjs',
 '../table-chunking/table-profile.mjs','../table-chunking/native.test.js','../table-chunking/launch-native.mjs',
 '../real-native/native.config.mjs','../real-native/metrics.mjs',
].map(p=>path.normalize(path.join(report,p)));
const inventory=[];
for(const file of files)inventory.push({path:path.relative(process.cwd(),file).replaceAll('\\','/'),sha256:hash(await fs.readFile(file))});
const value={schemaVersion:1,status:'frozen-before-inference',protocolSha256,modelCacheManifestSha256:hash(modelManifest),upstreamReleaseCommit:protocol.candidate.releaseCommit,container:protocol.candidate.container,scripts:inventory};
const text=JSON.stringify(value,null,2)+'\n';
await fs.writeFile(path.join(root,'harness-lock.json'),text,{flag:'wx'});
await fs.writeFile(path.join(report,'harness-lock.json'),text,{flag:'wx'});
const digest=hash(text);
await fs.writeFile(path.join(root,'harness-lock.sha256'),digest+'  harness-lock.json\n',{flag:'wx'});
await fs.writeFile(path.join(report,'harness-lock.sha256'),digest+'  harness-lock.json\n',{flag:'wx'});
console.log(JSON.stringify({harnessLockSha256:digest,fileCount:inventory.length,modelCacheManifestSha256:value.modelCacheManifestSha256},null,2));
