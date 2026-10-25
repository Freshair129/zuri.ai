// Hash inventory only; private ephemeral runtime state is not copied to reports.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]),dest=path.dirname(fileURLToPath(import.meta.url));
const hash=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const original=await read('reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json');
const originalRoot=path.resolve(original.rawRoot);
const oldArtifacts=['projected.json','native-input.json','paddle-1/economy.json','paddle-1/population.json','input/economy.pdf','input/population.pdf'];
for(const name of oldArtifacts)assert.equal(await hash(path.join(originalRoot,name)),original.raw.find(r=>r.path===name).sha256);
const models=await read(path.join(root,'native-models.json'));assert.deepEqual(models,original.nativeModels);
const frozen=await read(path.join(root,'frozen.json'));
for(const [file,digest] of Object.entries(frozen.files))assert.equal(await hash(file.endsWith('/README.md')?path.join(root,'frozen-protocol.md'):file),digest);
for(const arm of ['plain','table'])assert.equal(await hash(path.join(root,'native-'+arm,'executed-native.test.js')),await hash(path.join(dest,'native.test.js')));
const raw=[];
async function walk(relative){const file=path.join(root,relative),stat=await fs.stat(file);if(stat.isDirectory()){for(const n of (await fs.readdir(file)).sort())await walk(path.join(relative,n));}else raw.push({path:relative.replaceAll('\\','/'),bytes:stat.size,sha256:await hash(file)});}
for(const name of (await fs.readdir(root)).sort())await walk(name);
const sources=[];for(const name of (await fs.readdir(dest)).sort())if(/\.(mjs|js|ps1|py)$/.test(name)||name==='measurement-summary.json')sources.push({path:name,sha256:await hash(path.join(dest,name))});
const commands={};for(const arm of ['plain','table'])commands[arm]=(await read(path.join(root,arm+'-command.json'))).map(s=>s.replaceAll(process.cwd(),'<repo>').replaceAll(process.cwd().replaceAll('\\','/'),'<repo>'));
const evidence={schema:'thai-table-chunking-evidence.v1',revision:original.revision,rawRoot:path.relative(process.cwd(),root).replaceAll('\\','/'),originalManifestSha256:await hash('reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json'),originalArtifactsUnchanged:oldArtifacts,goldSha256:await hash(path.resolve(dest,'../real-native/gold.json')),nativeModels:models,modelBytesMatchPrior:true,executedHarnessMatches:true,frozen,host:original.host,commands,sources,raw};
await fs.writeFile(path.join(dest,'evidence-manifest.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(`Sealed ${raw.length} raw artifacts and ${sources.length} sources; frozen inputs/model bytes unchanged.`);
