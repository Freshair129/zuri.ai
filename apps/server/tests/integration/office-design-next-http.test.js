// @req FR-294 — real Next HTTP routing/session/worker/database/byte readback on loopback.
import {spawn,execFileSync} from 'node:child_process'
import {createServer} from 'node:net'
import {randomUUID,createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import path from 'node:path'
import {it,expect,inject} from 'vitest'
import prisma from '@/lib/db'
import {createPortfolio,createTenant,createBusiness,createWorkspace} from '../factories/scope'
import {makeViewer} from '../factories/viewer'
import {persistImportViewer} from '../helpers/persist-import-viewer'
import {generateSessionToken,hashSessionToken} from '@/modules/identity/auth-service'
const freePort=()=>new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
it('imports the actual producer ZIP via Next HTTP and returns durable private IDs and exact GLB bytes',async()=>{
 const nonce=randomUUID(),secret='isolated-office-http-test-secret-'+nonce
 const p=await createPortfolio({code:'PF-HTTP-'+nonce,name:'HTTP fixture'}),t=await createTenant({portfolioId:p.id,code:'TN-HTTP-'+nonce,name:'HTTP fixture'}),b=await createBusiness({tenantId:t.id,code:'BU-HTTP-'+nonce,name:'HTTP fixture'}),w=await createWorkspace({businessId:b.id,scopeType:'BUSINESS',code:'WS-HTTP-'+nonce,name:'HTTP fixture'})
 const viewer=await persistImportViewer(makeViewer({visibleBusinessIds:[b.id],ownedBusinessIds:[b.id]})),sid=randomUUID(),token=generateSessionToken(viewer.principal.id,{secret,sessionId:sid})
 await prisma.session.create({data:{id:sid,personId:viewer.principal.id,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+600000)}})
 const standalone=process.env.OFFICE_HTTP_STANDALONE==='1'
 const env={...process.env,NODE_ENV:standalone?'production':'development',NEXT_TELEMETRY_DISABLED:'1',ZURI_SESSION_SECRET:secret,ZURI_KNOWLEDGE_ENABLED:'0'}
 for(const key of ['POSTGRES_PRISMA_URL','POSTGRES_URL','POSTGRES_URL_NON_POOLING','DATABASE_POSTGRES_URL','DIRECT_URL'])delete env[key]
 // tests/setup.js supplies an exclusive schema clone in this worktree; no runtime DB URL is accepted.
 if(standalone){expect(inject('testDatabaseEngine')).toBe('postgresql');expect(env.DATABASE_URL).toBe(inject('testDatabaseUrl'))}else expect(env.DATABASE_URL).toMatch(/^file:.*\.test-dbs/)
 const port=await freePort(),base=`http://127.0.0.1:${port}`,url=base+`/api/businesses/${b.id}/office-designs?workspaceId=${w.id}`
 env.PUBLIC_BASE_URL=base
 env.HOSTNAME='127.0.0.1';env.PORT=String(port)
 const child=spawn(process.execPath,standalone?[path.resolve('.next/standalone/server.js')]:[path.resolve('node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']})
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-200000)})
 const headers={cookie:'zuri_session='+token,'content-type':'application/zip',origin:base,'if-match':'"0"','idempotency-key':'http-import'},bytes=gunzipSync(readFileSync(new URL('../fixtures/office-design/stock.zip.gz',import.meta.url)))
 try{
  let ready=false
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Owned Next server exited');try{const response=await fetch(base+'/api/viewer',{signal:AbortSignal.timeout(2000)});if(response.status===401){ready=true;break}}catch{}await delay(250)}
  expect(ready).toBe(true)
  expect((await fetch(url)).status).toBe(401)
  const csrf=await fetch(base+'/api/auth/csrf',{headers:{cookie:headers.cookie,origin:base}});expect(csrf.status).toBe(200);headers['x-csrf-token']=(await csrf.json()).token
  const preview=await fetch(url+'&dryRun=1',{method:'POST',headers,body:bytes}),previewBody=await preview.json();expect(preview.status,JSON.stringify(previewBody)).toBe(200);expect(previewBody.registered).toBe(false)
  const response=await fetch(url,{method:'POST',headers,body:bytes}),receipt=await response.json();expect(response.status,JSON.stringify(receipt)).toBe(201);expect(receipt.mapping).toHaveLength(1655)
  const read=await fetch(url,{headers:{cookie:headers.cookie}}),stored=await read.json();expect(read.status).toBe(200);expect(stored.mapping).toEqual(receipt.mapping);expect(read.headers.get('cache-control')).toContain('no-store')
  const revision=stored.manifest.entities.find(e=>e.type==='assetRevision'),asset=await fetch(base+`/api/businesses/${b.id}/office-designs/assets/${revision.data.sha256}?workspaceId=${w.id}`,{headers:{cookie:headers.cookie}})
  expect(asset.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await asset.arrayBuffer())).digest('hex')).toBe(revision.data.sha256)
  const replay=await fetch(url,{method:'POST',headers,body:bytes});expect(replay.status).toBe(200);expect(await replay.json()).toEqual(receipt)
  expect(await prisma.officeDesignRevision.count({where:{registryId:receipt.registryId}})).toBe(1)
  await prisma.session.update({where:{id:sid},data:{status:'REVOKED'}});expect((await fetch(url,{headers:{cookie:headers.cookie}})).status).toBe(401)
 }finally{
  mkdirSync('.local',{recursive:true});writeFileSync('.local/office-next-http-server.log',output)
  // Stop only the process tree created by this test.
  if(child.exitCode===null){if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else child.kill('SIGTERM')}
 }
},180000)
