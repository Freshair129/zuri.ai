// @req FR-197 — operator access is auditable, not only holdable. `bootstrapOperator`'s
//   own prior comment promised a standing-operator issuance path and it did
//   not exist; a second, equally real gap sat beside it: nothing recorded that
//   operator power was ever actually USED. Reading `/api/audit` and previewing
//   or restoring a backup are support-class reads over every Tenant in the
//   installation, and ADR-017 D6 says support-class access must be auditable
//   — read here as covering operator READS, not only writes, which is a
//   deliberate extension of D6 rather than an obvious consequence of it
//   (argued in ADR-079).
// @spec ADR-017 D6, FR-075, SEC-008, ADR-079
// @tested tests/integration/fr197-operator-grant-lifecycle.test.js
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { isInstallationOperator } from './viewer-authority'

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Gate one operator-only action AND record that it happened, in that order —
 * a denied attempt writes nothing, so the audit stream never grows from a
 * refusal. `action` names what was used (e.g. `AUDIT_READ`, `BACKUP_EXPORT`,
 * `BACKUP_PREVIEW`, `BACKUP_RESTORE`); every such use is one `OPERATOR_ACTION`
 * event on the acting Person, whatever it was that they read or restored.
 */
export async function assertOperatorAndRecordUse(
  viewer,
  { action, deniedMessage = 'Operator authority is required', entityId = null, payload = {}, db = prisma } = {},
) {
  if (!isInstallationOperator(viewer)) throw failure(403, deniedMessage)

  const actorId = viewer?.principal?.id ?? null
  await recordAudit(db, {
    entityType: 'PERSON',
    entityId: entityId ?? actorId,
    action: 'OPERATOR_ACTION',
    actorId,
    payload: { action, ...payload },
  })
}
