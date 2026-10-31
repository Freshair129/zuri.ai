// @req FR-294 — persisted-session Business-owned design registry, not Agent activation.
// @spec SEC-001, SEC-008
// @tested tests/integration/office-design-registration.test.js
import {NextResponse} from 'next/server'
import {resolveRequestViewer} from '@/modules/identity/request-viewer'
import {authorizeOfficeTarget,registerOfficeDesign,readOfficeDesign} from '@/modules/business/office-design/service'
import {privateHandle,officeWorkspace,officeVersion,officeCommand,readOfficeBody,assertOfficeWriteRequest,withOfficeUploadSlot} from '@/modules/business/office-design/http'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export async function POST(request,context){return privateHandle(async()=>{
 const viewer=await resolveRequestViewer(request),{id:businessId}=await context.params,workspaceId=officeWorkspace(request)
 await authorizeOfficeTarget({businessId,workspaceId,viewer})
 const command=officeCommand(request)
 await assertOfficeWriteRequest(request)
 return withOfficeUploadSlot(async()=>{
 const bytes=await readOfficeBody(request)
 const {result,replayed}=await registerOfficeDesign({businessId,workspaceId,viewer,bytes,...command})
 return NextResponse.json(result,{status:command.dryRun||replayed?200:201,headers:{ETag:`"${result.version}"`}})
 })
})}
export async function GET(request,context){return privateHandle(async()=>{
 const viewer=await resolveRequestViewer(request),{id:businessId}=await context.params
 const result=await readOfficeDesign({businessId,workspaceId:officeWorkspace(request),viewer,version:officeVersion(request)})
 return NextResponse.json(result,{headers:{ETag:`"${result.version}"`}})
})}
