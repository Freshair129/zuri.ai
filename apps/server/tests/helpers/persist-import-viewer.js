// @req FR-084 — retained import fixtures use actual IAM rows for commit-time fences.
// @spec SEC-001, SEC-008
import {randomUUID} from 'node:crypto'
import prisma from '@/lib/db'
import {resolveViewer} from '@/modules/identity/resolve-viewer'
import {makeViewer} from '../factories/viewer'
export async function persistImportViewer(requested,{db=prisma,preservePrincipalId=false}={}) {
 const id=preservePrincipalId?requested.principal.id:randomUUID()
 const person=await db.person.upsert({where:{id},create:{id,code:'PER-IMPORT-'+randomUUID(),displayName:'Isolated import fixture'},update:{}})
 for(const businessId of requested.visibleBusinessIds) {
  const business=await db.business.findUnique({where:{id:businessId}})
  if(!business) throw new Error('Import fixture must name a real Business')
  const role=requested.ownedBusinessIds.includes(businessId)?'OWNER':'MEMBER'
  const exists=await db.membership.findFirst({where:{personId:id,businessId}})
  if(!exists) await db.membership.create({data:{personId:id,tenantId:business.tenantId,businessId,role}})
 }
 return makeViewer(await resolveViewer({principalId:person.id,db}))
}
