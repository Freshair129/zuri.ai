// For a fresh repeat only. Never overwrites measured evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]);
for(const arm of ['plain','table'])if(await fs.stat(path.join(root,'native-'+arm)).then(()=>true,()=>false))throw Error('Cannot freeze after execution');
const report='reports/oxr-thai-2026-10-25/table-chunking/';
await fs.copyFile(report+'README.md',path.join(root,'frozen-protocol.md'),fs.constants.COPYFILE_EXCL);
const files=[...['README.md','table-profile.mjs','prepare.mjs','native.test.js','launch-native.mjs'].map(n=>report+n),
 'reports/oxr-thai-2026-10-25/real-native/gold.json','reports/oxr-thai-2026-10-25/real-native/metrics.mjs',path.join(root,'native-input.json'),path.join(root,'table-sidecar.json')];
const hashes={};for(const f of files)hashes[f.replaceAll('\\','/')]=createHash('sha256').update(await fs.readFile(f)).digest('hex');
await fs.writeFile(path.join(root,'frozen.json'),JSON.stringify({frozenBeforeInference:new Date().toISOString(),files:hashes},null,2),{flag:'wx'});
