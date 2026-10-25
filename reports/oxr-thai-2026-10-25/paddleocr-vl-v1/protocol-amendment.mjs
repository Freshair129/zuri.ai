// Pre-inference addendum: incorporates reviewer controls without rewriting protocol v1.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const raw=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const report=path.resolve('reports/oxr-thai-2026-10-25/paddleocr-vl-v1');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>fs.readFile(p);
const initial=JSON.parse(await read(path.join(raw,'protocol.json')));
const initialHash=(await fs.readFile(path.join(raw,'protocol.sha256'),'utf8')).trim().split(/\s+/u)[0];
const modelManifest=JSON.parse(await read(path.join(raw,'model-cache-manifest.json')));
const harnessLock=JSON.parse(await read(path.join(raw,'harness-lock.json')));
if(initial.status!=='frozen-before-model-bootstrap-and-inference')throw Error('Initial protocol state changed');
if(modelManifest.status!=='frozen-before-inference'||harnessLock.status!=='frozen-before-inference')throw Error('Weights or scripts not frozen before inference');
if(modelManifest.protocolSha256!==initialHash||harnessLock.protocolSha256!==initialHash)throw Error('Protocol hash mismatch in pre-inference locks');
const priorFailedInferenceAttempts=[];
try{
 const oldAttempt=path.join(raw,'inference/attempt-1');
 const oldState=JSON.parse(await read(path.join(oldAttempt,'run-state.json')));
 const oldStderr=await fs.readFile(path.join(oldAttempt,'stderr.log'),'utf8');
 if(oldState.exitCode===0||!oldStderr.includes('refusing nonempty output directory'))throw Error('Prior inference attempt is not the recorded pre-prediction output-directory guard failure');
 for(const forbidden of ['run-start.json','run-result.json','repeat-1','repeat-2']){
  try{await fs.access(path.join(oldAttempt,forbidden));throw Error(`Prior attempt unexpectedly produced model output: ${forbidden}`);}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 priorFailedInferenceAttempts.push({attempt:'1',exitCode:oldState.exitCode,container:oldState.container,failure:'The launcher mounted its own telemetry in the model output directory; run-vl.py stopped before PaddleOCRVL construction or any PDF prediction.',runStateSha256:hash(await read(path.join(oldAttempt,'run-state.json'))),stderrSha256:hash(await read(path.join(oldAttempt,'stderr.log')))});
}catch(e){if(e.code!=='ENOENT')throw e;}
const adapterLog=await fs.readFile(path.join(raw,'adapter-parity.log'),'utf8');
if(!adapterLog.includes('native plain arm for both PDFs'))throw Error('Adapter parity evidence is missing');
const pageCounts=JSON.parse(await read(path.join(raw,'source-page-counts.json')));
if(pageCounts.tool!=='Poppler pdfinfo'||pageCounts.version!=='26.07.0')throw Error('Unexpected PDF page-count tool');
const expectedPages=[];
for(const source of pageCounts.entries){
 const input=initial.inputs.pdfs.find(p=>p.id===source.id);
 if(!input||input.path!==source.path||input.sha256!==source.sha256)throw Error(`Page-count evidence does not bind to frozen PDF ${source.id}`);
 const pdfInfoText=await read(path.join(raw,source.stdoutPath.split('/').at(-1)));
 if(hash(pdfInfoText)!==source.stdoutSha256)throw Error(`pdfinfo evidence changed for ${source.id}`);
 const pageIndexes=Array.from({length:source.pageCount},(_,i)=>i);
 expectedPages.push({id:source.id,count:source.pageCount,pageIndexes});
}
const bootstrap=JSON.parse(await read(path.join(raw,'bootstrap/attempt-2/bootstrap.json')));
if(bootstrap.status!=='MODEL_BOOTSTRAPPED'||bootstrap.device!=='gpu:0'||bootstrap.cudaCompiled!==true||bootstrap.cudaDeviceCount<1)throw Error('Successful GPU bootstrap receipt is missing');
const amendment={
 schemaVersion:1,
 id:'paddleocr-vl-v1-protocol-amendment-2',
 status:'frozen-before-inference',
 frozenAt:new Date().toISOString(),
 amends:{path:'protocol.json',sha256:initialHash},
 supersedes:priorFailedInferenceAttempts.length?{id:'paddleocr-vl-v1-protocol-amendment-1',sha256:hash(await read(path.join(raw,'preflight-attempt-2/protocol-amendment.json')))}:null,
 priorFailedInferenceAttempts,
 controls:{
  cuda:{visibleGpu:'0',containerEnv:'CUDA_VISIBLE_DEVICES=0',mustUseCuda:true,mustReportCudaCompiled:true,mustReportAtLeastOneVisibleGpu:true,selectedDevice:'gpu:0',failureBehavior:'Abort before any PDF prediction on CPU/fallback or device mismatch.'},
  modelCache:{manifestPath:'model-cache-manifest.json',manifestSha256:hash(await read(path.join(raw,'model-cache-manifest.json'))),mountPath:'/home/paddleocr/.paddlex',readOnlyDuringInference:true,cacheExport:{container:'zuri-thai-paddleocr-vl-bootstrap-v1-a2',source:'/home/paddleocr/.paddlex',bootstrapReceiptSha256:hash(await read(path.join(raw,'bootstrap/attempt-2/bootstrap.json'))),files:modelManifest.files.length,bytes:modelManifest.totalBytes}},
  repetitions:{primary:1,diagnostic:2,selection:'Always score repetition 1. Repetition 2 reports semantic/Markdown stability only; never choose an output by gold score.'},
  readingOrder:{path:'reports/oxr-thai-2026-10-25/paddleocr-vl-v1/paddle-html-adapter.mjs',sha256:harnessLock.scripts.find(s=>s.path.endsWith('/paddle-html-adapter.mjs')).sha256,ordering:'Vendor parsing_res_list order per page, pages sorted by page_index; no cross-page restructure_pages.'},
  pageCoverage:{source:'Poppler pdfinfo 26.07.0 against the exact SHA-256-pinned source PDFs',evidencePath:'source-page-counts.json',evidenceSha256:hash(await read(path.join(raw,'source-page-counts.json'))),pdfinfoExecutableSha256:pageCounts.executableSha256,expected:expectedPages,requireUniqueContiguousZeroBasedPageIndexes:true,requireJsonPageCountEqualsPdfPageCount:true,requirePredictorResultCountEqualsPdfPageCount:true,missingOrDuplicatePageBehavior:'Abort before projection/scoring.'},
  projection:{
   oldPlain:'Same frozen original Paddle parser text projection; HTML table rows are flattened to tab-separated cells and paragraphs remain in parser block order.',
   vlPlain:'Same adapter as old Paddle; HTML table rows flattened to tab-separated cells, blocks in parser reading order, and page text concatenated with one newline separator.',
   table:'Apply the unchanged ocr-table-row-v1 profile to both parser tables; literal cells/spans only, no language dictionaries, column shifts, gold lookups, or value repairs.',
   adapterParity:'adapter-parity.log verifies that the same adapter reproduces both prior Paddle documents exactly before new OCR inference.'
  },
  costs:{hostGpuSampling:'run-vl.ps1 samples host nvidia-smi every second during both phases. The CSV is whole-device host VRAM including unrelated processes and is resource context, not strict process attribution; do not subtract an idle baseline as exact candidate VRAM.',containerRam:'run-vl.py records cgroup peak memory; its teardown nvidia-smi snapshot is not peak evidence. Parser wall time is separate from native pipeline time.',crossDevice:'Existing Paddle parser was CPU; VL is GPU. Do not claim a causal parser speedup from these unlike devices.'},
  blindness:{bootstrap:'No PDF input mount.',inference:'Network none; read-only model cache; read-only mount containing exactly economy.pdf and population.pdf; no gold, questions, answers, baseline OCR text, or evaluation code.'}
 },
 pinnedHarness:{path:'harness-lock.json',sha256:(await fs.readFile(path.join(raw,'harness-lock.sha256'),'utf8')).trim().split(/\s+/u)[0]},
 adapterParity:{path:'adapter-parity.log',sha256:hash(await read(path.join(raw,'adapter-parity.log')))},
 modelFiles:{count:modelManifest.files.length,totalBytes:modelManifest.totalBytes,manifestSha256:hash(await read(path.join(raw,'model-cache-manifest.json')))}
};
const text=JSON.stringify(amendment,null,2)+'\n';
await fs.writeFile(path.join(raw,'protocol-amendment.json'),text,{flag:'wx'});
await fs.writeFile(path.join(report,'protocol-amendment.json'),text,{flag:'wx'});
const digest=hash(text);
await fs.writeFile(path.join(raw,'protocol-amendment.sha256'),digest+'  protocol-amendment.json\n',{flag:'wx'});
await fs.writeFile(path.join(report,'protocol-amendment.sha256'),digest+'  protocol-amendment.json\n',{flag:'wx'});
console.log(JSON.stringify({protocolSha256:initialHash,amendmentSha256:digest,harnessLockSha256:amendment.pinnedHarness.sha256,modelFiles:amendment.modelFiles},null,2));
