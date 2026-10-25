// Hash official model files after bootstrap and before the offline parser run.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const cache=path.join(root,'model-cache');
const manifest=path.join(root,'model-cache-manifest.json');
const protocol=JSON.parse(await fs.readFile(path.join(root,'protocol.json'),'utf8'));
const protocolSha256=(await fs.readFile(path.join(root,'protocol.sha256'),'utf8')).trim().split(/\s+/u)[0];
const bootstrapBytes=await fs.readFile(path.join(root,'bootstrap/attempt-2/bootstrap.json'));
const bootstrap=JSON.parse(bootstrapBytes);
if(bootstrap.status!=='MODEL_BOOTSTRAPPED'||bootstrap.pipeline_version!=='v1'||bootstrap.device!=='gpu:0'||bootstrap.cudaCompiled!==true||bootstrap.cudaDeviceCount<1)throw Error('No successful GPU v1 bootstrap receipt');
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=[];
async function walk(relative){
 const full=path.join(cache,relative),stat=await fs.lstat(full);
 if(stat.isSymbolicLink())throw Error(`model cache contains a symlink: ${relative}`);
 if(stat.isDirectory())for(const name of (await fs.readdir(full)).sort())await walk(path.join(relative,name));
 else files.push({path:relative.replaceAll('\\','/'),bytes:stat.size,sha256:hash(await fs.readFile(full))});
}
for(const name of (await fs.readdir(cache)).sort())await walk(name);
if(files.length===0)throw Error('model bootstrap created no persistent model-cache files');
const value={schemaVersion:1,status:'frozen-before-inference',protocolSha256,container:protocol.candidate.container,pipelineVersion:protocol.candidate.pipelineVersion,modelComponent:protocol.candidate.componentModel,bootstrapReceiptSha256:hash(bootstrapBytes),bootstrapPackages:bootstrap.packages,device:bootstrap.device,files,totalBytes:files.reduce((n,f)=>n+f.bytes,0)};
await fs.writeFile(manifest,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({fileCount:files.length,totalBytes:value.totalBytes,manifestSha256:hash(await fs.readFile(manifest))},null,2));
