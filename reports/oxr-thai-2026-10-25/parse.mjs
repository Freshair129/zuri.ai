// Isolated benchmark; no DB, runtime credentials, or production imports.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const require=createRequire(path.resolve('apps/server/package.json'));
const root=path.resolve(process.argv[2] || '.local/oxr-thai-20261025');
const mode=process.argv[3] || 'baseline';
const {parseKnowledgeBinary}=await import(pathToFileURL(path.resolve('apps/server/src/modules/knowledge/knowledge-binary-parser.js')));
let binaryIdentity;
if(['baseline','html-control'].includes(mode)){
 await require('esbuild').build({entryPoints:['apps/server/src/modules/knowledge/genesisrag17-source.js'],bundle:true,platform:'node',format:'esm',outfile:path.join(root,'text-parser-bundle.mjs'),banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require=__createRequire(import.meta.url);"},logLevel:'warning'});
 binaryIdentity=(await import(pathToFileURL(path.join(root,'text-parser-bundle.mjs')))).genesisRag17BinaryParserIdentity;
}
const corpus=JSON.parse(await fs.readFile(path.join(root,'corpus.json'),'utf8'));
await fs.mkdir(path.join(root,'parsed'),{recursive:true});
documentLoop: for(const doc of corpus.documents)for(const variant of (mode==='html-control'?['html']:['digital','raster'])){
 const id=`${doc.id}-${variant}`;const dest=path.join(root,'parsed',`${id}-${mode}.json`);
 if(mode==='oxr' && process.argv[4] && process.argv[4]!=='all' && !id.startsWith(process.argv[4]))continue;
 if(mode==='oxr'){
   let previous;try{previous=JSON.parse(await fs.readFile(dest,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
   if(previous){
     if(previous.httpStatus===429 && process.argv.includes('--retry-rate-limited')){
       const archive=path.join(root,'parsed',`${id}-oxr-attempt1.json`);
       await fs.writeFile(archive,JSON.stringify(previous,null,2),{flag:'wx'});
     }else{console.log(`${id} existing response retained`);continue;}
   }
 }
 const startedAt=new Date().toISOString(), start=performance.now();
 try{
   const bytes=await fs.readFile(path.join(root,mode==='html-control'?`${doc.id}.html`:`${id}.pdf`));
   if(mode==='baseline'||mode==='html-control'){
     const mediaType=mode==='html-control'?'text/html':'application/pdf';
     const output=await parseKnowledgeBinary({bytes,mediaType,parserVersion:binaryIdentity({mediaType,maxTokens:80}),sourceId:id,sourceVersion:'synthetic-v1',rawArtifactId:`raw-${id}`});
     await fs.writeFile(dest,JSON.stringify({id,mode,startedAt,elapsedMs:performance.now()-start,status:'OK',output},null,2));
   }else if(mode==='oxr'){
     const endpoint='https://free-oxr.somark.cn/api/v1/parse/sync';
     const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),`${id}.pdf`);
     form.append('api_key','dummy');form.append('output_formats','markdown');form.append('output_formats','json');
     const response=await fetch(endpoint,{method:'POST',body:form,signal:AbortSignal.timeout(180000)});
     const raw=await response.text();let output;try{output=JSON.parse(raw);}catch{output={unparsedResponse:raw};}
     const valid=response.ok && output.code===0 && output.data?.error===null && Array.isArray(output.data?.result?.outputs?.json?.pages);
     await fs.writeFile(dest,JSON.stringify({id,mode,endpoint,startedAt,inputSha256:createHash('sha256').update(bytes).digest('hex'),responseSha256:createHash('sha256').update(raw).digest('hex'),providerBuild:null,httpStatus:response.status,elapsedMs:performance.now()-start,status:valid?'OUTPUT_RECEIVED':response.ok?'BODY_ERROR':'HTTP_ERROR',output},null,2));
     console.log(`${id}: HTTP ${response.status}, ${Math.round(performance.now()-start)}ms, ${raw.length} bytes`);
     if(!response.ok){process.exitCode=1;break documentLoop;}
   }else throw Error('Unknown mode');
 }catch(error){await fs.writeFile(dest,JSON.stringify({id,mode,startedAt,elapsedMs:performance.now()-start,status:'ERROR',error:error.code || error.name,message:error.message},null,2));console.log(`${id}: ${error.code || error.name} ${error.message}`);}
}
if(mode==='baseline')console.log('Baseline parsed; current text chunker bundled for offline import.');
