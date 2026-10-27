// @req FR-045, FR-223 — harness-only object metadata and credential re-entry boundaries.
// @spec ADR-115, SEC-030 — exact synthetic data, not a supported operator recovery path.
import { it, expect, vi } from 'vitest'
vi.mock('@/lib/db', () => ({ default: {} }))

it('refuses an omitted artifact before creating a recovery target or backup', async () => {
  const api = await import('../helpers/compact-recovery-target.mjs'), previous = process.env.COMPACT_PACKAGE_DIRECTORY
  delete process.env.COMPACT_PACKAGE_DIRECTORY
  try { await expect(api.startCompactRecoveryTarget()).rejects.toMatchObject({ code: 'COMPACT_RECOVERY_EXPLICIT_INPUT_REQUIRED' }) }
  finally { if (previous !== undefined) process.env.COMPACT_PACKAGE_DIRECTORY = previous }
})

it('recovers owned synthetic portable data and exact bytes while excluding secret material and refusing unsafe retries', async () => {
  const api = await import('../helpers/compact-recovery-target.mjs')
  expect(typeof api?.startCompactRecoveryTarget, 'owned recovery helper missing').toBe('function')
  const f = await api.startCompactRecoveryTarget()
  const completed = new Set()
  try {
    expect(f.sourceCandidate.status).toBe('ARTIFACT_INSPECTED_NOT_QUALIFIED')
    expect(f.targetCandidate.manifestSha256).toBe(f.sourceCandidate.manifestSha256)
    expect(f.targetCandidate.packageInventorySha256).toBe(f.sourceCandidate.packageInventorySha256)
    expect(f.sourceIdentity.systemIdentifier).not.toBe(f.targetIdentity.systemIdentifier)
    await f.seedSynthetic()
    await f.proveSourceSecretRestartAndMissingKeyRefusal(); completed.add('sourceSecretRestart')
    const backup = await f.backup()
    expect(backup.envelopeRowsExcluded).toBe(1); expect(backup.tableCount).toBe(210)
    await f.proveCorruptAndForeignBackupRefusal(backup); completed.add('foreignAndCorruptRefused')
    await f.closeSource()
    await f.restore(backup); completed.add('databaseRowsAndCatalog')
    expect(await f.targetEnvelopeCount()).toBe(0)
    expect(await f.targetCredentialStatus()).toBe('REENTRY_REQUIRED'); completed.add('credentialReentry')
    await f.proveMetadataOnlyObjectLoss(); completed.add('metadataOnlyRefused')
    await f.copyExactObjectAndRemapFixture(backup); completed.add('exactObjectAndFixtureRemap')
    await f.proveCurrentFileAuthorization(); completed.add('currentFileAuthorization')
    await expect(f.restore(backup)).rejects.toMatchObject({ code: 'COMPACT_RECOVERY_TARGET_NOT_EMPTY' }); completed.add('retryRefused')
    await f.recordEvidence(completed)
  } finally { await f.close(completed) }
})
