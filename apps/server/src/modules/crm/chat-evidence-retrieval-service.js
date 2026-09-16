// @req FR-245 — an OWNER at AAL2 retrieves one Customer's archived messages for
//   a date range, grouped by session, with a mandatory case reference, as an
//   export carrying the file and manifest hashes it was recovered from
//   (ADR-093 D7, TASK-ZAI-112).
// @spec ADR-093 D4, D7; SEC-034; SDD-103; BR-001
// @tested tests/integration/crm-chat-evidence-retrieval.test.js
//
// WHY THIS NEVER TRUSTS A MANIFEST OR A FILE WITHOUT RE-VERIFYING BOTH
// -----------------------------------------------------------------------
// `chat-evidence-archive-service.js`'s writer already verified the file once,
// at write time. That proof does not carry forward — a disk can bit-rot, a
// row can be edited directly, a copy (ADR-093 D8) can be partial. So every
// manifest this reads is first self-checked (`computeManifestHash` recomputed
// from its own stored fields must equal `manifest.manifestHash`), and every
// file is re-hashed against `manifest.fileSha256` before any line in it is
// trusted. A manifest or file that fails either check — or is simply missing
// — is treated as "not found here": the message ids it would have held stay
// in `missingMessageIds` rather than either failing the whole retrieval or
// returning unverified content. A partial, honestly-labelled recovery is more
// useful as dispute evidence than an all-or-nothing read would be.
//
// WHY "GROUPED BY SESSION" NEEDS NO EXTRA LOOKUP
// -------------------------------------------------
// `chat-evidence-archive-service.js`'s `buildArchiveLine` already writes
// `sessionId` into every archived line, so grouping reads it straight off the
// decrypted content — no join back to the live `Message` row is needed for
// this. The live row is still what tells this service WHICH message ids are
// archived-and-in-range in the first place (a tombstoned `body` is the one
// signal that a message left the live table for the archive).

import { z } from 'zod'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { assertCredentialWriteAssurance } from '@/modules/identity/credential-write-gate'
import { getOrCreateCustomerArchiveKeyDek, computeManifestHash, resolveArchiveBaseDir } from './chat-evidence-archive-service'
import { openArchiveSegment, ChatEvidenceArchiveCryptoError } from './chat-evidence-archive-crypto'
import { RETENTION_SWEEP_TOMBSTONE } from './retention-sweep-tombstone'

export const zRetrieveChatEvidence = z.object({
  businessId: z.string().min(1),
  startDate: z.string().date(),
  endDate: z.string().date(),
  // @req ADR-093 D7 — "must give a case reference". Free text on purpose: this
  //   is whatever the Business's own dispute file calls the matter, not an id
  //   this system mints or validates against another registry.
  caseReference: z.string().trim().min(1).max(500),
}).strict().refine((data) => data.startDate <= data.endDate, {
  message: 'startDate must not be after endDate',
  path: ['startDate'],
})

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function utcDayRange(startDate, endDate) {
  return { start: new Date(`${startDate}T00:00:00.000Z`), end: new Date(`${endDate}T23:59:59.999Z`) }
}

/** A manifest is trusted only once its own stored fields reproduce its own hash. */
function manifestSelfConsistent(manifest) {
  return computeManifestHash(manifest) === manifest.manifestHash
}

/**
 * Retrieve one Customer's archived (retention-swept) chat messages for a date
 * range, grouped by session, on the authority of a Business owner in the
 * Customer's tenant (BR-001) stepped up to AAL2 through the FR-224 gate.
 *
 * Scope is exactly the archived subset: a message this Customer's Conversation
 * still shows live is not archived and is not returned here — this is a
 * recovery path for content the retention sweep already erased, not a second
 * way to read the Inbox.
 *
 * @param {string} customerId
 * @param {{businessId: string, startDate: string, endDate: string, caseReference: string}} input
 * @param {{viewer: object, request?: Request|null, session?: object, db?: object, baseDir?: string, env?: object}} ctx
 */
export async function retrieveArchivedChatEvidence(customerId, input, {
  viewer, request = null, session = undefined, db = prisma,
  baseDir = resolveArchiveBaseDir(), env = process.env,
} = {}) {
  if (!customerId) throw failure(400, 'CUSTOMER_ID_REQUIRED')
  const data = zRetrieveChatEvidence.parse(input)

  // ADR-093 D7 — "An OWNER at AAL2, through the FR-224 step-up gate": the same
  // gate credential rotation uses, not a parallel one (repository-wide rule
  // against a second copy of an authorization predicate).
  await assertCredentialWriteAssurance({ viewer, request, session, db })

  // Same order and shape as customer-consent-service.js / erase-customer-principal.js:
  // domain visibility before ownership, so a principal never granted CRM in this
  // Business learns nothing about whether it exists from the ownership refusal.
  assertDomainVisible(viewer, data.businessId, 'customer')
  if (!ownsBusiness(viewer, data.businessId)) {
    throw failure(403, 'Retrieving chat evidence requires owner authority over this Business')
  }

  const business = await db.business.findUnique({ where: { id: data.businessId }, select: { id: true, tenantId: true } })
  if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')

  // BR-001 — the CRM is tenant-shared, so any Customer in this Business's
  // tenant is reachable; never widened to another tenant by anything the
  // caller supplies, because the lookup itself is bounded by it.
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId: business.tenantId },
    select: { id: true, tenantId: true },
  })
  if (!customer) throw failure(404, 'CUSTOMER_NOT_FOUND')

  const { start, end } = utcDayRange(data.startDate, data.endDate)
  const rangeMessages = await db.message.findMany({
    where: { conversation: { customerId: customer.id }, createdAt: { gte: start, lte: end } },
    select: { id: true, body: true },
  })
  const wanted = new Set(rangeMessages.filter((m) => m.body === RETENTION_SWEEP_TOMBSTONE).map((m) => m.id))

  let sessions = []
  let manifestsUsed = []
  let missingMessageIds = []
  let messageCount = 0

  if (wanted.size > 0) {
    const dek = await getOrCreateCustomerArchiveKeyDek(db, { tenantId: customer.tenantId, customerId: customer.id }, env)
    try {
      const found = new Map()
      const manifests = await db.archiveManifest.findMany({ where: { tenantId: customer.tenantId }, orderBy: { createdAt: 'asc' } })
      for (const manifest of manifests) {
        if (found.size === wanted.size) break // every wanted message already recovered
        if (!manifestSelfConsistent(manifest)) continue // the row itself doesn't reproduce its own hash — never trust its file claim

        let raw
        try {
          raw = await readFile(path.join(baseDir, manifest.filePath))
        } catch {
          continue // file offline or not mounted here (ADR-093 D8's second copy) — reported via missingMessageIds, not a hard failure
        }
        if (createHash('sha256').update(raw).digest('hex') !== manifest.fileSha256) continue // never trust an unverified file

        const lines = raw.toString('utf8').trim().split('\n')
        let header
        try {
          header = JSON.parse(lines[0])
        } catch {
          continue
        }
        const segmentLine = lines.slice(1).find((line) => {
          try {
            return JSON.parse(line).customerId === customer.id
          } catch {
            return false
          }
        })
        if (!segmentLine) continue // this file has no segment for this Customer

        let plaintext
        try {
          const segment = JSON.parse(segmentLine)
          const gzipped = openArchiveSegment(segment, { dek, tenantId: customer.tenantId, customerId: customer.id, runId: header.runId })
          const { gunzipSync } = await import('node:zlib')
          plaintext = gunzipSync(gzipped).toString('utf8')
        } catch (err) {
          if (err instanceof ChatEvidenceArchiveCryptoError) continue // wrong key epoch or tampered segment — unrecoverable here
          throw err
        }

        let matchedAny = false
        for (const line of plaintext.trim().split('\n')) {
          if (!line) continue
          const archivedLine = JSON.parse(line)
          if (wanted.has(archivedLine.messageId) && !found.has(archivedLine.messageId)) {
            found.set(archivedLine.messageId, archivedLine)
            matchedAny = true
          }
        }
        if (matchedAny) manifestsUsed.push({ manifestId: manifest.id, runId: manifest.runId, filePath: manifest.filePath, fileSha256: manifest.fileSha256, manifestHash: manifest.manifestHash })
      }

      const grouped = new Map()
      for (const archivedLine of found.values()) {
        const sessionKey = archivedLine.sessionId ?? null
        const list = grouped.get(sessionKey) ?? []
        list.push(archivedLine)
        grouped.set(sessionKey, list)
      }
      sessions = [...grouped.entries()]
        .map(([sessionId, messages]) => ({ sessionId, messages: messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }))
        .sort((a, b) => (a.messages[0]?.createdAt ?? '').localeCompare(b.messages[0]?.createdAt ?? ''))
      missingMessageIds = [...wanted].filter((id) => !found.has(id))
      messageCount = found.size
    } finally {
      dek.fill(0)
    }
  }

  // ADR-093 D7 — "Every retrieval writes an ARCHIVE_RETRIEVED audit event
  // naming the Customer, the range and the case reference": unconditional,
  // even when nothing was recoverable, because the attempt itself is what a
  // dispute or a later access review needs to see, not only its result.
  const audit = await recordAudit(db, {
    entityType: 'ARCHIVE',
    entityId: customer.id,
    action: 'ARCHIVE_RETRIEVED',
    actorId: viewer?.principal?.id ?? null,
    tenantId: customer.tenantId,
    businessId: data.businessId,
    reason: data.caseReference,
    payload: {
      customerId: customer.id, startDate: data.startDate, endDate: data.endDate,
      caseReference: data.caseReference, messageCount, missingMessageIds,
      manifests: manifestsUsed.map((m) => m.manifestHash),
    },
  })

  return {
    customerId: customer.id,
    tenantId: customer.tenantId,
    range: { startDate: data.startDate, endDate: data.endDate },
    caseReference: data.caseReference,
    sessions,
    manifests: manifestsUsed,
    missingMessageIds,
    auditEventId: audit.id,
  }
}
