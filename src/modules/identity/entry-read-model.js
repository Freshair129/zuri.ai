import { z } from 'zod'
import prisma from '@/lib/db'

// @req FR-046 — Business Routing receives only authorized Businesses and ancestry.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-entry-read-model.test.js, tests/integration/fr046-entry-contract.test.js

export const zEntryResponse = z.object({
  viewer: z.object({
    principal: z.object({ id: z.string().min(1), displayName: z.string() }).strict(),
    role: z.enum(['OWNER', 'MEMBER', 'DEV']),
    visibleDomains: z.array(z.string()),
    isPlatform: z.boolean(),
  }).strict(),
  businesses: z.array(z.object({
    id: z.string().min(1),
    code: z.string().min(1),
    name: z.string().min(1),
    tenant: z.object({ id: z.string().min(1), code: z.string().min(1), name: z.string().min(1) }).strict(),
    portfolio: z.object({ id: z.string().min(1), code: z.string().min(1), name: z.string().min(1) }).strict(),
  }).strict()),
}).strict()

function viewerDto(viewer) {
  return {
    principal: { id: viewer.principal.id, displayName: viewer.principal.displayName || '' },
    role: viewer.role,
    visibleDomains: Array.isArray(viewer.visibleDomains) ? viewer.visibleDomains : [],
    isPlatform: viewer.isPlatform === true,
  }
}

export async function buildViewerEntry({ viewer, db = prisma }) {
  const allowedIds = [...new Set((viewer.visibleBusinessIds || []).filter(Boolean))]
  if (allowedIds.length === 0) {
    return zEntryResponse.parse({ viewer: viewerDto(viewer), businesses: [] })
  }

  const rows = await db.business.findMany({
    where: { id: { in: allowedIds } },
    orderBy: [{ name: 'asc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      tenant: {
        select: {
          id: true,
          code: true,
          name: true,
          portfolio: { select: { id: true, code: true, name: true } },
        },
      },
    },
  })

  const allowed = new Set(allowedIds)
  if (rows.some((row) => !allowed.has(row.id))) throw new Error('ENTRY_SCOPE_VIOLATION')

  return zEntryResponse.parse({
    viewer: viewerDto(viewer),
    businesses: rows.map((business) => ({
      id: business.id,
      code: business.code,
      name: business.name,
      tenant: {
        id: business.tenant.id,
        code: business.tenant.code,
        name: business.tenant.name,
      },
      portfolio: {
        id: business.tenant.portfolio.id,
        code: business.tenant.portfolio.code,
        name: business.tenant.portfolio.name,
      },
    })),
  })
}
