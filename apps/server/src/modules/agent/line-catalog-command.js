import prisma from '@/lib/db'
import { channelIdentityIsVerified, findChannelIdentity } from '@/modules/identity/channel-identity'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import {
  CATALOG_INTAKE_SCHEMA_VERSION,
  LINE_CATALOG_HELP,
  applyCatalogIntakeAction,
  commitCatalogIntake,
  findCatalogIntakeByCode,
  formatLineCatalogError,
  formatLineCatalogPreview,
  formatLineCatalogResult,
  formatLineCatalogUnknownKeys,
  mayManage,
  parseLineCatalogCommand,
  previewCatalogIntake,
} from '@/modules/inventory'

// @req FR-210 — the `#sku` catalogue command on the server-owned LINE worker
//   (ADR-084 D4). It wraps the worker's answer port: a DIRECT-chat text that
//   starts with `#sku` is answered here, before the model; every other message
//   goes to the wrapped answer exactly as before. The command acts only for a
//   sender whose LINE channel identity is verified (FR-097) and whose resolved
//   viewer has Inventory write authority in the account's Business (BR-042).
//   For anyone else — unverified, a customer, a group chat — the message falls
//   through to the normal answer, so the command's existence is no oracle.
//   A thin adapter (SDD-091): Tenant and Business come only from the claimed
//   job, the person only from the verified channel identity, and every effect
//   is an Inventory service call with that viewer — no scope from the message,
//   no Prisma write, no model output on the write path.
// @spec ADR-084 D4; ADR-061; BR-042; SDD-091; SEC-001; FR-097
// @tested tests/unit/agent-line-catalog-command.test.js, tests/integration/fr210-line-catalog-command.test.js

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * The trusted viewer a `#sku` message may act as, or null. Every "no" is the
 * same null: the caller then answers the message as an ordinary question.
 */
export async function lineCatalogViewer(job, { db = prisma, identity = { findChannelIdentity, channelIdentityIsVerified }, viewerResolver = resolveViewer } = {}) {
  if (job?.audienceKind !== 'DIRECT') return null
  if (![job?.tenantId, job?.businessId, job?.sourceUserId, job?.channelAccountId].every(nonEmpty)) return null
  if (job.account && (job.account.tenantId !== job.tenantId || job.account.businessId !== job.businessId)) return null
  try {
    const row = await identity.findChannelIdentity({ db, tenantId: job.tenantId, channelAccountId: job.channelAccountId, providerSubject: job.sourceUserId })
    if (!identity.channelIdentityIsVerified(row)) return null
    const viewer = await viewerResolver({ principalId: row.personId, db })
    return mayManage(viewer, job.businessId) ? viewer : null
  } catch {
    return null
  }
}

/** Wrap an answer port so `#sku` commands from authorized senders are handled before the model. */
export function withLineCatalogCommand(answer, {
  db = prisma,
  now = () => new Date(),
  authorize = (job) => lineCatalogViewer(job, { db }),
  inventory = { previewCatalogIntake, commitCatalogIntake, findCatalogIntakeByCode, applyCatalogIntakeAction },
} = {}) {
  return async function answerWithCatalogCommand(job, options) {
    const command = parseLineCatalogCommand(job?.inbound?.body)
    if (!command) return answer(job, options)
    const viewer = await authorize(job)
    if (!viewer) return answer(job, options)
    const requestedById = viewer.principal?.id ?? null
    const at = now()
    try {
      if (command.kind === 'HELP') return { text: LINE_CATALOG_HELP }
      if (command.kind === 'PREVIEW') {
        if (command.unknownKeys.length) return { text: formatLineCatalogUnknownKeys(command.unknownKeys) }
        if (!command.items.length) return { text: LINE_CATALOG_HELP }
        const { intake } = await inventory.previewCatalogIntake({
          schemaVersion: CATALOG_INTAKE_SCHEMA_VERSION,
          businessId: job.businessId,
          source: { channel: 'LINE_OA', correlationId: `line:${job.channelAccountId}:${job.eventId}` },
          items: command.items,
        }, { viewer, db, now: at, requestedById })
        return { text: formatLineCatalogPreview(intake) }
      }
      const intake = await inventory.findCatalogIntakeByCode({ businessId: job.businessId, code: command.code }, { viewer, db })
      if (intake.requestedById !== requestedById) return { text: formatLineCatalogError({ status: 404 }) }
      if (command.kind === 'CONFIRM') {
        const { intake: committed } = await inventory.commitCatalogIntake({ businessId: job.businessId, intakeId: intake.id, planHash: intake.planHash }, { viewer, db, now: at, requestedById })
        return { text: formatLineCatalogResult(committed) }
      }
      await inventory.applyCatalogIntakeAction(intake.id, { action: 'CANCEL', version: intake.version }, { viewer, db, now: at, businessId: job.businessId, requestedById })
      return { text: `ยกเลิก ${intake.code} แล้ว — ไม่มีอะไรถูกบันทึก` }
    } catch (error) {
      return { text: formatLineCatalogError(error) }
    }
  }
}
