// @req FR-133, FR-134, FR-135, FR-136 — foundation exposes a guarded dashboard
// and preview-only validation route without false provider or accounting claims.
// @spec SDD-078, SDD-079, SDD-080, SEC-023, ADR-055
// @tested tests/unit/asset-management-api-ui-contract.test.js
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (file) => fs.readFileSync(file, 'utf8')

describe('Asset Management API/UI foundation', () => {
  it('has one dashboard and one preview validator surface', () => {
    expect(fs.existsSync('src/app/(pm)/assets/page.jsx')).toBe(true)
    expect(fs.existsSync('src/app/api/assets/intakes/validate/route.js')).toBe(true)
  })

  it('resolves viewer and Business/domain scope before validation', () => {
    const route = read('src/app/api/assets/intakes/validate/route.js')
    const viewerAt = route.indexOf('resolveRequestViewer(request)')
    const scopeAt = route.indexOf('seesBusiness(viewer, businessId)')
    const lookupAt = route.indexOf('prisma.business.findUnique')
    const validateAt = route.indexOf('validateAssetIntake(body')
    expect(viewerAt).toBeGreaterThan(-1)
    expect(scopeAt).toBeGreaterThan(viewerAt)
    expect(lookupAt).toBeGreaterThan(scopeAt)
    expect(validateAt).toBeGreaterThan(lookupAt)
  })

  it('labels the route preview-only and performs no Asset persistence', () => {
    const route = read('src/app/api/assets/intakes/validate/route.js')
    expect(route).toContain("mode: 'PREVIEW_ONLY'")
    expect(route).toContain('applied: false')
    expect(route).not.toMatch(/\.(registeredAsset|assetIntake|assetEvidence)\.(create|update|upsert|delete)/)
  })

  it('shows external adapters unavailable and Finance as preview only', () => {
    const page = read('src/app/(pm)/assets/page.jsx')
    expect(page).toContain('Adapter ที่ยังไม่พร้อมใช้งาน')
    expect(page).toContain('Finance boundary')
    expect(page).toContain('Preview only')
    expect(page).not.toContain('CONNECTED')
  })
})
