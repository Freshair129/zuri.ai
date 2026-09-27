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
// WHY THE WHOLE-TENANT CHAIN IS CHECKED FIRST, BEFORE ANY PARTIAL RECOVERY
// ---------------------------------------------------------------------------
// Self-consistency (above) only proves a row's own stored fields reproduce
// its own stored hash — it says nothing about whether that row's claimed
// `previousManifestHash` actually IS the prior manifest's real hash. A row
// deleted from the middle of the chain, or a row whose fields and hash were
// both rewritten together, is invisible to a per-row check by construction:
// recomputing a hash from fields that were changed together with it always
// succeeds. The chain's actual guarantee — ADR-093 D4's "an unbroken manifest
// chain" as part of what a dispute needs — depends on each row's stored
// `previousManifestHash` matching the row that came before it, checked across
// the WHOLE sequence, which is exactly what `verifyManifestChain` (built with
// the writer, `chat-evidence-archive-service.js`) does and this module did
// not call before this fix. So before any per-manifest partial recovery
// begins, this checks the Tenant's whole chain (with `checkFiles: true`, so
// the files themselves back the chain, not only the rows) and refuses to
// recover ANYTHING for this retrieval if it is broken — a customer dispute is
// exactly the situation where a partial read someone could have silently
// tampered with is worse than an honest, fully-refused recovery. This is a
// point-in-time check: it says "this Tenant's chain looks intact right now,
// including these files," not "no manifest was ever altered and re-chained
// consistently" — a sufficiently resourced attacker with database and
// filesystem access could in principle rebuild a self-consistent chain after
// tampering. That is a stronger threat model than this task closes; this fix
// closes the specific, realistic gap of "a row silently vanishes or is
// changed and nothing downstream ever notices."
//
// WHY "GROUPED BY SESSION" NEEDS NO EXTRA LOOKUP
// -------------------------------------------------
// `chat-evidence-archive-service.js`'s `buildArchiveLine` already writes
// `sessionId` into every archived line, so grouping reads it straight off the
// decrypted content — no join back to the live `Message` row is needed for
// this. The live row is still what tells this service WHICH message ids are
// archived-and-in-range in the first place (a tombstoned `body` is the one
// signal that a message left the live table for the archive).
//
// @req FR-022 — A GROUP THREAD HOLDS MORE THAN ONE CUSTOMER'S KEY
// ----------------------------------------------------------------
// From archive format v2 a line in a LINE group or room thread is sealed under
// its speaker's Customer key, not the thread owner's (chat-evidence-archive-service.js).
// So a Customer's archived messages are the lines of their own threads AND the
// lines they wrote (and the replies to them) in threads another Customer owns,
// and recovering them opens every segment sealed for one of those messages'
// key Customers — the retrieved Customer's key as before, plus any other
// member's key that still exists. Another member's key is only ever opened,
// never minted: a missing key means that member's lines were destroyed (erasure
// or expiry), and they are reported in `missingMessageIds` like any other
// unrecoverable line. A v1 file's lines all sit in the thread owner's segment,
// which is opened too, so both formats read through the same path.
// @tested tests/integration/crm-archive-group-speakers.test.js
//
// @req FR-022, SEC-034 — EVIDENCE KEPT FOR THIS CUSTOMER (ADR-093 1.2.0)
// -----------------------------------------------------------------------
// Two kinds of line are readable for this Customer without being "theirs" by
// thread or by speaker, because they were kept on the strength of this
// Customer's retention consent:
//   - lines re-sealed under one of this Customer's legal holds when another
//     member of a shared thread was erased (a `LEGAL_HOLD` segment). The hold's
//     key is opened only while the hold is active AND this Customer's retention
//     consent is active — checked here, at read time;
//   - staff/push/unknown-author lines of an erased Customer's thread that the
//     retention sweep archived under THIS Customer's key because they consented.
// Both are returned when their `createdAt` falls in the requested range.
// @tested tests/integration/crm-retention-consent.test.js

import { z } from 'zod'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { assertCredentialWriteAssurance } from '@/modules/identity/credential-write-gate'
import {
  assertArchiveStorageReady, openExistingCustomerArchiveKeyDek, openExistingLegalHoldArchiveKeyDek, computeManifestHash,
  resolveArchiveBaseDir, resolveArchiveKeyCustomers, verifyManifestChain,
} from './chat-evidence-archive-service'
import { openArchiveSegment, openHoldArchiveSegment, ChatEvidenceArchiveCryptoError } from './chat-evidence-archive-crypto'
import { findActiveRetentionConsent } from './retention-consent-reader'
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

/**
 * @req FR-022 — the archived (retention-swept) messages that are this Customer's
 * in the date range: every line of the threads they own, plus the lines they
 * wrote in any other thread of the Tenant (by `Message.authorChannelIdentityId`)
 * and the stack replies to those lines (`reply:<inboundId>`). Rows carry what
 * `resolveArchiveKeyCustomers` needs to name the key each line was sealed under.
 */
async function findArchivedMessagesForCustomer(db, { customer, start, end }) {
  const select = {
    id: true, body: true, direction: true, externalMessageId: true, authorChannelIdentityId: true,
    conversation: { select: { id: true, customerId: true } },
  }
  const range = { gte: start, lte: end }
  const owned = await db.message.findMany({ where: { conversation: { customerId: customer.id }, createdAt: range }, select })
  const person = await db.customer.findUnique({ where: { id: customer.id }, select: { personId: true } })
  const identities = person?.personId
    ? await db.channelIdentity.findMany({ where: { tenantId: customer.tenantId, personId: person.personId }, select: { id: true } })
    : []
  const authored = identities.length
    ? await db.message.findMany({
      where: {
        direction: 'INBOUND', authorChannelIdentityId: { in: identities.map((row) => row.id) },
        conversation: { tenantId: customer.tenantId, customerId: { not: customer.id } }, createdAt: range,
      },
      select,
    })
    : []
  const replies = authored.length
    ? await db.message.findMany({
      where: {
        direction: 'OUTBOUND', conversationId: { in: [...new Set(authored.map((m) => m.conversation.id))] },
        externalMessageId: { in: authored.map((m) => `reply:${m.id}`) }, createdAt: range,
      },
      select,
    })
    : []
  const byId = new Map([...owned, ...authored, ...replies].map((m) => [m.id, m]))
  return [...byId.values()].filter((m) => m.body === RETENTION_SWEEP_TOMBSTONE)
}

/**
 * @req FR-022 — the legal holds whose re-sealed evidence this Customer may read
 * now: their unexpired holds that still have a re-seal key, and only while their
 * retention consent is active (ADR-093 1.2.0).
 */
async function readableHoldIds(db, { customer, now }) {
  const consent = await findActiveRetentionConsent(db, { tenantId: customer.tenantId, customerId: customer.id })
  if (!consent) return []
  const holds = await db.customerLegalHold.findMany({
    where: { tenantId: customer.tenantId, customerId: customer.id, endDate: { gt: now } },
    select: { id: true },
  })
  if (holds.length === 0) return []
  const keys = await db.legalHoldArchiveKey.findMany({
    where: { tenantId: customer.tenantId, heldCustomerId: customer.id, legalHoldId: { in: holds.map((h) => h.id) } },
    select: { legalHoldId: true },
  })
  return keys.map((k) => k.legalHoldId)
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
  baseDir, env = process.env, now = new Date(),
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

  const resolvedBaseDir = baseDir ?? resolveArchiveBaseDir(env)
  await assertArchiveStorageReady(resolvedBaseDir, env)

  const { start, end } = utcDayRange(data.startDate, data.endDate)
  const archivedRows = await findArchivedMessagesForCustomer(db, { customer, start, end })
  const wanted = new Set(archivedRows.map((m) => m.id))
  // @req FR-022 — evidence kept on this Customer's consent (see the module header).
  const holdIds = await readableHoldIds(db, { customer, now })
  const ownKey = await db.customerArchiveKey.findUnique({ where: { customerId: customer.id }, select: { tenantId: true } })
  const keptForCustomer = holdIds.length > 0 || ownKey?.tenantId === customer.tenantId
  const inRange = (line) => {
    const at = new Date(line.createdAt)
    return at >= start && at <= end
  }

  let sessions = []
  let manifestsUsed = []
  let missingMessageIds = []
  let messageCount = 0
  // { valid: true } when nothing was ever archived for this Tenant (no chain
  // to check) or the range needs no archive read at all — never reported as
  // broken by default; only a real, checked failure sets `valid: false`.
  let chainIntegrity = { valid: true }

  if (wanted.size > 0 || keptForCustomer) {
    // The whole-Tenant chain must check out, files included, before ANY
    // per-manifest partial recovery is attempted — see the module docstring.
    // A broken chain refuses the whole retrieval: every wanted id stays in
    // `missingMessageIds`, no key is opened, no file this call would
    // otherwise have read is read.
    chainIntegrity = await verifyManifestChain(db, customer.tenantId, { baseDir: resolvedBaseDir, checkFiles: true })
  }

  if ((wanted.size > 0 || keptForCustomer) && chainIntegrity.valid) {
    const deks = new Map()
    const holdDeks = new Map()
    try {
      for (const legalHoldId of holdIds) {
        const dek = await openExistingLegalHoldArchiveKeyDek(db, { tenantId: customer.tenantId, legalHoldId }, env)
        if (dek) holdDeks.set(legalHoldId, dek)
      }
      // Every Customer whose segment may hold one of these lines: the retrieved
      // Customer, the key each line was sealed under (v2) and the thread owner's
      // (v1). Every key — the retrieved Customer's included — is only opened,
      // never minted: reading is not a reason to create a key, and an erased
      // Customer's destroyed key must stay destroyed (FR-022, SEC-034).
      const keyCustomers = await resolveArchiveKeyCustomers(db, { tenantId: customer.tenantId, messages: archivedRows })
      const holders = new Set([customer.id, ...keyCustomers.values(), ...archivedRows.map((m) => m.conversation.customerId)])
      for (const holder of holders) {
        let dek = null
        try {
          dek = await openExistingCustomerArchiveKeyDek(db, { tenantId: customer.tenantId, customerId: holder }, env)
        } catch (err) {
          // The retrieved Customer's own key failing to open is a hard error, as it
          // always was; another member's is reported through missingMessageIds.
          if (holder === customer.id || !(err instanceof ChatEvidenceArchiveCryptoError)) throw err
        }
        if (dek) deks.set(holder, dek)
      }

      const found = new Map()
      const manifests = await db.archiveManifest.findMany({ where: { tenantId: customer.tenantId }, orderBy: { createdAt: 'asc' } })
      for (const manifest of manifests) {
        if (!keptForCustomer && found.size === wanted.size) break // every wanted message already recovered
        if (!manifestSelfConsistent(manifest)) continue // the row itself doesn't reproduce its own hash — never trust its file claim

        let raw
        try {
          raw = await readFile(path.join(resolvedBaseDir, manifest.filePath))
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
        let matchedAny = false
        for (const segmentLine of lines.slice(1)) {
          let segment
          try {
            segment = JSON.parse(segmentLine)
          } catch {
            continue
          }
          const held = segment?.keyScope === 'LEGAL_HOLD'
          const dek = held ? holdDeks.get(segment.legalHoldId) : deks.get(segment?.customerId)
          if (!dek) continue // not a key this retrieval needs, or one that no longer exists
          // Lines taken whole from this segment when in range, not only the wanted ids:
          // a hold segment of this Customer's, or this Customer's own-key segment.
          const takeInRange = held || segment.customerId === customer.id

          let plaintext
          try {
            const gzipped = held
              ? openHoldArchiveSegment(segment, { dek, tenantId: customer.tenantId, legalHoldId: segment.legalHoldId, runId: header.runId })
              : openArchiveSegment(segment, { dek, tenantId: customer.tenantId, customerId: segment.customerId, runId: header.runId })
            const { gunzipSync } = await import('node:zlib')
            plaintext = gunzipSync(gzipped).toString('utf8')
          } catch (err) {
            if (err instanceof ChatEvidenceArchiveCryptoError) continue // wrong key epoch or tampered segment — unrecoverable here
            throw err
          }

          for (const line of plaintext.trim().split('\n')) {
            if (!line) continue
            const archivedLine = JSON.parse(line)
            const want = wanted.has(archivedLine.messageId) || (takeInRange && inRange(archivedLine))
            if (want && !found.has(archivedLine.messageId)) {
              found.set(archivedLine.messageId, archivedLine)
              matchedAny = true
            }
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
      for (const dek of deks.values()) dek.fill(0)
      for (const dek of holdDeks.values()) dek.fill(0)
    }
  } else if (wanted.size > 0) {
    // Chain broken: every wanted id stays unrecovered, honestly, rather than
    // trusting any individual manifest the per-row self-check alone would
    // have accepted.
    missingMessageIds = [...wanted]
  }

  // ADR-093 D7 — "Every retrieval writes an ARCHIVE_RETRIEVED audit event
  // naming the Customer, the range and the case reference": unconditional,
  // even when nothing was recoverable (including a broken chain), because the
  // attempt itself is what a dispute or a later access review needs to see,
  // not only its result — and a broken chain is exactly the kind of fact an
  // access review must not miss.
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
      chainIntegrity: chainIntegrity.valid
        ? { valid: true }
        : { valid: false, reason: chainIntegrity.reason, brokenAtManifestId: chainIntegrity.brokenAtManifestId },
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
    chainIntegrity,
    auditEventId: audit.id,
  }
}
