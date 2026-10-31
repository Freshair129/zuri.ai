// @req FR-295 — list active design destinations for the current Business owner.
// @tested tests/integration/office-design-registration.test.js
import prisma from '@/lib/db'
import {resolveRequestViewer} from '@/modules/identity/request-viewer'
import {privateHandle} from '@/modules/business/office-design/http'

export const dynamic = 'force-dynamic'
export async function GET(request) {
 return privateHandle(async () => {
  const viewer = await resolveRequestViewer(request)
  const owned = viewer.ownedBusinessIds || []
  const workspaces = await prisma.workspace.findMany({
   where: {scopeType:'BUSINESS', status:'ACTIVE', businessId:{in:owned}, business:{status:'ACTIVE',tenant:{status:'ACTIVE'}}},
   select: {id:true,name:true,code:true,business:{select:{id:true,name:true,code:true}}},
   orderBy: [{name:'asc'},{id:'asc'}],
  })
  const registries=await prisma.officeDesignRegistry.findMany({where:{workspaceId:{in:workspaces.map(w=>w.id)},source:'visual-office-design',packageId:'e0850743-9ce9-5857-b993-0143dca37bbf'},select:{workspaceId:true,version:true}})
  const versions=new Map(registries.map(r=>[r.workspaceId,r.version]))
  return {targets:workspaces.map(w=>({businessId:w.business.id,businessName:w.business.name,businessCode:w.business.code,workspaceId:w.id,workspaceName:w.name,workspaceCode:w.code,version:versions.get(w.id)||0}))}
 })
}
