// @req FR-294 — scoped design custody, atomic CAS/replay/crosswalk/audit.
// @spec SEC-001, SEC-008, BR-002
// @tested tests/integration/office-design-registration.test.js
import {randomUUID,createHash} from 'node:crypto'
import prisma from '@/lib/db'
import {resolveViewer} from '@/modules/identity/resolve-viewer'
import {ownsBusiness} from '@/modules/identity/viewer-authority'
import {recordAudit} from '@/modules/project-manager/application/audit'
import {verifyOfficeArchive,officeError} from './verify'
const SOURCE='visual-office-design',PACKAGE='e0850743-9ce9-5857-b993-0143dca37bbf'
export const OFFICE_PRODUCER_REVISION='b4e2d8edec9d8dbad32573d860cff3a6a27efbbd'
const notFound=()=>officeError(404,'OFFICE_TARGET_NOT_FOUND')
const conflict=()=>officeError(409,'OFFICE_VERSION_OR_REPLAY_CONFLICT')
const keyFor=workspaceId=>({workspaceId_source_packageId:{workspaceId,source:SOURCE,packageId:PACKAGE}})
export async function authorizeOfficeTarget({businessId,workspaceId,viewer,db=prisma}){
 if(!viewer?.principal?.id)throw notFound()
 const current=await resolveViewer({principalId:viewer.principal.id,db})
 if(!ownsBusiness(current,businessId))throw notFound()
 const workspace=await db.workspace.findUnique({where:{id:workspaceId},include:{business:{include:{tenant:true}}}})
 if(!workspace||workspace.scopeType!=='BUSINESS'||workspace.businessId!==businessId||workspace.status!=='ACTIVE'||workspace.business?.status!=='ACTIVE'||workspace.business?.tenant?.status!=='ACTIVE')throw notFound()
 return{workspaceId:workspace.id,businessId,tenantId:workspace.business.tenantId,actorId:current.principal.id}
}
function assertRegistryScope(registry,scope){if(registry&&(registry.businessId!==scope.businessId||registry.tenantId!==scope.tenantId))throw notFound()}
const countsFor=manifest=>manifest.entities.reduce((out,e)=>{out[e.type]=(out[e.type]||0)+1;return out},{})
function replay(receipt,commandHash){if(receipt.commandHash!==commandHash)throw conflict();return{result:JSON.parse(receipt.resultJson),replayed:true}}
export async function registerOfficeDesign({businessId,workspaceId,viewer,bytes,expectedVersion,requestKey,dryRun=false,db=prisma}){
 const scope=await authorizeOfficeTarget({businessId,workspaceId,viewer,db})
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>1000000000||typeof requestKey!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestKey))throw officeError(400,'OFFICE_COMMAND_INVALID')
 const verified=await verifyOfficeArchive(bytes),{manifest,assets,archiveSha256}=verified
 const commandHash=createHash('sha256').update(JSON.stringify({workspaceId,expectedVersion,contentHash:manifest.contentHash,archiveSha256})).digest('hex')
 if(dryRun){const registry=await db.officeDesignRegistry.findUnique({where:keyFor(workspaceId)});assertRegistryScope(registry,scope);if((registry?.version||0)!==expectedVersion)throw conflict();return{result:{registered:false,version:registry?.version||0,contentHash:manifest.contentHash,counts:countsFor(manifest),runtimeAgentsCreated:0,permissionsGranted:0},replayed:false}}
 try{return await db.$transaction(async tx=>{
  const fresh=await authorizeOfficeTarget({businessId,workspaceId,viewer,db:tx})
  let registry=await tx.officeDesignRegistry.findUnique({where:keyFor(workspaceId)})
  assertRegistryScope(registry,fresh)
  if(registry){const receipt=await tx.officeDesignImportReceipt.findUnique({where:{registryId_requestKey:{registryId:registry.id,requestKey}}});if(receipt)return replay(receipt,commandHash)}
  if((registry?.version||0)!==expectedVersion)throw conflict()
  if(!registry){const id=randomUUID();registry=await tx.officeDesignRegistry.create({data:{id,code:'ODR-'+id,...{tenantId:fresh.tenantId,businessId:fresh.businessId,workspaceId},source:SOURCE,packageId:PACKAGE}})}
  const changed=await tx.officeDesignRegistry.updateMany({where:{id:registry.id,version:expectedVersion},data:{version:{increment:1}}})
  if(changed.count!==1)throw conflict()
  const version=expectedVersion+1
  const existing=await tx.officeDesignIdentity.findMany({where:{registryId:registry.id}}),byExternal=new Map(existing.map(e=>[e.externalId,e])),newRows=[]
  for(const entity of manifest.entities){let row=byExternal.get(entity.id);if(row&&(row.kind!==entity.type||row.semanticKey!==entity.key))throw conflict();if(!row){const id=randomUUID();row={id,code:'ODI-'+id,registryId:registry.id,externalId:entity.id,kind:entity.type,semanticKey:entity.key};newRows.push(row);byExternal.set(entity.id,row)}}
  for(let i=0;i<newRows.length;i+=100)await tx.officeDesignIdentity.createMany({data:newRows.slice(i,i+100)})
  const present=new Set((await tx.officeDesignBlob.findMany({where:{registryId:registry.id},select:{sha256:true}})).map(b=>b.sha256))
  for(const asset of assets)if(!present.has(asset.sha256))await tx.officeDesignBlob.create({data:{registryId:registry.id,sha256:asset.sha256,byteLength:asset.byteLength,bytes:Buffer.from(asset.bytes)}})
  const revision=await tx.officeDesignRevision.create({data:{registryId:registry.id,version,contentHash:manifest.contentHash,archiveSha256,manifestJson:JSON.stringify(manifest),producerRevision:OFFICE_PRODUCER_REVISION,createdByPersonId:fresh.actorId}})
  const mapping=manifest.entities.map(e=>{const r=byExternal.get(e.id);return{externalSource:SOURCE,externalId:e.id,kind:e.type,key:e.key,zuriId:r.id,code:r.code,version}})
  const audit=await recordAudit(tx,{entityType:'OFFICE_DESIGN',entityId:registry.id,action:'REGISTER_DESIGN_REVISION',actorId:fresh.actorId,tenantId:fresh.tenantId,businessId:fresh.businessId,payload:{workspaceId,revisionId:revision.id,version,contentHash:manifest.contentHash,counts:countsFor(manifest),runtimeAgentsCreated:0,permissionsGranted:0}})
  const result={registered:true,registrationKind:'visual-design',registryId:registry.id,revisionId:revision.id,tenantId:fresh.tenantId,businessId:fresh.businessId,workspaceId,version,contentHash:manifest.contentHash,mapping,auditEventId:audit.id,runtimeAgentsCreated:0,permissionsGranted:0}
  await tx.officeDesignImportReceipt.create({data:{registryId:registry.id,requestKey,commandHash,resultJson:JSON.stringify(result),version}})
  return{result,replayed:false}
 },{maxWait:4000,timeout:120000})}catch(error){
  // A competing insert/CAS rolls back. A committed same-command winner may be replayed.
  if(['P2002','P2034','P1008','P2028'].includes(error?.code)){
   await authorizeOfficeTarget({businessId,workspaceId,viewer,db})
   const registry=await db.officeDesignRegistry.findUnique({where:keyFor(workspaceId)});assertRegistryScope(registry,scope)
   const receipt=registry&&await db.officeDesignImportReceipt.findUnique({where:{registryId_requestKey:{registryId:registry.id,requestKey}}})
   if(receipt)return replay(receipt,commandHash)
   throw conflict()
  }
  throw error
 }
}
export async function readOfficeDesign({businessId,workspaceId,viewer,version,db=prisma}){
 const scope=await authorizeOfficeTarget({businessId,workspaceId,viewer,db}),registry=await db.officeDesignRegistry.findUnique({where:keyFor(workspaceId)})
 assertRegistryScope(registry,scope);if(!registry)throw notFound()
 const selected=version??registry.version
 if(!Number.isSafeInteger(selected)||selected<1)throw officeError(400,'OFFICE_VERSION_INVALID')
 const revision=await db.officeDesignRevision.findUnique({where:{registryId_version:{registryId:registry.id,version:selected}}})
 if(!revision)throw notFound()
 const receipt=await db.officeDesignImportReceipt.findFirst({where:{registryId:registry.id,version:selected}})
 if(!receipt)throw officeError(503,'OFFICE_REGISTRATION_INCOMPLETE')
 return{...JSON.parse(receipt.resultJson),producerRevision:revision.producerRevision,manifest:JSON.parse(revision.manifestJson)}
}
export async function readOfficeAsset({businessId,workspaceId,viewer,sha256,db=prisma}){
 const scope=await authorizeOfficeTarget({businessId,workspaceId,viewer,db})
 if(!/^[a-f0-9]{64}$/.test(sha256))throw notFound()
 const registry=await db.officeDesignRegistry.findUnique({where:keyFor(workspaceId)});assertRegistryScope(registry,scope);if(!registry)throw notFound()
 const blob=await db.officeDesignBlob.findUnique({where:{registryId_sha256:{registryId:registry.id,sha256}}})
 if(!blob)throw notFound()
 if(blob.bytes.length!==blob.byteLength||createHash('sha256').update(blob.bytes).digest('hex')!==sha256)throw officeError(503,'OFFICE_ASSET_INTEGRITY_FAILED')
 return blob
}
