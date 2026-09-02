// @req FR-133, FR-134, FR-135, FR-136 — Asset foundation persistence is
// additive, scoped, versioned and included in recoverable snapshots.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-management-schema-contract.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

const MODEL_NAMES = [
  'RegisteredAsset',
  'AssetIntake',
  'AssetEvidence',
  'AssetProcurementRef',
  'AssetLot',
  'AssetResponsibility',
  'AssetLocationHistory',
  'AssetProjectAllocation',
  'AssetDepreciationCandidate',
]

const DELEGATE_NAMES = MODEL_NAMES.map((name) => name[0].toLowerCase() + name.slice(1))

describe('Asset Management Prisma and backup contract', () => {
  it.each(MODEL_NAMES)('declares additive model %s in both provider schemas', (model) => {
    const sqlite = read('prisma/schema.prisma')
    const postgres = read('prisma/schema.postgres.prisma')
    expect(sqlite).toContain(`model ${model} {`)
    expect(postgres).toContain(`model ${model} {`)
  })

  it('keeps FileAsset as managed content and relates Asset evidence by reference', () => {
    const sqlite = read('prisma/schema.prisma')
    const fileAssetBody = sqlite.match(/model FileAsset \{[\s\S]*?\n\}/)?.[0] || ''
    expect(fileAssetBody).toContain('storageKind')
    expect(fileAssetBody).toContain('relativePath')
    expect(fileAssetBody).not.toContain('assetCode')
    expect(sqlite.match(/model AssetEvidence \{[\s\S]*?\n\}/)?.[0]).toContain('fileAssetId')
  })

  it('includes every new table in the explicit snapshot allow-list', () => {
    const backup = read('src/modules/project-manager/application/backup-service.js')
    for (const delegate of DELEGATE_NAMES) expect(backup).toMatch(new RegExp(`['\"]${delegate}['\"]`))
  })

  it('ships an additive migration without destructive table operations', () => {
    const migrationRoot = path.resolve(process.cwd(), 'prisma/migrations')
    const candidate = fs.readdirSync(migrationRoot)
      .find((name) => name.includes('asset_management_foundation'))
    expect(candidate).toBeTruthy()
    if (!candidate) return
    const sql = fs.readFileSync(path.join(migrationRoot, candidate, 'migration.sql'), 'utf8')
    expect(sql).toContain('CREATE TABLE "RegisteredAsset"')
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })
})
