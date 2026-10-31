// @req FR-294 — authenticated HTTP → real database → reopened readback.
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {describe,it,expect,beforeAll} from 'vitest'
import prisma from '@/lib/db'
import {POST,GET} from '@/app/api/businesses/[id]/office-designs/route'
import {GET as getAsset} from '@/app/api/businesses/[id]/office-designs/assets/[sha256]/route'
import {GET as getCsrf} from '@/app/api/auth/csrf/route'
import {generateSessionToken,hashSessionToken} from '@/modules/identity/auth-service'
import {createPortfolio,createTenant,createBusiness,createWorkspace} from '../factories/scope'
import {persistImportViewer} from '../helpers/persist-import-viewer'
import {makeViewer} from '../factories/viewer'
import {registerOfficeDesign} from '@/modules/business/office-design/service'
import {readHandoffArchive} from '../../vendor/office-design/archive.mjs'
import {handoffZip,canonicalJSON,sha256} from '../../vendor/office-design/verifier.mjs'
const stock=gunzipSync(readFileSync(new URL('../fixtures/office-design/stock.zip.gz',import.meta.url)))
const custom=gunzipSync(readFileSync(new URL('../fixtures/office-design/custom.zip.gz',import.meta.url)))
let a,b,owner,member,cookie,memberCookie,sessionId,revisionOne,initialAgents,initialApprovals,csrf
async function scope(){const suffix=randomUUID();const p=await createPortfolio({code:'PF-'+suffix,name:'Office test'});const t=await createTenant({portfolioId:p.id,code:'TN-'+suffix,name:'Office test'});const business=await createBusiness({tenantId:t.id,code:'BU-'+suffix,name:'Office test'});const workspace=await createWorkspace({businessId:business.id,scopeType:'BUSINESS',code:'WS-'+suffix,name:'Office test'});return{business,workspace,tenant:t}}
async function session(viewer){const id=randomUUID(),token=generateSessionToken(viewer.principal.id,{sessionId:id});await prisma.session.create({data:{id,personId:viewer.principal.id,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+600000)}});return{id,cookie:'zuri_session='+token}}
const url=s=>`http://localhost/api/businesses/${s.business.id}/office-designs?workspaceId=${s.workspace.id}`
const context=s=>({params:Promise.resolve({id:s.business.id})})
const request=(s,{method='POST',bytes=stock,token=cookie,version=0,key='first',headers={},suffix=''}={})=>new Request(url(s)+suffix,{method,headers:{cookie:token,'content-type':'application/zip','if-match':`"${version}"`,'idempotency-key':key,origin:'http://localhost','x-csrf-token':csrf,...headers},...(method==='POST'?{body:bytes}:{})})
describe.sequential('Office design HTTP database lifecycle',()=>{
 beforeAll(async()=>{process.env.PUBLIC_BASE_URL='http://localhost';process.env.ZURI_SESSION_SECRET='office-test-only-isolated-session-secret-123456';a=await scope();b=await scope();owner=await persistImportViewer(makeViewer({visibleBusinessIds:[a.business.id,b.business.id],ownedBusinessIds:[a.business.id,b.business.id]}));member=await persistImportViewer(makeViewer({visibleBusinessIds:[a.business.id],ownedBusinessIds:[]}));const s=await session(owner);cookie=s.cookie;sessionId=s.id;memberCookie=(await session(member)).cookie;csrf=(await(await getCsrf(new Request('http://localhost/api/auth/csrf',{headers:{cookie,origin:'http://localhost'}}))).json()).token;expect(csrf).toBeTypeOf('string');initialAgents=await prisma.businessAgentConfig.count();initialApprovals=await prisma.agentApprovalRequest.count()})
 it('authenticates before reading input and makes absent/unauthorized targets indistinguishable',async()=>{
  expect((await POST(request(a,{token:''}),context(a))).status).toBe(401)
  const denied=await POST(request(a,{token:memberCookie}),context(a)),missing=await POST(request({...a,workspace:{id:randomUUID()}},{token:memberCookie}),context(a))
  expect(denied.status).toBe(404);expect(await denied.json()).toEqual(await missing.json())
  expect((await POST(request({...a,business:b.business},{token:memberCookie}),context(b))).status).toBe(404)
 })
 it('previews the real package with no registry or fake Agent/approval rows',async()=>{
  const before=await prisma.businessAgentConfig.count(),approvals=await prisma.agentApprovalRequest.count()
  const response=await POST(request(a,{suffix:'&dryRun=1'}),context(a)),body=await response.json()
  expect(response.status).toBe(200);expect(body.registered).toBe(false);expect(body.counts.floor).toBe(15);expect(body.counts.agentDesign).toBe(60)
  expect(await prisma.officeDesignRegistry.count({where:{workspaceId:a.workspace.id}})).toBe(0);expect(await prisma.businessAgentConfig.count()).toBe(before);expect(await prisma.agentApprovalRequest.count()).toBe(approvals)
 },60000)
 it('commits all IDs/blobs once, audits actual scope and actor, then reads after DB reconnect',async()=>{
  const response=await POST(request(a),context(a));revisionOne=await response.json()
  expect(response.status).toBe(201);expect(revisionOne.registered).toBe(true);expect(revisionOne.version).toBe(1)
  expect(revisionOne.mapping).toHaveLength(1655);expect(revisionOne.mapping.every(r=>r.zuriId!==r.externalId&&r.version===1)).toBe(true)
  expect(revisionOne.runtimeAgentsCreated).toBe(0);expect(revisionOne.permissionsGranted).toBe(0)
  expect(await prisma.officeDesignIdentity.count({where:{registryId:revisionOne.registryId}})).toBe(1655);expect(await prisma.officeDesignBlob.count({where:{registryId:revisionOne.registryId}})).toBe(17)
  const audit=await prisma.auditEvent.findUnique({where:{id:revisionOne.auditEventId}})
  expect(audit).toMatchObject({tenantId:a.tenant.id,businessId:a.business.id,actorId:owner.principal.id,entityType:'OFFICE_DESIGN',action:'REGISTER_DESIGN_REVISION'})
  await prisma.$disconnect()
  const read=await GET(request(a,{method:'GET'}),context(a)),body=await read.json()
  expect(read.status).toBe(200);expect(body.mapping).toEqual(revisionOne.mapping);expect(body.manifest.entities).toHaveLength(1655);expect(read.headers.get('cache-control')).toContain('no-store')
  const manifest=body.manifest,r=manifest.entities.find(e=>e.type==='assetRevision'),files=readHandoffArchive(stock)
  const assetResponse=await getAsset(new Request(url(a).replace('office-designs?','office-designs/assets/'+r.data.sha256+'?'),{headers:{cookie}}),{params:Promise.resolve({id:a.business.id,sha256:r.data.sha256})})
  expect(assetResponse.status).toBe(200);expect(Buffer.from(await assetResponse.arrayBuffer())).toEqual(files.get(r.data.uri))
 },60000)
 it('returns exactly the first committed receipt on retry; conflicts on key reuse or stale revisions',async()=>{
  const retry=await POST(request(a),context(a));expect(retry.status).toBe(200);expect(await retry.json()).toEqual(revisionOne)
  expect((await POST(request(a,{bytes:custom,version:1,key:'first'}),context(a))).status).toBe(409)
  expect((await POST(request(a,{bytes:custom,key:'stale'}),context(a))).status).toBe(409)
  expect(await prisma.officeDesignRevision.count({where:{registryId:revisionOne.registryId}})).toBe(1)
 },60000)
 it('accepts the real custom chair revision while preserving existing identities and old readback',async()=>{
  const response=await POST(request(a,{bytes:custom,version:1,key:'custom'}),context(a)),body=await response.json()
  expect(response.status).toBe(201);expect(body.version).toBe(2);expect(body.mapping).toHaveLength(1658)
  for(const entry of revisionOne.mapping)expect(body.mapping.find(e=>e.externalId===entry.externalId)?.zuriId).toBe(entry.zuriId)
  const old=await GET(request(a,{method:'GET',suffix:'&version=1'}),context(a));expect((await old.json()).mapping).toEqual(revisionOne.mapping)
  expect(await prisma.businessAgentConfig.count()).toBe(initialAgents);expect(await prisma.agentApprovalRequest.count()).toBe(initialApprovals)
 },60000)
 it('uses different internal IDs for the same external package in another Tenant',async()=>{
  const response=await POST(request(b),context(b)),body=await response.json()
  expect(response.status).toBe(201);expect(body.mapping[0].externalId).toBe(revisionOne.mapping[0].externalId);expect(body.mapping[0].zuriId).not.toBe(revisionOne.mapping[0].zuriId)
 },60000)
 it('rejects corrupt body, cross-origin write, missing precondition and invalid version without partial writes',async()=>{
  const before=await prisma.officeDesignRevision.count()
  expect((await POST(request(a,{bytes:Buffer.from('bad'),version:2,key:'bad'}),context(a))).status).toBe(422)
  expect((await POST(request(a,{headers:{origin:'http://evil.example'}}),context(a))).status).toBe(403)
  expect((await POST(request(a,{headers:{'x-csrf-token':''}}),context(a))).status).toBe(403)
  expect((await POST(request(a,{headers:{'if-match':''}}),context(a))).status).toBe(428)
  expect((await GET(request(a,{method:'GET',suffix:'&version=-1'}),context(a))).status).toBe(400)
  expect(await prisma.officeDesignRevision.count()).toBe(before)
 })
 it('rolls back identities, blobs, revision and CAS when the final audit write fails',async()=>{
  const workspace=await createWorkspace({businessId:a.business.id,scopeType:'BUSINESS',code:'WS-FAIL-'+randomUUID(),name:'Rollback test'})
  const before={identities:await prisma.officeDesignIdentity.count(),blobs:await prisma.officeDesignBlob.count(),audit:await prisma.auditEvent.count()}
  const db=new Proxy(prisma,{get(target,key){if(key==='$transaction')return(fn,options)=>prisma.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditEvent')return{create:async()=>{throw Error('INJECTED_AUDIT_FAILURE')}};return t[k]}})),options);return target[key]}})
  await expect(registerOfficeDesign({businessId:a.business.id,workspaceId:workspace.id,viewer:owner,bytes:stock,expectedVersion:0,requestKey:'rollback',db})).rejects.toThrow('INJECTED_AUDIT_FAILURE')
  expect(await prisma.officeDesignRegistry.count({where:{workspaceId:workspace.id}})).toBe(0)
  expect(await prisma.officeDesignIdentity.count()).toBe(before.identities);expect(await prisma.officeDesignBlob.count()).toBe(before.blobs);expect(await prisma.auditEvent.count()).toBe(before.audit)
 },60000)
 it('serializes concurrent initial delivery and concurrent different writes without duplicate mappings',async()=>{
  const workspace=await createWorkspace({businessId:a.business.id,scopeType:'BUSINESS',code:'WS-RACE-'+randomUUID(),name:'Race test'}),s={...a,workspace}
  const first=await Promise.all([POST(request(s),context(s)),POST(request(s),context(s))])
  expect(first.filter(r=>r.status===201)).toHaveLength(1);expect(first.every(r=>[200,201,409].includes(r.status))).toBe(true)
  const retry=await POST(request(s),context(s));expect(retry.status).toBe(200);const body=await retry.json();expect(body.mapping).toHaveLength(1655)
  const next=await Promise.all([POST(request(s,{version:1,key:'race-a',bytes:custom}),context(s)),POST(request(s,{version:1,key:'race-b'}),context(s))])
  expect(next.map(r=>r.status).sort()).toEqual([201,409])
  expect(await prisma.officeDesignRevision.count({where:{registryId:body.registryId}})).toBe(2)
  expect(await prisma.officeDesignIdentity.count({where:{registryId:body.registryId,kind:'floor'}})).toBe(15)
 },120000)
 it('checks persisted membership again and revoked sessions deny both read and retry',async()=>{
  await prisma.membership.updateMany({where:{personId:owner.principal.id,businessId:a.business.id},data:{status:'REVOKED'}})
  expect((await GET(request(a,{method:'GET'}),context(a))).status).toBe(404)
  expect((await POST(request(a),context(a))).status).toBe(404)
  await prisma.session.update({where:{id:sessionId},data:{status:'REVOKED'}})
  expect((await GET(request(b,{method:'GET'}),context(b))).status).toBe(401)
 })
})
