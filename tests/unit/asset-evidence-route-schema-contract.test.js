// @req FR-137, FR-138, FR-139, FR-140 — runtime routes and additive persistence exist.
// @spec SDD-081, SDD-082, SDD-083, SDD-084, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''

describe('Asset evidence route and schema spine', () => {
  it.each([
    'src/app/api/assets/evidence/route.js',
    'src/app/api/assets/evidence/[id]/extract/route.js',
    'src/app/api/assets/evidence/[id]/review/route.js',
    'src/app/api/assets/intakes/route.js',
    'src/app/api/assets/import/template/route.js',
    'src/app/api/assets/import/xlsx/route.js',
    'src/app/api/assets/import/sheets/route.js',
    'src/app/api/assets/intakes/export/route.js',
    'src/app/api/agent/line-asset-handoff/route.js',
  ])('adds %s', (file) => expect(fs.existsSync(file), file).toBe(true))

  it('adds only additive intake snapshots and indexes their replay hash', () => {
    const schema = read('prisma/schema.prisma')
    const postgres = read('prisma/schema.postgres.prisma')
    for (const source of [schema, postgres]) {
      expect(source).toContain('payloadSha256')
      expect(source).toContain('normalizedEnvelopeJson')
      expect(source).toContain('validationJson')
      expect(source).toContain('validatedAt')
      expect(source).toMatch(/@@index\(\[businessId, payloadSha256\]\)/)
    }
    const migration = read('prisma/migrations/20260902103000_asset_evidence_intake_execution/migration.sql')
    expect(migration).toContain('ADD COLUMN "payloadSha256" TEXT')
    expect(migration).toContain('AssetIntake_businessId_payloadSha256_idx')
  })

  it('marks the receiving page operational while keeping registration and Finance outside the slice', () => {
    const page = read('src/app/(pm)/assets/receiving/page.jsx')
    const dashboard = read('src/app/(pm)/assets/page.jsx')
    expect(page).toContain('FR-137')
    expect(page).toContain('READY_FOR_REGISTRATION')
    expect(dashboard).toContain('/assets/receiving')
    expect(page).not.toMatch(/createRegisteredAsset|FINANCE_POSTING|journal/i)
  })

  it.each([
    'src/app/api/assets/intakes/route.js',
    'src/app/api/assets/import/sheets/route.js',
  ])('authorizes selected Business before reading JSON in %s', (file) => {
    const source = read(file)
    expect(source).toContain("request.headers.get('x-zuri-business-id')")
    expect(source.indexOf('resolveRequestViewer(request)')).toBeLessThan(source.indexOf('request.json()'))
    expect(source.indexOf('resolveAssetRequestScope(')).toBeLessThan(source.indexOf('request.json()'))
  })
})
