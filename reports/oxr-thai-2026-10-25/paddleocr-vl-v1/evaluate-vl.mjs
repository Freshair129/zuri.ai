// Post-inference evaluation; reads gold only after OCR/native inputs are frozen.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,numericTokens,rowSupport,headerSupport,matchedCells,validateNativeRows} from '../real-native/metrics.mjs';

const root=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const report=path.dirname(fileURLToPath(import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>fs.readFile(p);
const readJson=async p=>JSON.parse(await read(p));
const evaluatorSha=(await fs.readFile(path.join(root,'evaluation-script.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(await read(fileURLToPath(import.meta.url))),evaluatorSha,'Evaluation source changed after it was frozen');
const protocol=await readJson(path.join(root,'protocol.json'));
const protocolSha=(await fs.readFile(path.join(root,'protocol.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(await read(path.join(root,'protocol.json'))),protocolSha);
const harnessLock=await readJson(path.join(root,'harness-lock.json'));
const harnessLockSha=(await fs.readFile(path.join(root,'harness-lock.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(await read(path.join(root,'harness-lock.json'))),harnessLockSha);
const scorerPath=path.resolve(report,'../real-native/metrics.mjs');
const scorerRelative=path.relative(process.cwd(),scorerPath).replaceAll('\\','/');
assert.equal(hash(await read(scorerPath)),harnessLock.scripts.find(s=>s.path===scorerRelative)?.sha256,'Unchanged common scorer differs from the frozen source');
const amendment=await readJson(path.join(root,'protocol-amendment.json'));
assert.equal(amendment.pinnedHarness.sha256,harnessLockSha);
const nativeLock=await readJson(path.join(root,'native-evaluation-lock.json'));
const nativeLockSha=(await fs.readFile(path.join(root,'native-evaluation-lock.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(await read(path.join(root,'native-evaluation-lock.json'))),nativeLockSha);
assert.equal(nativeLock.harnessLockSha256,harnessLockSha);
assert.equal(nativeLock.protocolSha256,protocolSha);
const candidateBytes=await read(path.join(root,'native-input.json'));
const candidate=JSON.parse(candidateBytes);
assert.equal(hash(candidateBytes),nativeLock.candidate.nativeInputSha256);
const candidateProjection=await readJson(path.join(root,'projected.json'));
const candidateSidecar=await readJson(path.join(root,'table-sidecar.json'));
assert.equal(hash(await read(path.join(root,'projected.json'))),nativeLock.candidate.projectedJsonSha256);
assert.equal(hash(await read(path.join(root,'table-sidecar.json'))),nativeLock.candidate.tableSidecarSha256);
const inferenceFreeze=await readJson(path.join(root,'inference-freeze.json'));
assert.equal(hash(await read(path.join(root,'inference-freeze.json'))),nativeLock.candidate.inferenceFreezeSha256);
const rawResults=[];
async function inventory(relative){
 const full=path.join(root,'inference/attempt-2/model-output',relative),stat=await fs.stat(full);
 if(stat.isDirectory())for(const name of (await fs.readdir(full)).sort())await inventory(path.join(relative,name));
 else rawResults.push({path:relative.replaceAll('\\','/'),bytes:stat.size,sha256:hash(await read(full))});
}
for(const name of (await fs.readdir(path.join(root,'inference/attempt-2/model-output'))).sort())await inventory(name);
assert.deepEqual(rawResults,inferenceFreeze.modelResults,'Raw parser output differs from the blind freeze');
const oldRoot=path.resolve('.local/thai-table-chunking-20261025/run-v2');
const oldInputBytes=await read(path.join(oldRoot,'native-input.json'));
const oldInput=JSON.parse(oldInputBytes);
assert.equal(hash(oldInputBytes),protocol.comparison.existingPaddleArms.sha256);
const priorManifest=await readJson(path.resolve('reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json'));
const priorProjectedBytes=await read(path.resolve('.local/thai-native-20261025/projected.json'));
assert.equal(hash(priorProjectedBytes),priorManifest.raw.find(r=>r.path==='projected.json')?.sha256,'Frozen original Paddle projection changed');
const oldProjected=JSON.parse(priorProjectedBytes).filter(p=>p.parser==='paddle');
const chunkingManifest=await readJson(path.resolve('reports/oxr-thai-2026-10-25/table-chunking/evidence-manifest.json'));
const oldSidecar=await readJson(path.join(oldRoot,'table-sidecar.json'));
assert.equal(hash(await read(path.join(oldRoot,'table-sidecar.json'))),chunkingManifest.frozen.files['.local/thai-table-chunking-20261025/run-v2/table-sidecar.json'],'Frozen Paddle table sidecar changed');
const oldSummary=await readJson(path.resolve('reports/oxr-thai-2026-10-25/table-chunking/measurement-summary.json'));
assert.deepEqual(oldInput.arms.map(a=>({arm:a.parser,contentSha256:a.contentSha256})),protocol.comparison.existingPaddleArms.arms);

// Gold is opened only below, after both parser outputs, projection and actual native inputs are hash-verified.
const gold=await readJson(path.resolve('reports/oxr-thai-2026-10-25/real-native/gold.json'));
const frozenGoldSha=String(priorManifest.frozen.goldSha256).toLowerCase();
assert.match(frozenGoldSha,/^[a-f0-9]{64}$/u,'The prior evidence manifest must identify the frozen gold digest');
const goldVerification=await readJson(path.join(root,'native-gold-verification.json'));
assert.equal(goldVerification.status,'PASS');
assert.equal(goldVerification.expectedSha256,frozenGoldSha);
assert.equal(goldVerification.actualSha256,frozenGoldSha);
assert.equal(hash(await read(path.resolve('reports/oxr-thai-2026-10-25/real-native/gold.json'))),frozenGoldSha,'Frozen gold differs from the original real-native run');

function parserMetrics(projections,parser){
 return projections.map(p=>{
  const d=gold.documents.find(x=>x.id===p.id);assert.ok(d,`Missing gold document ${p.id}`);
  const numbers=new Set(numericTokens(p.text));
  return {parser,document:p.id,textChecks:d.textChecks.map(value=>({value,present:canonical(p.text).includes(canonical(value))})),
   selectedValueTokensPresent:d.rows.reduce((n,r)=>n+r.values.filter(v=>numbers.has(v)).length,0),selectedValueTokenTotal:d.rows.length*7,
   matchedSelectedValueCells:p.tables.length?d.rows.reduce((n,r)=>n+matchedCells(p.tables,r),0):null,
   orderedRowsPresent:d.rows.filter(r=>rowSupport(p.text,r)).length,rowsTotal:d.rows.length,tableCount:p.tables.length,chars:p.text.length};
 });
}
const parsing={paddle:parserMetrics(oldProjected,'paddle'),vl:parserMetrics(candidateProjection,'vl-v1')};
const timing=rows=>{const a=rows.map(r=>r.elapsedMs).sort((x,y)=>x-y);return {count:a.length,minMs:a[0],medianMs:(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2,maxMs:a.at(-1)};};
function evaluateNative(input,sidecar,base,arm,parser,stateFile){
 const resultPath=path.join(base,`native-${parser}`,'native-results.json');
 const statePath=stateFile||path.join(base,`native-${parser}`,'run-state.json');
 const containerStatePath=stateFile||path.join(base,`native-${parser}`,'container-state.json');
 return Promise.all([readJson(resultPath),readJson(statePath),readJson(containerStatePath).catch(()=>null)]).then(([result,state,containerState])=>{
  const projection=input.arms.find(a=>a.parser===arm);assert.ok(projection,`Missing ${parser}/${arm} input`);
  assert.equal(result.status,'COMPLETED',`${parser}/${arm} native status`);
  validateNativeRows(result,projection,gold);
  const queries=result.queries.map(item=>{
   const doc=gold.documents.find(d=>d.id===item.doc),q=doc.qa.find(q=>q.id===item.id),row=doc.rows.find(r=>r.id===q.row),results=item.response.results;
   const rank=predicate=>{const n=results.findIndex(predicate);return n<0?null:n+1;};
   const supports=r=>r.document===doc.id&&rowSupport(r.text,row);
   const columnSupports=r=>{
    if(!supports(r))return false;
    const p=sidecar.packets.find(p=>p.doc===doc.id&&p.start===r.verifiedRange.start&&p.end===r.verifiedRange.end&&p.text===r.text);if(!p)return false;
    const t=sidecar.tables.find(t=>t.id===p.tableId);if(!t)return false;
    const cells=t.cells.filter(c=>c.row===p.row),label=cells.findIndex(c=>canonical(c.text).includes(canonical(row.label)));if(label<0)return false;
    const target=cells[label+1+q.column];if(!target||canonical(target.text)!==row.values[q.column])return false;
    const binding=p.bindings.find(b=>b.cell===target.cell);if(!binding)return false;
    const headers=binding.headerRefs.map(ref=>t.cells.find(c=>c.row===ref.row&&c.cell===ref.cell)?.text||'').join('\n');
    return headerSupport(headers,doc.columns[q.column].split('/'));
   };
   return {id:item.id,doc:item.doc,repetition:item.repetition,elapsedMs:item.elapsedMs,returned:results.length,
    rowRank:rank(supports),headerTokenRank:rank(r=>supports(r)&&headerSupport(r.text,q.headers)),documentRank:rank(r=>r.document===doc.id),
    columnBindingRank:arm==='table'?rank(columnSupports):null};
  });
  const first=queries.filter(q=>q.repetition===1),later=queries.filter(q=>q.repetition>1),hit=(key,k)=>first.filter(q=>q[key]!==null&&q[key]<=k).length;
  const stable=first.filter(q=>later.filter(x=>x.id===q.id&&x.doc===q.doc).every(x=>x.rowRank===q.rowRank&&x.headerTokenRank===q.headerTokenRank&&x.documentRank===q.documentRank&&x.columnBindingRank===q.columnBindingRank)).length;
  return {parser,arm,status:result.status,queryCount:first.length,totalQueries:queries.length,successfulStages:result.successfulStages,chunkCount:result.chunkCount,atomicPackets:result.atomicPackets??null,
   rowHit1:hit('rowRank',1),rowHit5:hit('rowRank',5),headerTokenHit5:hit('headerTokenRank',5),documentHit5:hit('documentRank',5),columnBindingHit5:arm==='table'?hit('columnBindingRank',5):null,metricRankStable:stable,
   initializationMs:result.initializationMs,submissionMs:result.submissionMs,workerMs:result.workerMs,pullFinishMs:result.pullFinishMs,ingestionToPublishedMs:result.ingestionToPublishedMs,
   memoryPeakBytes:result.memoryPeakBytes,containerWallMs:state.elapsedMs??(Date.parse(state.endedAt||state.FinishedAt)-Date.parse(state.startedAt||state.StartedAt)),exitCode:state.exitCode??state.ExitCode,oom:state.oom??state.OOMKilled??containerState?.OOMKilled,
   firstPass:timing(first),repeatedPasses:timing(later),scopeDenial:result.scopeDenial,restart:result.restart,gateProbe:result.publication.benchmark,queries};
 });
}
const native=[];
for(const arm of ['plain','table']){
 native.push(await evaluateNative(oldInput,oldSidecar,oldRoot,arm,arm,path.join(oldRoot,`native-${arm}-state.json`)));
 native.push(await evaluateNative(candidate,candidateSidecar,root,arm,`vl-${arm}`));
}
const parserRuns=await readJson(path.join(root,'inference/attempt-2/model-output/run-result.json'));
assert.equal(parserRuns.status,'PARSED');
const parserState=await readJson(path.join(root,'inference/attempt-2/run-state.json'));
const gpuSamples=(await fs.readFile(path.join(root,'inference/attempt-2/gpu-samples.csv'),'utf8')).trim().split(/\r?\n/u).slice(1).map(line=>line.split(','));
const gpuUsed=gpuSamples.map(row=>Number(row[3])).filter(Number.isFinite);
const paddleBaseline=await readJson(path.resolve('reports/oxr-thai-2026-10-25/real-native/measurement-summary.json'));
const summary={scope:'2x2 original Paddle plain/table-preserving projection versus PaddleOCR-VL v1 plain/table-preserving projection through the same isolated actual GenesisRAG17 path; OCR raw outputs frozen before gold/scoring; no generated answers or production qualification.',
  protocol:{protocolSha256:protocolSha,harnessLockSha256:harnessLockSha,protocolAmendmentSha256:(await fs.readFile(path.join(root,'protocol-amendment.sha256'),'utf8')).trim().split(/\s+/u)[0],nativeEvaluationLockSha256:nativeLockSha,goldSha256:frozenGoldSha},
  parsers:{paddle:{source:'Existing Paddle Thai parser run; CPU; see prior real-native measurement summary',metrics:parsing.paddle,resources:paddleBaseline.resources.filter(r=>r.parser==='paddle')},vl:{name:protocol.candidate.name,version:parserRuns.packages,device:parserRuns.device,projectionMetrics:parsing.vl,run:{containerWallMs:parserState.elapsedMs,modelLoadMs:parserRuns.modelLoadMs,totalMs:parserRuns.totalMs,cgroupMemoryPeak:parserRuns.cgroupMemoryPeak,pdfRuns:parserRuns.pdfs,hostGpuPeakUsedMiB:Math.max(...gpuUsed),hostGpuFirstSampleUsedMiB:gpuUsed[0],hostGpuSampleCount:gpuUsed.length,hostGpuCaveat:'Whole-device host telemetry can include unrelated GPU processes; not strict process attribution.'}}},
  projections:{paddle:oldInput.arms.map(a=>({arm:a.parser,characters:a.content.length,sha256:a.contentSha256})),vl:candidate.arms.map(a=>({arm:a.parser,characters:a.content.length,sha256:a.contentSha256}))},
  tableProfiles:{paddle:{tables:oldSidecar.tables.length,sourceCells:oldSidecar.tables.reduce((n,t)=>n+t.cells.length,0),packets:oldSidecar.packets.length},vl:{tables:candidateSidecar.tables.length,sourceCells:candidateSidecar.tables.reduce((n,t)=>n+t.cells.length,0),packets:candidateSidecar.packets.length}},
  native:{design:'Separate fresh state/store and database per arm; CPU2/RAM6GiB/network-none; E5 model mounted read-only; existing QA/scorer; 17 stages, 48 fixed queries, citation validation, scope denial and restart.',arms:native},
  priorPaddleProjectionSummary:{scope:oldSummary.scope,native:oldSummary.native?.map(x=>({arm:x.arm,rowHit1:x.rowHit1,rowHit5:x.rowHit5,headerTokenHit5:x.headerTokenHit5,documentHit5:x.documentHit5,ingestionToPublishedMs:x.ingestionToPublishedMs,workerMs:x.workerMs,memoryPeakBytes:x.memoryPeakBytes}))??null},
  limits:['Two public PDFs/four pages only; sampled field metrics, not full-document CER/TEDS.','Paddle baseline parser executed on CPU; VL parser executed on GPU, so parser latency comparison is descriptive across different devices, not a causal engine-speed claim.','Native citations prove exact composite TEXT substrings and source-cell sidecar mapping, not PDF geometry or production per-PDF lineage.','No generated answers, customer data, production changes, or production qualification.']};
await fs.writeFile(path.join(report,'measurement-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
await fs.writeFile(path.join(root,'measurement-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({parsing:{paddle:parsing.paddle.map(x=>({document:x.document,textCorrect:x.textChecks.filter(c=>c.present).length+'/'+x.textChecks.length,matchedSelectedValueCells:x.matchedSelectedValueCells+'/'+x.selectedValueTokenTotal,orderedRowsPresent:x.orderedRowsPresent+'/'+x.rowsTotal})),vl:parsing.vl.map(x=>({document:x.document,textCorrect:x.textChecks.filter(c=>c.present).length+'/'+x.textChecks.length,matchedSelectedValueCells:x.matchedSelectedValueCells+'/'+x.selectedValueTokenTotal,orderedRowsPresent:x.orderedRowsPresent+'/'+x.rowsTotal}))},native:native.map(({queries,...x})=>x),parser:{device:parserRuns.device,totalMs:parserRuns.totalMs,cgroupMemoryPeak:parserRuns.cgroupMemoryPeak,hostGpuPeakUsedMiB:Math.max(...gpuUsed)}},null,2));
