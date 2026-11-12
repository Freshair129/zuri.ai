// @req FR-245, SEC-034 — scheduled archive expiry processes each Tenant with
//   archive evidence and records one counts-only run audit (ADR-093 D5, P7).
// @spec ADR-093 D5 (1.3.0), SDD-103, SEC-001
// @tested tests/unit/crm-chat-evidence-archive-expiry-run.test.js

import { recordAudit } from '@/modules/project-manager/application/audit'
import { assertArchiveStorageReady, resolveArchiveBaseDir } from './chat-evidence-archive-service'
import { expireChatEvidenceArchive } from './chat-evidence-archive-expiry-service'

function safeFailureCode(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ARCHIVE_')
    ? error.code
    : 'ARCHIVE_EXPIRY_TENANT_FAILED'
}

function resultCounts(result) {
  return {
    keysDestroyed: result.destroyedKeys?.length ?? 0,
    holdKeysDestroyed: result.destroyedHoldKeys?.length ?? 0,
    manifestsRetired: result.retiredManifestIds?.length ?? 0,
    filesDeleted: result.deletedFiles?.length ?? 0,
    retiredFilesStillPresent: result.retiredFilesStillPresent?.length ?? 0,
  }
}

/** Run the archive expiry once across Tenants with any archive or archive-key rows. */
export async function runChatEvidenceArchiveExpiry(db, {
  now = new Date(), baseDir, env = process.env,
} = {}) {
  const selectedBaseDir = baseDir ?? resolveArchiveBaseDir(env)
  if (env.NODE_ENV === 'production') await assertArchiveStorageReady(selectedBaseDir, env)

  const [manifestTenants, customerKeyTenants, holdKeyTenants] = await Promise.all([
    db.archiveManifest.findMany({ select: { tenantId: true } }),
    db.customerArchiveKey.findMany({ select: { tenantId: true } }),
    db.legalHoldArchiveKey.findMany({ select: { tenantId: true } }),
  ])
  const tenantIds = [...new Set([...manifestTenants, ...customerKeyTenants, ...holdKeyTenants]
    .map((row) => row.tenantId).filter((tenantId) => typeof tenantId === 'string' && tenantId.length > 0))]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))

  const counts = {
    tenantsVisited: 0,
    keysDestroyed: 0,
    holdKeysDestroyed: 0,
    manifestsRetired: 0,
    filesDeleted: 0,
    retiredFilesStillPresent: 0,
    skipped: 0,
    failures: 0,
  }
  const tenants = []
  for (const tenantId of tenantIds) {
    counts.tenantsVisited += 1
    try {
      const result = await expireChatEvidenceArchive(db, { tenantId, now, baseDir: selectedBaseDir, env })
      const perTenant = resultCounts(result)
      const retirementFailureCode = result.retirementFailureReason
        ? safeFailureCode({ code: result.retirementFailureReason })
        : null
      counts.keysDestroyed += perTenant.keysDestroyed
      counts.holdKeysDestroyed += perTenant.holdKeysDestroyed
      counts.manifestsRetired += perTenant.manifestsRetired
      counts.filesDeleted += perTenant.filesDeleted
      counts.retiredFilesStillPresent += perTenant.retiredFilesStillPresent
      const skippedReason = result.skipped ? result.chainIntegrity?.reason ?? 'ARCHIVE_CHAIN_INVALID' : null
      if (result.skipped) counts.skipped += 1
      if (retirementFailureCode) counts.failures += 1
      tenants.push({ tenantId, ...perTenant, skippedReason, failureCode: retirementFailureCode })
    } catch (error) {
      counts.failures += 1
      tenants.push({
        tenantId,
        keysDestroyed: 0,
        holdKeysDestroyed: 0,
        manifestsRetired: 0,
        filesDeleted: 0,
        retiredFilesStillPresent: 0,
        skippedReason: null,
        failureCode: safeFailureCode(error),
      })
    }
  }

  const audit = await recordAudit(db, {
    entityType: 'ARCHIVE_EXPIRY_RUN',
    entityId: `archive-expiry:${now.toISOString()}`,
    action: 'ARCHIVE_EXPIRY_RUN_COMPLETED',
    actorType: 'SYSTEM',
    payload: { ranAt: now.toISOString(), counts, tenants },
  })
  return { auditEventId: audit.id, counts }
}
