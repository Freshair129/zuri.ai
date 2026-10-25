// Freeze the candidate setup before model bootstrap or inference.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const repo=process.cwd();
const raw=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const report=path.resolve('reports/oxr-thai-2026-10-25/paddleocr-vl-v1');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>fs.readFile(path.join(repo,p));
const noExist=async p=>{try{await fs.access(p);throw Error(`Refusing to overwrite ${p}`);}catch(e){if(e.code!=='ENOENT')throw e;}};
await noExist(path.join(raw,'protocol.json'));
await noExist(path.join(report,'protocol.json'));

const pdfs=[];
for(const id of ['economy','population']){
 const relative=`.local/thai-native-20261025/input/${id}.pdf`;
 const bytes=await read(relative);
 pdfs.push({id,path:relative,bytes:bytes.length,sha256:hash(bytes)});
}
const baselinePath='.local/thai-table-chunking-20261025/run-v2/native-input.json';
const baseline=JSON.parse(await read(baselinePath));
const priorProfile=await read('reports/oxr-thai-2026-10-25/table-chunking/table-profile.mjs');
const upstreamCommit=execFileSync('git',['ls-remote','https://github.com/PaddlePaddle/PaddleOCR.git','refs/tags/v3.6.0'],{encoding:'utf8'}).trim().split(/\s+/u)[0];
if(upstreamCommit!=='0006f7874c334ce9c0f497d8b6cce9cdc0b7363d')throw Error(`Upstream v3.6.0 changed: ${upstreamCommit}`);

const protocol={
 schemaVersion:1,
 status:'frozen-before-model-bootstrap-and-inference',
 frozenAt:new Date().toISOString(),
 repository:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()},
 candidate:{
  name:'PaddleOCR-VL original pipeline v1',
  upstream:'PaddlePaddle/PaddleOCR',
  release:'v3.6.0',
  releaseCommit:upstreamCommit,
  container:'ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-vl@sha256:ad0b1f056a76967f9191cd06398e8babb21b49a4673a28c3de5fd31f481884db',
  containerManifestSha256:'ad0b1f056a76967f9191cd06398e8babb21b49a4673a28c3de5fd31f481884db',
  pipelineVersion:'v1',
  componentModel:'PaddleOCR-VL-0.9B',
  inferenceEngine:'PaddlePaddle',
  invocation:'PaddleOCRVL(pipeline_version="v1").predict(local_pdf)',
  officialDefaults:true,
  customPrompt:null,
  customPostprocessing:null,
  repetitions:2,
  output:'Preserve every returned per-page JSON and Markdown file; run the same PDF order in both repetitions.'
 },
 officialSources:[
  'https://github.com/PaddlePaddle/PaddleOCR/releases/tag/v3.6.0',
  'https://github.com/PaddlePaddle/PaddleOCR/blob/v3.6.0/docs/version3.x/pipeline_usage/PaddleOCR-VL.en.md',
  'https://github.com/PaddlePaddle/PaddleOCR/blob/v3.6.0/docs/version3.x/installation.en.md',
  'https://huggingface.co/PaddlePaddle/PaddleOCR-VL'
 ],
 inputs:{pdfs,hostMount:'/input (read-only; contains only these two PDFs)'},
 comparison:{
  design:'2x2 OCR parser by projection profile',
  fixedGoldAndQuestions:'Existing reports/oxr-thai-2026-10-25/real-native/gold.json and unchanged common scorer are mounted only in the native evaluation container after candidate OCR output is frozen.',
  existingPaddleArms:{rawInput:baselinePath,sha256:hash(await read(baselinePath)),arms:baseline.arms.map(a=>({arm:a.parser,contentSha256:a.contentSha256}))},
  candidateArms:['VL/plain','VL/table'],
  projectionProfile:'reports/oxr-thai-2026-10-25/table-chunking/table-profile.mjs',
  projectionProfileSha256:hash(priorProfile),
  nativeAcceptance:'Actual isolated GenesisRAG17 17-stage publication, 48 queries, scope denial, citations, and restart checks; same pinned native image/E5 model and CPU2/RAM6GiB profile as the existing table-chunking comparison.',
  endpoints:'Existing exact-string/table-cell/ordered-row metrics and native hit@1/hit@5; parser, projection, and native costs are reported separately.'
 },
 isolation:{
  parserInputContains:['economy.pdf','population.pdf'],
  parserInputExcludes:['gold.json','questions','answers','scorer','baseline OCR text','native-query results'],
  modelBootstrapHasNoPdfMount:true,
  inferenceNetwork:'none',
  modelCache:'Frozen after bootstrap, hashed before inference, mounted read-only to the inference container.',
  sourceMountReadOnly:true,
  freshOutputRoot:true,
  noCorrections:true
 },
 host:{gpu:'NVIDIA GeForce RTX 3060 12GB',driver:'610.88',gpuDevice:'0',parserCpuLimit:6,parserMemoryLimitBytes:12884901888,resourceCapture:['container cgroup memory peak','host nvidia-smi GPU memory samples at 1-second intervals','per-PDF and total wall time']},
 priorPaddleRun:'reports/oxr-thai-2026-10-25/real-native/README.md and reports/oxr-thai-2026-10-25/table-chunking/README.md; parser-device and pipeline-version differences are explicit and parser-time cross-device speed claims are disallowed.'
};
const text=JSON.stringify(protocol,null,2)+'\n';
await fs.writeFile(path.join(raw,'protocol.json'),text,{flag:'wx'});
await fs.writeFile(path.join(report,'protocol.json'),text,{flag:'wx'});
const digest=hash(text);
await fs.writeFile(path.join(raw,'protocol.sha256'),digest+'  protocol.json\n',{flag:'wx'});
await fs.writeFile(path.join(report,'protocol.sha256'),digest+'  protocol.json\n',{flag:'wx'});
console.log(JSON.stringify({protocolSha256:digest,head:protocol.repository.head,upstreamCommit,pdfs,baselineArms:protocol.comparison.existingPaddleArms.arms},null,2));
