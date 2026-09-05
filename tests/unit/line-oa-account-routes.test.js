// @req FR-146 — what the account routes are, in source terms: they resolve a
//   browser viewer on every method, stay thin, are inventoried for OpenAPI,
//   and the domain slot and publisher role they depend on exist.
// @spec ADR-060 D11, D12; SEC-001; FR-061; FR-076
// @tested tests/unit/line-oa-account-routes.test.js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'
import { DOMAINS, domainForPath, isDomainVisible } from '@/config/domains'
import { LINE_OA_PUBLISH_PERMISSION, ROLE_LINE_OA_PUBLISHER, ROLE_PERMISSIONS, permissionsForRoles } from '@/modules/identity/rbac'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'

const read = (relative) => readFileSync(path.join(process.cwd(), relative), 'utf8')

const COLLECTION = 'src/app/api/line-oa/accounts/route.js'
const ITEM = 'src/app/api/line-oa/accounts/[id]/route.js'

describe('FR-146 account route contract', () => {
  it('lists and connects on the collection, reads and acts on the item', () => {
    const collection = read(COLLECTION)
    expect(collection).toMatch(/export async function GET/)
    expect(collection).toMatch(/export async function POST/)
    expect(collection).not.toMatch(/export async function (PATCH|DELETE)/)
    const item = read(ITEM)
    expect(item).toMatch(/export async function GET/)
    expect(item).toMatch(/export async function PATCH/)
    // Archive is an action with a version, never a DELETE: the row survives.
    expect(item).not.toMatch(/export async function DELETE/)
  })

  it('resolves a trusted viewer on every method and passes it to the service', () => {
    for (const file of [COLLECTION, ITEM]) {
      const source = read(file)
      expect(source).toMatch(/resolveRequestViewer/)
      expect(source).toMatch(/@req FR-146/)
      // No scope is taken from the request: the service validates businessId
      // against the viewer, so the route must not touch prisma itself.
      expect(source).not.toMatch(/@\/lib\/db|prisma\./)
    }
  })

  it('is inventoried for the OpenAPI document', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    expect(paths['/api/line-oa/accounts']).toEqual(['GET', 'POST'])
    expect(paths['/api/line-oa/accounts/{id}']).toEqual(['GET', 'PATCH'])
  })

  it('registers the line-oa domain slot as reserved, so a grant can name it and nothing renders it yet', () => {
    const slot = DOMAINS.find((domain) => domain.key === 'line-oa')
    expect(slot).toBeTruthy()
    expect(slot.label).toBe('LINE OA Studio')
    expect(slot.soon).toBe(true)
    expect(slot.sub[0]).toMatchObject({ label: 'Dashboard', path: '/line-oa' })
    expect(domainForPath('/line-oa').key).toBe('line-oa')
    // FR-061: the key must be in the registry for a Membership grant to carry it.
    expect(VIEWER_DOMAINS).toContain('line-oa')
    expect(isDomainVisible('line-oa', ['line-oa'])).toBe(true)
    expect(isDomainVisible('line-oa', ['projects'])).toBe(false)
  })

  it('declares the confirmed publisher role and its single permission', () => {
    expect(ROLE_LINE_OA_PUBLISHER).toBe('LINE_OA_PUBLISHER')
    expect(ROLE_PERMISSIONS[ROLE_LINE_OA_PUBLISHER]).toContain(LINE_OA_PUBLISH_PERMISSION)
    expect(permissionsForRoles([ROLE_LINE_OA_PUBLISHER])).toContain(LINE_OA_PUBLISH_PERMISSION)
    // The publisher role grants nothing outside the Studio.
    expect(ROLE_PERMISSIONS[ROLE_LINE_OA_PUBLISHER].every((permission) => permission.startsWith('line-oa.'))).toBe(true)
  })
})
