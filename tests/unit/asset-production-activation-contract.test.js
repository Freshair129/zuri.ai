import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-133, FR-134, FR-137, FR-138, FR-139, FR-140 — the verified local
// Asset beta has an additive PostgreSQL/Supabase activation lane, private
// evidence storage, an explicit server environment contract and redacted
// production receipts.
// @spec CR-016, ADR-057, SEC-023
// @tested tests/unit/asset-production-activation-contract.test.js

const root = process.cwd()
const foundationPath = resolve(
  root,
  'supabase/migrations/20260902001000_asset_management_foundation.sql',
)
const evidencePath = resolve(
  root,
  'supabase/migrations/20260902103000_asset_evidence_intake_execution.sql',
)

function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function executableStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
}

const assetTables = [
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

describe('CR-016 Asset production migration lane', () => {
  it('ships both reviewed migrations as additive PostgreSQL transactions', () => {
    const migrations = [read(foundationPath), read(evidencePath)]
    for (const sql of migrations) {
      expect(sql, 'missing Asset Supabase migration').not.toBe('')
      expect(sql).toMatch(/\bBEGIN\s*;/i)
      expect(sql).toMatch(/\bCOMMIT\s*;/i)

      const statements = executableStatements(sql)
      expect(statements).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i)
      expect(statements).not.toMatch(/ALTER\s+TABLE[\s\S]*?\bDROP\b/i)
      expect(statements).not.toMatch(/\b(?:DATETIME|REAL|PRAGMA|AUTOINCREMENT)\b/i)
    }
  })

  it('creates every Asset foundation table with PostgreSQL types and server-only RLS', () => {
    const sql = executableStatements(read(foundationPath))
    expect(sql).toContain('TIMESTAMP(3)')
    expect(sql).toContain('DOUBLE PRECISION')

    for (const table of assetTables) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? "${table}"`, 'i'))
      expect(sql).toMatch(new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`, 'i'))
      expect(sql).toMatch(new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`, 'i'))
      expect(sql).toMatch(new RegExp(
        `REVOKE ALL ON TABLE "${table}" FROM public, anon, authenticated, service_role`,
        'i',
      ))
    }

    expect(sql).toMatch(/FROM pg_policies/i)
    expect(sql).toMatch(/TO zuri_app_runtime, zuri_web_login/i)
  })

  it('adds the execution fields/index and provisions a private bounded evidence bucket', () => {
    const sql = executableStatements(read(evidencePath))
    for (const field of [
      'normalizedEnvelopeJson',
      'payloadSha256',
      'validatedAt',
      'validationJson',
    ]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN\\s+"${field}"`, 'i'))
    }
    expect(sql).toContain('"AssetIntake_businessId_payloadSha256_idx"')
    expect(sql).toMatch(/INSERT INTO storage\.buckets/i)
    expect(sql).toMatch(/"?public"?\s*=\s*false/i)
    expect(sql).toMatch(/"?file_size_limit"?\s*=\s*20971520/i)
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(sql).toContain(mime)
    }
  })

  it('never writes the Supabase migration ledger from inside an Asset migration', () => {
    expect(read(foundationPath)).not.toMatch(/schema_migrations/i)
    expect(read(evidencePath)).not.toMatch(/schema_migrations/i)
  })
})

describe('CR-016 production environment and operator contract', () => {
  it('declares every Asset adapter variable without browser-visible secrets', () => {
    const example = read(resolve(root, '.env.example'))
    for (const name of [
      'SUPABASE_URL',
      'SUPABASE_STORAGE_SERVICE_ROLE_KEY',
      'ZURI_ASSET_EVIDENCE_BUCKET',
      'OPENAI_API_KEY',
      'ZURI_ASSET_EVIDENCE_MODEL',
    ]) {
      expect(example).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'))
    }
    expect(example).not.toMatch(/NEXT_PUBLIC_(?:OPENAI|.*SERVICE_ROLE)/)
  })

  it('documents identity, inventory, apply, verify, canary, promote and rollback gates', () => {
    const runbook = read(resolve(root, 'docs/runbooks/ASSET-EVIDENCE-PRODUCTION-ACTIVATION.md'))
    for (const heading of [
      'Target identity',
      'Backup and inventory',
      'Apply migrations',
      'Verify storage',
      'Synthetic canary',
      'Promote',
      'Rollback',
    ]) {
      expect(runbook).toContain(heading)
    }
    expect(runbook).toMatch(/merged `main`/i)
    expect(runbook).toMatch(/never.*secret|secret.*never/i)
  })

  it('accepts only a redacted receipt and rejects secrets or document content', async () => {
    const { validateAssetProductionReceipt } = await import(
      '../../scripts/lib/asset-production-receipt.mjs'
    )
    const receipt = {
      schemaVersion: 'asset-production-activation.v1',
      generatedAt: '2026-09-02T06:00:00.000Z',
      target: {
        repository: 'Freshair129/zuri.ai',
        vercelTeamId: 'team_redacted',
        vercelProjectId: 'prj_redacted',
        supabaseProjectRef: 'project-redacted',
      },
      deployment: {
        commitSha: 'a'.repeat(40),
        deploymentId: 'dpl_redacted',
        rollbackDeploymentId: 'dpl_previous',
      },
      migrations: [
        { version: '20260902001000', status: 'APPLIED' },
        { version: '20260902103000', status: 'APPLIED' },
      ],
      storage: {
        bucket: 'asset-evidence',
        public: false,
        objectRef: 'supabase://asset-evidence/opaque-id',
        objectSha256: 'b'.repeat(64),
      },
      canary: {
        intakeId: 'intake_redacted',
        evidenceId: 'evidence_redacted',
        pipelineRunId: 'run_redacted',
        inputSha256: 'c'.repeat(64),
        extractionState: 'CANDIDATE',
        reviewState: 'REVIEWED',
        validationState: 'READY_FOR_REGISTRATION',
        registeredAssetCreated: false,
        procurementMutationCount: 0,
        financePostingCount: 0,
        elapsedMs: 1234,
      },
      runtime: {
        windowStart: '2026-09-02T06:00:00.000Z',
        windowEnd: '2026-09-02T06:01:00.000Z',
        errorCount: 0,
      },
    }

    expect(validateAssetProductionReceipt(receipt)).toBe(receipt)
    expect(() => validateAssetProductionReceipt({ ...receipt, apiKey: 'sk-secret' })).toThrow()
    expect(() => validateAssetProductionReceipt({ ...receipt, vercelToken: 'hidden' })).toThrow()
    expect(() => validateAssetProductionReceipt({ ...receipt, documentBytes: 'base64-data' })).toThrow()
  })
})
