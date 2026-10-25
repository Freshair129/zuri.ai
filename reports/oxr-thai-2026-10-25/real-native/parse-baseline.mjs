// Uses the actual application binary parser; never reads gold or questions.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseKnowledgeBinary} from '/app/src/modules/knowledge/knowledge-binary-parser.js';
const write=(name,data)=>fs.writeFile('/bench/'+name,JSON.stringify(data,null,2),{flag:'wx'});
await write('runtime.json',{node:process.version,parser:'knowledge-binary-parser-1',inputMode:'application/pdf'});
for(const file of (await fs.readdir('/input')).filter(x=>x.endsWith('.pdf')).sort()){
 const bytes=await fs.readFile('/input/'+file),id=file.slice(0,-4),start=performance.now();
 const record={id,parser:'baseline',inputSha256:createHash('sha256').update(bytes).digest('hex')};
 try{record.output=await parseKnowledgeBinary({bytes,mediaType:'application/pdf',sourceId:id,sourceVersion:'public-real-v1',rawArtifactId:'raw-'+id});record.status='PARSED';}
 catch(e){record.status='ERROR';record.error=e.code||e.name;record.message=e.message;}
 record.elapsedMs=performance.now()-start;await write(file.replace('.pdf','.json'),record);console.log(id,record.status,record.elapsedMs);
}
await write('resources.json',{memoryPeakBytes:Number(await fs.readFile('/sys/fs/cgroup/memory.peak','utf8'))});
