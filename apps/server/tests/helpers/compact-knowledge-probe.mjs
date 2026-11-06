// @spec ADR-115 — offline image/model contents probe; never runtime serving authority.
// @tested tests/node/compact-qualification.test.mjs, tests/integration/compact-knowledge-package.test.js
export function renderCompactKnowledgeProbeProgram({role,expectedPins}) {
  const worker=role==='genesisWorker'
  return String.raw`import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';
const result={role:${JSON.stringify(role)},runner:process.version};
if(${JSON.stringify(role)}==='tools'){if(!fs.existsSync('/app/node_modules/prisma/build/index.js'))throw Error('TOOLS_MISSING')}
else{const r=JSON.parse(fs.readFileSync('/opt/ki17/pins/resolved.json'));const pins=${JSON.stringify(expectedPins)};
if(r.profile!=='stdio'||Object.entries(pins).some(([k,v])=>r.contexts.find(c=>c.name===k)?.commit!==v))throw Error('PINS_MISMATCH');
for(const p of ['/opt/ki17/msp/apps/msp-server/bin/msp-server.mjs','/opt/ki17/gks/apps/gks-server/bin/gks-server.mjs'])if(!fs.existsSync(p))throw Error('RUNTIME_MISSING');
const n=spawnSync('/opt/ki17/node/bin/node',['--version'],{encoding:'utf8'});if(n.status!==0||n.stdout.trim()!=='v24.18.0')throw Error('NODE_MISMATCH');result.ki17=n.stdout.trim();result.pinsMatch=true}
if(${worker}){const root='/opt/ki17/genesisblock';const req=createRequire(root+'/package.json');req(root+'/index.js');const w=await import(root+'/genesisrag17-worker/src/worker.mjs');
result.modelFiles=Object.keys(w.verifyModelArtifacts('/opt/ki17/model')).length;
const p=spawnSync('/opt/ki17/venv/bin/python',[root+'/genesisrag17-worker/src/embedder.py','/opt/ki17/model'],{input:JSON.stringify({id:1,texts:['เครื่องทดสอบที่แยกต่างหาก'],mode:'query'})+'\n',encoding:'utf8',timeout:45000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
if(p.status!==0)throw Error('EMBEDDER_UNAVAILABLE');const messages=p.stdout.trim().split('\n').map(JSON.parse),v=messages.find(m=>m.id===1)?.vectors?.[0];
if(!messages[0].ready||!Array.isArray(v)||v.length!==384||!v.every(Number.isFinite)||Math.abs(Math.sqrt(v.reduce((n,x)=>n+x*x,0))-1)>0.00001)throw Error('EMBEDDER_INVALID');result.embeddingDimensions=v.length;result.nativeAddonLoaded=true}
console.log(JSON.stringify(result));`
}
