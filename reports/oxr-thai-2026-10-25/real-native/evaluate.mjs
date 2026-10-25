import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonical,numericTokens,rowSupport,headerSupport,matchedCells,validateNativeRows} from './metrics.mjs';
const root=path.resolve(process.argv[2]),dest=path.dirname(fileURLToPath(import.meta.url));
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const gold=await read(path.join(dest,'gold.json')),frozen=await read(path.join(root,'frozen-inputs.json'));
assert.equal((await hash(path.join(dest,'gold.json'))).toUpperCase(),frozen.goldSha256);
for(const [name,digest] of Object.entries(frozen.files))assert.equal((await hash(path.join(root,'input',name))).toUpperCase(),digest);
const projections=await read(path.join(root,'projected.json'));
const inputs=await read(path.join(root,'native-input.json'));
for(const a of inputs.arms)assert.equal(createHash('sha256').update(a.content).digest('hex'),a.contentSha256);
const parsing=projections.map(p=>{
 const d=gold.documents.find(d=>d.id===p.id),numbers=new Set(numericTokens(p.text));
 return {parser:p.parser,document:p.id,textChecks:d.textChecks.map(value=>({value,present:canonical(p.text).includes(canonical(value))})),
 sampledValueTokensPresent:d.rows.reduce((n,r)=>n+r.values.filter(v=>numbers.has(v)).length,0),sampledValueTotal:d.rows.length*7,
 structuredStatus:p.tables.length?'AVAILABLE':'NO_STRUCTURED_TABLE_OUTPUT',
 structuredCellsCorrect:p.tables.length?d.rows.reduce((n,r)=>n+matchedCells(p.tables,r),0):null,
 orderedRowsPresent:d.rows.filter(r=>rowSupport(p.text,r)).length,rowsTotal:d.rows.length,
 tables:p.tables.length,parsedChars:p.text.length};
});
const resources=[];
for(const parser of ['baseline','paddle'])for(const repetition of [1,2]){
 const sub=path.join(root,parser+'-'+repetition),state=await read(path.join(root,parser+'-'+repetition+'-state.json'));
 const resource=await read(path.join(sub,'resources.json'));
 const inputs=await Promise.all(gold.documents.map(async d=>{const r=await read(path.join(sub,d.id+'.json'));return {id:d.id,status:r.status,elapsedMs:r.elapsedMs};}));
 resources.push({parser,repetition,exitCode:state.ExitCode,oom:state.OOMKilled,containerWallMs:Date.parse(state.FinishedAt)-Date.parse(state.StartedAt),...resource,inputs});
}
const native=[];
for(const parser of ['baseline','paddle']){
 let r;
 try{r=await read(path.join(root,'native-'+parser,'native-results.json'));}
 catch(e){if(e.code!=='ENOENT')throw e;const state=await read(path.join(root,'native-'+parser+'-state.json')).catch(()=>null);native.push({parser,status:state?.ExitCode?'HARNESS_FAILED':'NOT_RUN',state});process.exitCode=1;continue;}
 if(r.status!=='COMPLETED'){native.push({parser,status:r.status,error:r.error,publication:r.publication,partialQueries:r.queries?.length||0,memoryPeakBytes:r.memoryPeakBytes});process.exitCode=1;continue;}
 try{validateNativeRows(r,inputs.arms.find(a=>a.parser===parser),gold);}
 catch(e){native.push({parser,status:'INVALID_EVIDENCE',error:e.message});process.exitCode=1;continue;}
 const queries=r.queries.map(item=>{
  const doc=gold.documents.find(d=>d.id===item.doc),q=doc.qa.find(q=>q.id===item.id),row=doc.rows.find(row=>row.id===q.row);
  const results=item.response.results;
  const rank=predicate=>{const i=results.findIndex(predicate);return i<0?null:i+1;};
  const supports=x=>x.document===doc.id&&rowSupport(x.text,row);
  return {id:item.id,doc:item.doc,repetition:item.repetition,elapsedMs:item.elapsedMs,returned:results.length,
   rowEvidenceRank:rank(supports),headerTokenRank:rank(x=>supports(x)&&headerSupport(x.text,q.headers)),documentRank:rank(x=>x.document===doc.id)};
 });
 const first=queries.filter(q=>q.repetition===1),later=queries.filter(q=>q.repetition>1);
 const timing=rows=>{const ms=rows.map(q=>q.elapsedMs).sort((a,b)=>a-b);return {count:ms.length,minMs:ms[0],medianMs:(ms[Math.floor((ms.length-1)/2)]+ms[Math.ceil((ms.length-1)/2)])/2,maxMs:ms.at(-1)};};
 const within5=r=>r!==null&&r<=5;
 const stable=first.filter(q=>later.filter(x=>x.id===q.id&&x.doc===q.doc).every(x=>x.rowEvidenceRank===q.rowEvidenceRank&&x.headerTokenRank===q.headerTokenRank&&x.documentRank===q.documentRank)).length;
 const summary={parser,status:r.status,successfulStages:r.successfulStages,queryCount:first.length,
  rowHit1:first.filter(q=>q.rowEvidenceRank===1).length,rowHit5:first.filter(q=>within5(q.rowEvidenceRank)).length,
  headerTokenHit1:first.filter(q=>q.headerTokenRank===1).length,headerTokenHit5:first.filter(q=>within5(q.headerTokenRank)).length,
  documentHit5:first.filter(q=>within5(q.documentRank)).length,stableMetricRanks:stable,
  initializationMs:r.initializationMs,submissionMs:r.submissionMs,workerMs:r.workerMs,pullFinishMs:r.pullFinishMs,ingestionToPublishedMs:r.ingestionToPublishedMs,
  chunkCount:r.chunkCount,memoryPeakBytes:r.memoryPeakBytes,firstPass:timing(first),repeatedPasses:timing(later),scopeDenial:r.scopeDenial,restart:r.restart,gateProbe:r.publication.benchmark,queries};
 native.push(summary);
}
const summary={scope:'Two public PDFs/four pages; sampled fields; external parsing followed by real composite-TEXT all17/native query; no production or per-PDF native lineage claim',parsing,resources,native};
await fs.writeFile(path.join(dest,'measurement-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({parsing,resources,native:native.map(({queries,...x})=>x)},null,2));
