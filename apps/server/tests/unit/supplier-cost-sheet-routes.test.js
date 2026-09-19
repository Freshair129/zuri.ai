import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   the route surface is thin, viewer-resolved and inventoried.
// @tested tests/unit/supplier-cost-sheet-routes.test.js

const ROUTES = {
  'src/app/api/procurement/cost-sheets/route.js': ['GET'],
  'src/app/api/procurement/cost-sheets/preview/route.js': ['POST'],
  'src/app/api/procurement/cost-sheets/xlsx/route.js': ['POST'],
  'src/app/api/procurement/cost-sheets/commit/route.js': ['POST'],
  'src/app/api/procurement/cost-sheets/template/route.js': ['GET'],
  'src/app/api/procurement/cost-sheets/[id]/route.js': ['GET'],
}

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('supplier cost-sheet routes', () => {
  it('keeps every handler thin and viewer-resolved', () => {
    for (const [file, methods] of Object.entries(ROUTES)) {
      const source = read(file)
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        expect(new RegExp('export async function ' + method + '\\b').test(source), method + ' in ' + file).toBe(methods.includes(method))
      }
      expect(source).toMatch(/resolveRequestViewer/)
      expect(source).toMatch(/ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913/)
      expect(source).not.toMatch(/@\/lib\/db|prisma\./)
    }
  })

  it('is represented in the OpenAPI route inventory', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    for (const [file, methods] of Object.entries(ROUTES)) {
      const apiPath = file.replace('src/app', '').replace('/route.js', '').replace('[id]', '{id}')
      expect(paths[apiPath], apiPath).toEqual(methods)
    }
  })
})
