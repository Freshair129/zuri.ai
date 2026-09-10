// @req FR-182 — what the SCM operations console IS, in source terms: thirteen
//   thin handlers that resolve a viewer and call one exported service, never
//   Prisma; each inventoried for OpenAPI; the work-order verbs declared once as
//   a vocabulary rather than branched on per route; and four pages that render
//   the same tab list the sidebar lists, from one source each.
// @spec ADR-074; SEC-001; FR-170; FR-072
// @tested tests/unit/scm-console-routes.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'
import { DOMAINS } from '@/config/domains'
import { INVENTORY_TABS } from '@/lib/module-tabs'
import { WORK_ORDER_ACTIONS } from '@/lib/validation/enums'
import { zWorkOrderAction } from '@/modules/inventory/domain/inventory-wip'

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

const ROUTES = {
  'src/app/api/inventory/locations/route.js': ['GET', 'POST'],
  'src/app/api/inventory/locations/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/inventory/location-stock/route.js': ['GET'],
  'src/app/api/inventory/transfers/route.js': ['POST'],
  'src/app/api/inventory/customization-work-orders/route.js': ['GET', 'POST'],
  'src/app/api/inventory/customization-work-orders/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/inventory/kitting-work-orders/route.js': ['GET', 'POST'],
  'src/app/api/inventory/kitting-work-orders/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/inventory/reservations/route.js': ['GET', 'POST'],
  'src/app/api/inventory/reservations/[id]/route.js': ['PATCH'],
  'src/app/api/inventory/atp/route.js': ['GET'],
  'src/app/api/inventory/shelf-life/route.js': ['GET', 'POST'],
  'src/app/api/inventory/de-kitting/route.js': ['POST'],
}

const PAGES = [
  'src/app/(pm)/inventory/page.jsx',
  'src/app/(pm)/inventory/locations/page.jsx',
  'src/app/(pm)/inventory/work-orders/page.jsx',
  'src/app/(pm)/inventory/reservations/page.jsx',
]

describe('FR-182 SCM operations console — route contract', () => {
  it('every handler exposes exactly its inventoried methods, resolves a viewer, and never deletes', () => {
    for (const [file, methods] of Object.entries(ROUTES)) {
      const source = read(file)
      for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
        const declared = new RegExp(`export async function ${method}\\b`).test(source)
        expect(declared, `${method} in ${file}`).toBe(methods.includes(method))
      }
      expect(source, file).toMatch(/resolveRequestViewer/)
      expect(source, file).toMatch(/@req FR-182/)
    }
  })

  it('stays thin: a handler reaches the database only through the Inventory module, never Prisma', () => {
    for (const file of Object.keys(ROUTES)) {
      const source = read(file)
      // The one rule that keeps every authority check, refusal code and audit
      // row in the service rather than re-implemented at the edge.
      expect(source, file).not.toMatch(/@\/lib\/db|prisma\./)
      expect(source, file).toMatch(/@\/modules\/inventory\/application\//)
      // No handler builds its own scope: `businessId` always arrives from the
      // caller and is validated by the service against the trusted viewer.
      expect(source, file).not.toMatch(/tenantId/)
    }
  })

  it('is inventoried for the OpenAPI document', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    for (const [file, methods] of Object.entries(ROUTES)) {
      const apiPath = file.replace('src/app', '').replace('/route.js', '').replace('[id]', '{id}')
      expect(paths[apiPath], apiPath).toEqual(methods)
    }
  })

  it('reservations expose no single-row GET and no DELETE, because a hold is never deleted', () => {
    const source = read('src/app/api/inventory/reservations/[id]/route.js')
    expect(source).not.toMatch(/export async function (GET|DELETE)\b/)
    // RELEASE / CONVERT end it; the list route reads it with the computed `live`.
    expect(read('src/app/api/inventory/reservations/route.js')).toMatch(/export async function GET\b/)
  })
})

describe('FR-182 work-order verbs are one declared vocabulary', () => {
  it('both work-order routes dispatch a validated action rather than branching on a string', () => {
    for (const file of [
      'src/app/api/inventory/customization-work-orders/[id]/route.js',
      'src/app/api/inventory/kitting-work-orders/[id]/route.js',
    ]) {
      const source = read(file)
      expect(source, file).toMatch(/apply(Customization|Kitting)WorkOrderAction/)
      // The handler must not contain the verbs itself — that is the difference
      // between dispatching and branching, and it is what stops a fourth verb
      // appearing in one route and not the other.
      expect(source.match(/'(RELEASE|COMPLETE|CANCEL)'/), file).toBeNull()
    }
  })

  it('the vocabulary is RELEASE, COMPLETE, CANCEL and nothing else', () => {
    expect(WORK_ORDER_ACTIONS).toEqual(['RELEASE', 'COMPLETE', 'CANCEL'])
    expect(() => zWorkOrderAction.parse({ businessId: 'b', action: 'DELETE', version: 1 })).toThrow()
    expect(zWorkOrderAction.parse({ businessId: 'b', action: 'RELEASE', version: 1 }).action).toBe('RELEASE')
  })

  it('only COMPLETE carries produced and scrapped quantities', () => {
    expect(() => zWorkOrderAction.parse({ businessId: 'b', action: 'RELEASE', version: 1, completedQty: 5 })).toThrow()
    expect(() => zWorkOrderAction.parse({ businessId: 'b', action: 'CANCEL', version: 1, assembledQty: 5 })).toThrow()
    expect(zWorkOrderAction.parse({ businessId: 'b', action: 'COMPLETE', version: 1, completedQty: 5, scrapQty: 1 }).completedQty).toBe(5)
  })
})

describe('FR-182 console pages (FR-170)', () => {
  it('every page renders the shared tab list and reads the selected Business from scope', () => {
    for (const file of PAGES) {
      const source = read(file)
      expect(source, file).toMatch(/<ModuleTabs tabs=\{INVENTORY_TABS\}/)
      expect(source, file).toMatch(/useScope\(\)/)
      // A page never queries the database directly; it calls the routes above.
      expect(source, file).not.toMatch(/@\/lib\/db|@\/modules\/inventory\/application/)
    }
  })

  it('the tab list and the sidebar list name the same five paths, in the same order', () => {
    const inventory = DOMAINS.find((d) => d.key === 'inventory')
    expect(inventory.sub.map((s) => s.path)).toEqual(INVENTORY_TABS.map((t) => t.path))
    expect(INVENTORY_TABS.map((t) => t.path)).toEqual([
      '/inventory', '/inventory/locations', '/inventory/work-orders', '/inventory/reservations',
      '/inventory/stocktakes',
    ])
  })

  it('every tab path has a page file behind it', () => {
    for (const tab of INVENTORY_TABS) {
      const file = `src/app/(pm)${tab.path}/page.jsx`
      expect(fs.existsSync(path.join(process.cwd(), file)), file).toBe(true)
    }
  })
})
