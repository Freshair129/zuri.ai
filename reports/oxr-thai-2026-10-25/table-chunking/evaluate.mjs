// Post-publication evaluation only; imports the unchanged previous scorer.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,rowSupport,headerSupport,validateNativeRows} from '../real-native/metrics.mjs';
const root=path.resolve(process.argv[2]),dest=path.dirname(fileURLToPath(import.meta.url));
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const hash=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const frozen=await read(path.join(root,'frozen.json'));
for(const [file,digest] of Object.entries(frozen.files))assert.equal(await hash(file.endsWith('/README.md')?path.join(root,'frozen-protocol.md'):file),digest,'Frozen artifact changed: '+file);
const gold=await read(path.resolve(dest,'../real-native/gold.json'));
const input=await read(path.join(root,'native-input.json')),sidecar=await read(path.join(root,'table-sidecar.json'));
const native=[];
const timing=rows=>{const a=rows.map(r=>r.elapsedMs).sort((a,b)=>a-b);return {count:a.length,minMs:a[0],medianMs:(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2,maxMs:a.at(-1)};};
for(const arm of input.arms){
 let result;try{result=await read(path.join(root,'native-'+arm.parser,'native-results.json'));}catch(e){if(e.code!=='ENOENT')throw e;native.push({arm:arm.parser,status:'NOT_RUN'});process.exitCode=1;continue;}
 if(result.status!=='COMPLETED'){native.push({arm:arm.parser,status:result.status,error:result.error});process.exitCode=1;continue;}
 validateNativeRows(result,arm,gold);
 const queries=result.queries.map(item=>{
  const doc=gold.documents.find(d=>d.id===item.doc),q=doc.qa.find(q=>q.id===item.id),row=doc.rows.find(r=>r.id===q.row);
  const supports=r=>r.document===doc.id&&rowSupport(r.text,row);
  const rank=f=>{const n=item.response.results.findIndex(f);return n<0?null:n+1;};
  const columnSupports=r=>{
   if(!supports(r))return false;
   const p=sidecar.packets.find(p=>p.doc===doc.id&&p.start===r.verifiedRange.start&&p.end===r.verifiedRange.end&&p.text===r.text);if(!p)return false;
   const t=sidecar.tables.find(t=>t.id===p.tableId),cells=t.cells.filter(c=>c.row===p.row);
   const label=cells.findIndex(c=>canonical(c.text).includes(canonical(row.label)));if(label<0)return false;
   const target=cells[label+1+q.column];if(!target||canonical(target.text)!==row.values[q.column])return false;
   const binding=p.bindings.find(b=>b.cell===target.cell);if(!binding)return false;
   const headers=binding.headerRefs.map(ref=>t.cells.find(c=>c.row===ref.row&&c.cell===ref.cell).text).join('\n');
   return headerSupport(headers,doc.columns[q.column].split('/'));
  };
  return {id:item.id,doc:item.doc,repetition:item.repetition,elapsedMs:item.elapsedMs,rowRank:rank(supports),headerTokenRank:rank(r=>supports(r)&&headerSupport(r.text,q.headers)),documentRank:rank(r=>r.document===doc.id),columnBindingRank:arm.parser==='table'?rank(columnSupports):null};
 });
 const first=queries.filter(q=>q.repetition===1),later=queries.filter(q=>q.repetition>1),hit=(key,k)=>first.filter(q=>q[key]!==null&&q[key]<=k).length;
 const state=await read(path.join(root,'native-'+arm.parser+'-state.json'));
 native.push({arm:arm.parser,status:result.status,queryCount:first.length,totalQueries:queries.length,successfulStages:result.successfulStages,chunkCount:result.chunkCount,atomicPackets:result.atomicPackets??null,
  rowHit1:hit('rowRank',1),rowHit5:hit('rowRank',5),headerTokenHit5:hit('headerTokenRank',5),documentHit5:hit('documentRank',5),columnBindingHit5:arm.parser==='table'?hit('columnBindingRank',5):null,
  metricRankStable:first.filter(q=>later.filter(x=>x.id===q.id&&x.doc===q.doc).every(x=>x.rowRank===q.rowRank&&x.headerTokenRank===q.headerTokenRank&&x.documentRank===q.documentRank&&x.columnBindingRank===q.columnBindingRank)).length,
  ingestionToPublishedMs:result.ingestionToPublishedMs,workerMs:result.workerMs,memoryPeakBytes:result.memoryPeakBytes,containerWallMs:Date.parse(state.FinishedAt)-Date.parse(state.StartedAt),exitCode:state.ExitCode,oom:state.OOMKilled,
  firstPass:timing(first),repeatPasses:timing(later),scopeDenial:result.scopeDenial,restart:result.restart,gateProbe:result.publication.benchmark,queries});
}
const frozenOcrWholeRowEligible=gold.documents.flatMap(d=>d.qa.filter(q=>{const row=d.rows.find(r=>r.id===q.row);return sidecar.tables.filter(t=>t.doc===d.id).some(t=>[...t.packets.map(p=>p.rowText),...t.fallback.map(f=>f.text)].some(text=>rowSupport(text,row)));}).map(q=>({doc:d.id,id:q.id})));
const tokenAudit=await read(path.join(root,'token-audit.json'));
const summary={scope:'Frozen Paddle OCR; old projection versus table-aware projection plus segmentation, actual isolated native17; no generated answers or production qualification',frozenOcrWholeRowEligible,tokenAudit,
 projection:input.arms.map(a=>({arm:a.parser,characters:a.content.length,sha256:a.contentSha256})),sourceCellCount:sidecar.tables.reduce((n,t)=>n+t.cells.length,0),mappedCellOccurrences:sidecar.sourceSpans.length,eligiblePackets:sidecar.packets.length,
 tables:sidecar.tables.map(t=>({id:t.id,headerRowCount:t.headerRowCount,packets:t.packets.length,fallback:t.fallback.reduce((a,f)=>(a[f.reason]=(a[f.reason]||0)+1,a),{})})),native};
await fs.writeFile(path.join(dest,'measurement-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({...summary,native:native.map(({queries,...r})=>r)},null,2));
