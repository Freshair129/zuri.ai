// @req FR-139 — bounded, hashed Google Sheets row snapshot; no live sync.
// @spec SDD-083, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-intake-adapters-contract.test.js
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { assetRowToEnvelope } from './asset-row-adapter'
import { validateAssetIntake } from '../domain/asset-intake'

const zSnapshot = z.object({
  businessId: z.string().min(1), spreadsheetId: z.string().min(1).max(500),
  revisionId: z.string().min(1).max(500), range: z.string().min(1).max(500),
  rows: z.array(z.record(z.unknown())).max(500),
}).strict()

export function convertAssetSheetSnapshot(input) {
  const parsed = zSnapshot.safeParse(input)
  if (!parsed.success) {
    const message = parsed.error.issues.some((issue) => issue.path[0] === 'rows' && issue.code === 'too_big')
      ? 'Google Sheets snapshot accepts at most 500 rows'
      : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(message)
  }
  const value = parsed.data
  const snapshotJson = JSON.stringify({ spreadsheetId: value.spreadsheetId, revisionId: value.revisionId, range: value.range, rows: value.rows })
  const snapshotSha256 = createHash('sha256').update(snapshotJson).digest('hex')
  const envelopes = value.rows.map((row, index) => assetRowToEnvelope({
    correlationId: row.correlationId || `${value.spreadsheetId}:${value.revisionId}:${index + 1}`,
    ...row,
  }, { businessId: value.businessId, channel: 'GOOGLE_SHEET' }))
  const validations = envelopes.map((envelope) => validateAssetIntake(envelope, { trustedTenantId: 'preview', trustedBusinessId: value.businessId }))
  return { snapshotSha256, envelopes, validations, errors: validations.flatMap((result, index) => result.issues.map((issue) => ({ row: index + 1, ...issue }))) }
}
