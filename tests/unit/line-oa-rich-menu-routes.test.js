// @req FR-148 — what the rich menu routes are, in source terms: they resolve a
//   browser viewer on every method, stay thin, and are inventoried for OpenAPI.
// @spec ADR-060 D11; SEC-001; FR-061
// @tested tests/unit/line-oa-rich-menu-routes.test.js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'

const read = (relative) => readFileSync(path.join(process.cwd(), relative), 'utf8')

const COLLECTION = 'src/app/api/line-oa/rich-menus/route.js'
const ITEM = 'src/app/api/line-oa/rich-menus/[id]/route.js'

describe('FR-148 rich menu route contract', () => {
  it('lists and creates on the collection, reads and acts on the item', () => {
    const collection = read(COLLECTION)
    expect(collection).toMatch(/export async function GET/)
    expect(collection).toMatch(/export async function POST/)
    expect(collection).not.toMatch(/export async function (PATCH|DELETE)/)
    const item = read(ITEM)
    expect(item).toMatch(/export async function GET/)
    expect(item).toMatch(/export async function PATCH/)
    // Archive is an action with a version, never a DELETE: frozen versions survive.
    expect(item).not.toMatch(/export async function DELETE/)
  })

  it('resolves a trusted viewer on every method and passes it to the service', () => {
    for (const file of [COLLECTION, ITEM]) {
      const source = read(file)
      expect(source).toMatch(/resolveRequestViewer/)
      expect(source).toMatch(/@req FR-148/)
      expect(source).not.toMatch(/@\/lib\/db|prisma\./)
    }
  })

  it('is inventoried for the OpenAPI document', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    expect(paths['/api/line-oa/rich-menus']).toEqual(['GET', 'POST'])
    expect(paths['/api/line-oa/rich-menus/{id}']).toEqual(['GET', 'PATCH'])
  })
})
