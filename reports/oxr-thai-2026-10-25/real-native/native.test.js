// Experimental real four-process path; no production admission or credentials.
import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import prisma from '@/lib/db';
import {createPortfolio,createTenant,createBusiness} from '/app/tests/factories/scope';
import {makeOperatorViewer} from '/app/tests/factories/viewer';
import {isolatedEnvironment,mspTransport,startWorkerProcess} from '/app/tests/acceptance/harness';
import {ingestGenesisRag17Raw} from '@/platform/integrations/core/genesisrag17-executor';
import {pullGenesisRag17Evidence} from '@/platform/integrations/core/genesisrag17-importer';
import {finishKnowledgeIngestionRun} from '@/platform/integrations/core/knowledge-ingestion-executor';
import {KNOWLEDGE_INGESTION_DEFINITION_ID,KNOWLEDGE_INGESTION_CONTRACT_ID,KNOWLEDGE_INGESTION_STAGE_CATALOG} from '@/platform/integrations/core/pipeline-tracking-contract';
const hash=s=>createHash('sha256').update(s).digest('hex');
const write=(name,v)=>fs.writeFileSync('/bench/'+name,JSON.stringify(v,null,2),{flag:'wx'});
it('measures isolated native Thai retrieval with sealed external QA',async()=>{
 const input=JSON.parse(fs.readFileSync('/input/native-input.json','utf8'));
 const control=JSON.parse(fs.readFileSync('/app/tests/fixtures/genesisrag17-corpus-v1.json','utf8'));
 const arm=process.env.BENCH_ARM;
 const projection=input.arms.find(a=>a.parser===arm);
 expect(projection).toBeTruthy();
 expect(projection.content.startsWith(control.text+'\n\n')).toBe(true);
 for(const r of projection.ranges)expect(hash(projection.content.slice(r.start,r.end))).toBe(r.textSha256);
 const report={arm,inputHash:hash(projection.content),gateFixtureHash:hash(JSON.stringify(control)),runs:[],queries:[]};
 const state=fs.mkdtempSync('/bench/state-');let worker,env,transport;
 const start=performance.now();
 try{
  const portfolio=await createPortfolio({name:'Thai parser isolated comparison',code:'PF-THAI-BENCH'});
  const tenant=await createTenant({portfolioId:portfolio.id,name:'Thai parser test tenant',code:'TNT-THAI-BENCH'});
  const business=await createBusiness({tenantId:tenant.id,name:'Thai parser test business',code:'BUS-THAI-BENCH'});
  const scope={portfolioId:portfolio.id,tenantId:tenant.id,businessId:business.id,workspaceId:'',agentId:'',visibility:'private'};
  const viewer=makeOperatorViewer({visibleBusinessIds:[business.id],ownedBusinessIds:[business.id]});
  const provider=await prisma.integrationProvider.create({data:{code:'KI17_TEST',name:'Isolated public PDF projection',status:'ACTIVE'}});
  const connection=await prisma.integrationConnection.create({data:{tenantId:tenant.id,businessId:business.id,providerId:provider.id,name:'Isolated comparison only',authorizationType:'NONE',status:'ACTIVE'}});
  env=isolatedEnvironment(state,scope);
  const boot=async()=>{
   worker=await startWorkerProcess(env,{dbPath:path.join(state,'genesis-store'),scope,credential:'ki17-test-worker',workerToken:'ki17-test-query',modelDir:env.KI17_MODEL_DIR,pythonCommand:'/opt/ki17/venv/bin/python',benchmarkFixture:control});
   env.MSP_PIPELINE_WORKER_URL=worker.url;transport=mspTransport(env);
  };
  await boot();report.initializationMs=performance.now()-start;
  const ingestStart=performance.now();
  const received=await ingestGenesisRag17Raw({scope,sourceId:'experiment://public-thai/'+arm,documentId:'public-thai-composite-'+arm,version:'1',content:projection.content,connectionId:connection.id,provider:'KI17_TEST',policy:{allowEmbedding:true,allowPublication:true}},{viewer,transport,credential:'ki17-test-source'});
  report.submissionMs=performance.now()-ingestStart;
  report.chunkCount=received.chunks.length;
  write('chunks.json',received.chunks);
  const workStart=performance.now();const work=await worker.call('runOnce');report.workerMs=performance.now()-workStart;report.publication=work;
  write('publication.json',work);
  expect(work.status,JSON.stringify(work)).toBe('published');
  expect(work.benchmark.queryCount).toBe(5);
  const pullStart=performance.now();
  await pullGenesisRag17Evidence({schemaVersion:'genesisrag17.v1',scope,runId:received.run.executionRunId},{viewer,transport,credential:'ki17-test-source'});
  const finish=await finishKnowledgeIngestionRun({dataPipelineDefinitionId:KNOWLEDGE_INGESTION_DEFINITION_ID,executionContractId:KNOWLEDGE_INGESTION_CONTRACT_ID,executionRunId:received.run.executionRunId,scope:{tenantId:scope.tenantId,businessId:scope.businessId},finishedAt:new Date().toISOString()},{viewer});
  report.pullFinishMs=performance.now()-pullStart;report.ingestionToPublishedMs=performance.now()-ingestStart;
  expect(finish.terminal).toBe('SUCCEEDED');
  const run=await prisma.pipelineRun.findUnique({where:{executionRunId:received.run.executionRunId}});
  const steps=await prisma.pipelineStep.findMany({where:{runId:run.id},orderBy:{sequence:'asc'}});
  const evidence=await prisma.genesisRag17StageEvidence.findMany({where:{executionRunId:received.run.executionRunId},orderBy:{stageNumber:'asc'}});
  write('stages.json',{steps,evidence});expect(evidence).toHaveLength(17);
  expect(steps.map(s=>s.pipelineStageId)).toEqual(KNOWLEDGE_INGESTION_STAGE_CATALOG.map(s=>s.pipelineStageId));
  expect(steps.every(s=>s.status==='SUCCEEDED')).toBe(true);report.successfulStages=17;
  const query=(text,over={})=>transport('msp_pipeline_query',{schemaVersion:'genesisrag17.v1',scope,credential:'ki17-test-source',query:text,topK:5,...over});
  const verify=async response=>{
   expect(response.snapshotId).toBe(work.snapshotId);expect(response.generation).toBe(work.generation);
   for(const r of response.results){
    const c=r.citation,chunk=await prisma.knowledgeChunk.findUnique({where:{id:c.chunkId}});
    expect(chunk).toBeTruthy();expect(chunk.text).toBe(r.text);expect(hash(r.text)).toBe(c.contentHash);
    expect(chunk.tenantId).toBe(scope.tenantId);expect(chunk.businessId).toBe(scope.businessId);
    const parsed=await prisma.knowledgeParsedArtifact.findUnique({where:{id:chunk.parsedArtifactId}});
    const raw=await prisma.knowledgeRawArtifact.findUnique({where:{id:parsed.rawArtifactId}});
    expect(parsed.id).toBe(c.parsedArtifactId);expect(raw.id).toBe(c.rawArtifactId);expect(raw.sourceId).toBe(c.sourceId);
    expect(raw.content.slice(chunk.startOffset,chunk.endOffset)).toBe(r.text);
    r.verifiedRange={start:chunk.startOffset,end:chunk.endOffset};
    r.document=projection.ranges.find(d=>chunk.startOffset>=d.start&&chunk.endOffset<=d.end)?.id||'control-or-boundary';
   }
  };
  const gold=JSON.parse(fs.readFileSync('/app/experiment/gold.json','utf8'));
  for(let repetition=1;repetition<=3;repetition++)for(const doc of gold.documents)for(const q of doc.qa){
   const started=performance.now();const response=await query(q.question);const elapsedMs=performance.now()-started;
   await verify(response);report.queries.push({id:q.id,doc:doc.id,repetition,elapsedMs,response});
  }
  const wrongScope={...scope,businessId:'benchmark-other-business'};
  const denial=await query('ข้อมูลประชากร',{scope:wrongScope}).then(()=>({denied:false}),e=>({denied:true,error:e.message}));
  expect(denial.denied).toBe(true);expect(denial.error).toMatch(/scope/i);report.scopeDenial=denial;
  await worker.close();await boot();const restarted=await query(gold.documents[0].qa[0].question);await verify(restarted);report.restart={snapshotId:restarted.snapshotId,generation:restarted.generation,verifiedCitations:restarted.results.length};
  report.status='COMPLETED';
 }catch(e){report.status='FAILED';report.error={message:e.message,stack:e.stack};throw e;}
 finally{
  await worker?.close();report.totalMs=performance.now()-start;report.memoryPeakBytes=Number(fs.readFileSync('/sys/fs/cgroup/memory.peak','utf8'));
  await prisma.$disconnect();const dbValue=process.env.DATABASE_URL?.replace(/^file:/,'');const dbPath=dbValue?path.resolve('/app/prisma',dbValue):null;
  if(dbPath&&fs.existsSync(dbPath)){fs.copyFileSync(dbPath,'/bench/zuri-evidence.sqlite');report.zuriDbRetained=true;}
  write('native-results.json',report);
 }
});
