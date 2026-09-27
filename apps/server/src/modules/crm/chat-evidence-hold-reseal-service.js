import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  ARCHIVE_HOLD_FORMAT_VERSION,
  assertArchiveStorageReady,
  buildArchiveLine,
  buildRunId,
  computeManifestHash,
  findActiveLegalHold,
  findThreadCustomerMembers,
  getOrCreateLegalHoldArchiveKeyDek,
  hashMessageIdList,
  openExistingCustomerArchiveKeyDek,
  resolveArchiveBaseDir,
  resolveReplySources,
  verifyManifestChain,
  withLockedCustomer,
  writeArchiveFile,
} from './chat-evidence-archive-service'
import { ChatEvidenceArchiveCryptoError, openArchiveSegment, resolveArchiveKeyring, sealHoldArchiveSegment } from './chat-evidence-archive-crypto'
import { findActiveRetentionConsent, tenantHasActiveRetentionConsent } from './retention-consent-reader'
import { CUSTOMER_ERASURE_TOMBSTONE } from './conversation-redaction-service'
import { LINE_UNSEND_TOMBSTONE } from './line-unsend-tombstone'
import { RETENTION_SWEEP_TOMBSTONE } from './retention-sweep-tombstone'

// @req FR-022, SEC-034 — erasing a Customer must not shred evidence a held,
//   consenting member of the same thread relies on (owner ruling 2026-09-27,
//   ADR-093 1.2.0, question 1).
// @spec ADR-093 1.2.0 (amending D6), SEC-034, SDD-103
// @tested tests/integration/crm-retention-consent.test.js
//
// THE PROBLEM
// -----------
// Erasing Customer A destroys A's archive key, and with it everything sealed
// under that key: A's own lines anywhere, and the staff, push and unknown-author
// lines of the shared threads A owns. A's not-yet-swept lines are tombstoned in
// the database by the same erasure. When another member B of one of those
// threads is under an active legal hold AND has an active retention consent,
// those lines are B's evidence, and the ruling is that they must survive.
//
// THE DESIGN — RE-SEAL, APPEND, THEN SHRED
// ------------------------------------------
// Inside the erasure transaction, BEFORE A's key is destroyed:
//   1. For every thread A is a member of, find the other members B that are
//      live, under an active legal hold and holding an active retention consent
//      — each checked under B's Customer lock (`withLockedCustomer`), the same
//      lock B's consent revocation takes, so a revocation cannot interleave.
//   2. Collect the lines of those threads that A's erasure would destroy: every
//      line in A's archived segments (read from files whose whole-Tenant chain
//      verifies first), and A's database lines the erasure is about to tombstone
//      (captured by the caller just before it tombstones them).
//   3. Seal them, per hold, under that hold's own `LegalHoldArchiveKey` into ONE
//      new archive file (header v3), and append ONE manifest row to the Tenant's
//      chain. No existing file or manifest row is touched, so the hash chain and
//      every earlier file's SHA-256 stay exactly as they were — tamper evidence
//      is unchanged, and the new file is itself covered by the chain.
// Then the caller destroys A's key as before. The re-sealed copies live exactly
// as long as the hold key: it is destroyed when the hold ends (the archive expiry
// run), when B's retention consent is revoked (same transaction), or when B is
// erased (which revokes B's consent).
//
// Nothing here runs unless the Tenant has at least one active retention consent,
// so an erasure in a Tenant that never recorded one does no extra file I/O.
//
// FILE ON ROLLBACK: the file is written before the manifest row is inserted in
// the caller's transaction. If that transaction rolls back, the caller removes
// the file (`removeUnreferencedArchiveFile`) unless a manifest names its run.

const CONTENT_GONE = new Set([CUSTOMER_ERASURE_TOMBSTONE, LINE_UNSEND_TOMBSTONE, RETENTION_SWEEP_TOMBSTONE])

/** The select a captured database line needs to become an archive line. */
export const HOLD_RESEAL_MESSAGE_SELECT = Object.freeze({
  id: true, conversationId: true, direction: true, body: true, contentKind: true, sessionId: true, createdAt: true,
  externalMessageId: true, authorChannelIdentityId: true,
  conversation: { select: { id: true, customerId: true, businessId: true } },
  attachments: { select: { id: true, kind: true, providerContentId: true, fileAssetId: true, fetchState: true, mimeType: true, sizeBytes: true } },
})

/**
 * Read the database rows the erasure is about to tombstone, while their content
 * still exists — but only in a Tenant that has an active retention consent at all.
 */
export async function captureLinesBeforeErasure(tx, { tenantId, messageIds }) {
  const ids = [...new Set((messageIds ?? []).filter(Boolean))]
  if (ids.length === 0 || !(await tenantHasActiveRetentionConsent(tx, { tenantId }))) return []
  const rows = await tx.message.findMany({ where: { id: { in: ids }, conversation: { tenantId } }, select: HOLD_RESEAL_MESSAGE_SELECT })
  return rows.filter((row) => !CONTENT_GONE.has(row.body))
}

/**
 * The legal holds that must keep evidence from each of these threads: for each
 * live member other than the erased Customers, an active hold plus an active
 * retention consent, each read under that member's lock.
 *
 * @returns {Promise<Map<string, {legalHoldId: string, heldCustomerId: string, conversationIds: Set<string>}>>}
 */
async function findQualifyingHolds(tx, { tenantId, conversationIds, erasedCustomerIds, now }) {
  const erased = new Set(erasedCustomerIds)
  const members = await findThreadCustomerMembers(tx, { tenantId, conversationIds })
  const candidates = [...new Set([...members.values()].flatMap((set) => [...set]))].filter((id) => !erased.has(id)).sort()
  const holdByCustomer = new Map()
  for (const customerId of candidates) {
    const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { deletedAt: true } })
    if (!customer || customer.deletedAt) continue
    const hold = await withLockedCustomer(tx, { tenantId, customerId, now }, async (locked) => {
      const active = await findActiveLegalHold(locked, { customerId }, now)
      if (!active || active.tenantId !== tenantId) return null
      const consent = await findActiveRetentionConsent(locked, { tenantId, customerId })
      return consent ? active : null
    }, { transactionClient: true })
    if (hold) holdByCustomer.set(customerId, hold)
  }
  const holds = new Map()
  for (const [conversationId, set] of members) {
    for (const customerId of set) {
      const hold = holdByCustomer.get(customerId)
      if (!hold) continue
      if (!holds.has(hold.id)) holds.set(hold.id, { legalHoldId: hold.id, heldCustomerId: customerId, conversationIds: new Set() })
      holds.get(hold.id).conversationIds.add(conversationId)
    }
  }
  return holds
}

/** Every archived line sealed under one of these Customers' keys, from verified files only. */
async function readArchivedLinesUnderKeys(tx, { tenantId, customerIds, baseDir, env }) {
  const lines = new Map()
  const deks = new Map()
  try {
    for (const customerId of customerIds) {
      const dek = await openExistingCustomerArchiveKeyDek(tx, { tenantId, customerId }, env)
      if (dek) deks.set(customerId, dek)
    }
    if (deks.size === 0) return { lines, chainIntegrity: { valid: true } }
    const chainIntegrity = await verifyManifestChain(tx, tenantId, { baseDir, checkFiles: true })
    if (!chainIntegrity.valid) return { lines, chainIntegrity }
    const manifests = await tx.archiveManifest.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })
    for (const manifest of manifests) {
      const raw = await fs.readFile(path.join(baseDir, manifest.filePath))
      if (createHash('sha256').update(raw).digest('hex') !== manifest.fileSha256) continue
      const fileLines = raw.toString('utf8').trim().split('\n')
      const header = JSON.parse(fileLines[0])
      for (const segmentLine of fileLines.slice(1)) {
        const segment = JSON.parse(segmentLine)
        const dek = segment?.customerId ? deks.get(segment.customerId) : null
        if (!dek) continue
        let plaintext
        try {
          plaintext = gunzipSync(openArchiveSegment(segment, { dek, tenantId, customerId: segment.customerId, runId: header.runId })).toString('utf8')
        } catch (error) {
          if (error instanceof ChatEvidenceArchiveCryptoError) continue
          throw error
        }
        for (const line of plaintext.trim().split('\n')) {
          if (!line) continue
          const archived = JSON.parse(line)
          if (!lines.has(archived.messageId)) lines.set(archived.messageId, archived)
        }
      }
    }
    return { lines, chainIntegrity }
  } finally {
    for (const dek of deks.values()) dek.fill(0)
  }
}

/**
 * Re-seal, under the qualifying legal holds, the evidence this erasure is about
 * to destroy (see the module header). Runs inside the caller's erasure
 * transaction. Returns what it wrote so the caller can report it and, on
 * rollback, remove the file.
 *
 * @param {object} tx - the erasure transaction client.
 * @param {{tenantId: string, erasedCustomerIds: string[], speakerChannelIdentityIds: string[],
 *   capturedLines: object[], now: Date, env?: object, baseDir?: string}} input
 * @returns {Promise<{holds: {legalHoldId: string, messageCount: number}[], file: {runId: string, relativePath: string, baseDir: string}|null,
 *   manifestId: string|null, chainIntegrity: object}>}
 */
export async function resealErasedEvidenceUnderLegalHolds(tx, {
  tenantId, erasedCustomerIds, speakerChannelIdentityIds = [], capturedLines = [], now = new Date(), env = process.env, baseDir,
}) {
  const none = { holds: [], file: null, manifestId: null, chainIntegrity: { valid: true } }
  const erased = [...new Set((erasedCustomerIds ?? []).filter(Boolean))]
  if (!tenantId || erased.length === 0 || !(await tenantHasActiveRetentionConsent(tx, { tenantId }))) return none

  // Every thread the erased Customers are members of: owned, or spoken in.
  const identities = [...new Set((speakerChannelIdentityIds ?? []).filter(Boolean))]
  const [owned, spoken] = await Promise.all([
    tx.conversation.findMany({ where: { tenantId, customerId: { in: erased } }, select: { id: true } }),
    identities.length
      ? tx.message.findMany({ where: { conversation: { tenantId }, authorChannelIdentityId: { in: identities } }, select: { conversationId: true }, distinct: ['conversationId'] })
      : [],
  ])
  const conversationIds = [...new Set([...owned.map((c) => c.id), ...spoken.map((m) => m.conversationId), ...capturedLines.map((m) => m.conversation.id)])]
  const holds = await findQualifyingHolds(tx, { tenantId, conversationIds, erasedCustomerIds: erased, now })
  if (holds.size === 0) return none

  const resolvedBaseDir = baseDir ?? resolveArchiveBaseDir(env)
  await assertArchiveStorageReady(resolvedBaseDir, env)

  const { lines: archived, chainIntegrity } = await readArchivedLinesUnderKeys(tx, { tenantId, customerIds: erased, baseDir: resolvedBaseDir, env })
  const replySources = await resolveReplySources(tx, [...new Set(capturedLines.map((m) => m.conversation.id))])
  const allLines = new Map(archived)
  for (const message of capturedLines) {
    if (allLines.has(message.id)) continue
    allLines.set(message.id, JSON.parse(buildArchiveLine(message, { tenantId, replySource: replySources.get(message.id) })))
  }

  const runId = buildRunId(now)
  const segments = []
  const report = []
  const messageIds = new Set()
  for (const hold of [...holds.values()].sort((a, b) => a.legalHoldId.localeCompare(b.legalHoldId))) {
    const kept = [...allLines.values()]
      .filter((line) => hold.conversationIds.has(line.conversationId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.messageId.localeCompare(b.messageId))
    if (kept.length === 0) continue
    const dek = await getOrCreateLegalHoldArchiveKeyDek(tx, { tenantId, legalHoldId: hold.legalHoldId, heldCustomerId: hold.heldCustomerId }, env)
    try {
      const plaintext = gzipSync(Buffer.from(`${kept.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8'))
      segments.push(sealHoldArchiveSegment({ dek, tenantId, legalHoldId: hold.legalHoldId, heldCustomerId: hold.heldCustomerId, runId, plaintext }))
    } finally {
      dek.fill(0)
    }
    for (const line of kept) messageIds.add(line.messageId)
    report.push({ legalHoldId: hold.legalHoldId, messageCount: kept.length })
  }
  if (segments.length === 0) return { ...none, chainIntegrity }

  const header = {
    v: ARCHIVE_HOLD_FORMAT_VERSION, kind: 'LEGAL_HOLD_RESEAL', tenantId, runId,
    kekId: resolveArchiveKeyring(env).current.label, createdAt: now.toISOString(),
  }
  const { relativePath, fileSha256 } = await writeArchiveFile({ baseDir: resolvedBaseDir, tenantId, runId, now, header, segments })
  const file = { runId, relativePath, baseDir: resolvedBaseDir }
  const ids = [...messageIds]
  const messageIdListHash = hashMessageIdList(ids)
  const previous = await tx.archiveManifest.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
  const previousManifestHash = previous?.manifestHash ?? null
  const manifestHash = computeManifestHash({
    tenantId, runId, filePath: relativePath, fileSha256, messageCount: ids.length, messageIdListHash, previousManifestHash,
  })
  try {
    const manifest = await tx.archiveManifest.create({
      data: { tenantId, runId, filePath: relativePath, fileSha256, messageCount: ids.length, messageIdListHash, previousManifestId: previous?.id ?? null, previousManifestHash, manifestHash },
    })
    return { holds: report, file, manifestId: manifest.id, chainIntegrity }
  } catch (error) {
    error.archiveFile = file
    throw error
  }
}
