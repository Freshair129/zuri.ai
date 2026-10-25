// Hash-only inventory: raw databases, credentials and runtime state stay local.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(process.argv[2]),report=path.dirname(fileURLToPath(import.meta.url));
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const hash=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const old=await read(path.resolve('.local/thai-parser-alternatives-20261025/models-after.json'));
const current=await read(path.join(root,'models-after.json'));
assert.deepEqual(current.models,old.models);assert.equal(current.packages,old.packages);
for(const arm of ['baseline','paddle'])assert.equal(await hash(path.join(root,'native-'+arm,'executed-native.test.js')),await hash(path.join(report,'native.test.js')));
const raw=[];
async function visit(relative){
 const file=path.join(root,relative),s=await fs.stat(file);
 if(s.isDirectory()){for(const n of (await fs.readdir(file)).sort())await visit(path.join(relative,n));}
 else raw.push({path:relative.replaceAll('\\','/'),bytes:s.size,sha256:await hash(file)});
}
for(const n of ['input','rendered','baseline-1','baseline-2','paddle-1','paddle-2','native-baseline','native-paddle',
 'frozen-inputs.json','projected.json','native-input.json','models-after.json','native-models.json','token-audit.json','docker-runs.json','host-summary.json'])await visit(n);
for(const n of (await fs.readdir(root)).filter(n=>/^(baseline|paddle|native-baseline|native-paddle)(-[12])?(-state\.json|\.log)$/.test(n)).sort())await visit(n);
const sources=[];
for(const n of (await fs.readdir(report)).sort())if(/\.(mjs|js|py)$/.test(n)||n==='gold.json'||n==='measurement-summary.json')sources.push({path:n,sha256:await hash(path.join(report,n))});
const manifest={schema:'thai-native-evidence.v1',rawRoot:'.local/thai-native-20261025',revision:'49ef1ddbaa4db684bc5282ccc8df379e5a0028c8',
 caveat:'Working-tree experiment patch; hashes prove artifact identity, not correctness. Local raw data is not bundled.',
 unchangedModelFiles:current.models.length,packagesIdenticalToPrior:true,executedHarnessMatches:true,
 frozen:await read(path.join(root,'frozen-inputs.json')),host:await read(path.join(root,'host-summary.json')),
 dockerRuns:await read(path.join(root,'docker-runs.json')),nativeModels:await read(path.join(root,'native-models.json')),tokenAudit:await read(path.join(root,'token-audit.json')),sources,raw};
await fs.writeFile(path.join(report,'evidence-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Sealed ${raw.length} raw artifacts and ${sources.length} experiment sources; models unchanged.`);
