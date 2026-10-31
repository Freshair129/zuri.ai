// @req FR-294 — scoped committed content-addressed GLB reads.
// @spec SEC-001, SEC-008
// @tested tests/integration/office-design-registration.test.js
import {resolveRequestViewer} from '@/modules/identity/request-viewer'
import {readOfficeAsset} from '@/modules/business/office-design/service'
import {privateHandle,officeWorkspace} from '@/modules/business/office-design/http'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export async function GET(request,context){return privateHandle(async()=>{
 const viewer=await resolveRequestViewer(request),{id:businessId,sha256}=await context.params
 const blob=await readOfficeAsset({businessId,workspaceId:officeWorkspace(request),viewer,sha256})
 return new Response(blob.bytes,{headers:{'Content-Type':blob.mediaType,'Content-Length':String(blob.byteLength),'Content-Disposition':'attachment; filename="'+sha256+'.glb"'}})
})}
