// @req SEC-034 — the chat evidence archive's 10-year retention (ADR-093 D5;
//   TASK-ZAI-113 P2). For one Tenant: destroys a Customer's archive data key
//   once every archived line they have — across every manifest, not only one
//   file — is at least `retentionYears` old, and deletes an archive file once
//   every line in it, for every Customer named in it, has expired. Not wired
//   into a route or a scheduled worker here — that production wiring is
//   TASK-ZAI-114's job, matching how TASK-ZAI-111 built the archive writer
//   without wiring its own cron.
// @spec ADR-093 D5, D6; SEC-034; SDD-103
// @tested tests/integration/crm-archive-legal-hold.test.js
//
// WHY THE WHOLE-TENANT CHAIN IS CHECKED FIRST, BEFORE ANY DESTRUCTION
// -----------------------------------------------------------------------
// This module makes irreversible decisions from message ages it reads out of
// archive files. If a manifest row or file were silently tampered with or
// dropped from the middle of the chain, an age computed from what remains
// could be wrong in either direction — and wrong here can mean destroying a
// key (and, later, a file) that still guarded content inside its 10-year term.
// `chat-evidence-retrieval-service.js` already established the fix for reading
// under this exact threat model: call the existing `verifyManifestChain` (with
// `checkFiles: true`) for the whole Tenant BEFORE trusting any manifest
// individually, and refuse the run entirely if it is broken. Re-deriving a
// weaker, per-manifest-only check here — the mistake a sibling lane's reviewed
// code made this same week — would silently reopen exactly the gap that fix
// closed. A broken chain destroys nothing and deletes nothing for that Tenant;
// the run is recorded as skipped, not silently a no-op.
//
// WHAT "EVERY LINE HAS EXPIRED" MEANS FOR A FILE (a genuine design decision —
// ADR-093 does not spell this out, only the plain 10-year case)
// -----------------------------------------------------------------------
// A file can hold segments for several Customers, and D5's per-Customer key
// lifetime does not line up with any one file's own age: a Customer's key
// survives as long as ANY of their lines anywhere are still young, so an old
// file can sit next to a Customer whose key is still alive because of a NEWER
// file. Per-file deletion is therefore judged on that file's own lines, not on
// whether each named Customer's key still exists elsewhere. For each Customer
// segment named in a candidate file, this treats the segment as "expired"
// (does not block deleting the file) in exactly two cases:
//   1. A live, unheld CustomerArchiveKey row still exists for them, and every
//      line THIS run could decrypt for them IN THIS FILE is older than
//      `retentionYears` — verified by opening the segment, not assumed.
//   2. No CustomerArchiveKey row exists for them at all — their key is
//      already gone, for any reason, including this same run's own natural-
//      aging destruction a few lines above, or an earlier PDPA erasure. Once a
//      key is gone there is no code path that ever brings it back (unlike a
//      legal hold, which is a live row that can simply lapse); the segment is
//      permanently unreadable ciphertext with no future evidentiary value to
//      anyone, on any timeline, so keeping the file around serves nothing that
//      the audit trail (which already recorded why and when the key ended)
//      does not already serve better. This applies uniformly regardless of
//      *why* the key is gone — this module does not need to know, and cannot
//      reliably tell, whether a prior destruction was expiry or an early PDPA
//      erasure, and treating them differently here would need new schema on a
//      table SEC-030's own precedent already excludes from every snapshot.
// An ACTIVE legal hold always blocks deletion of a file naming that Customer —
// held is never expired, by definition (ADR-093 D6) — and so does a segment
// this run could not positively verify (a read or decrypt failure): "cannot
// prove it is expired" defaults to "leave the file alone," the same fail-closed
// bias the writer and the retrieval path already hold to.

import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  resolveArchiveBaseDir,
  verifyManifestChain,
  findActiveLegalHold,
  destroyCustomerArchiveKey,
} from './chat-evidence-archive-service'
import { openCustomerArchiveKey, openArchiveSegment, ChatEvidenceArchiveCryptoError } from './chat-evidence-archive-crypto'

export const CHAT_EVIDENCE_ARCHIVE_RETENTION_YEARS = 10

function cutoffDate(now, retentionYears) {
  const cutoff = new Date(now.getTime())
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - retentionYears)
  return cutoff
}

/** Read, verify and parse one manifest's file once; cached per call so every
 * Customer whose segment lives in it re-uses the same read. `null` means the
 * file could not be read or verified — every caller treats that as "cannot
 * prove anything about this file," never as "assume it's fine" or "assume it's
 * expired". */
function manifestReader(baseDir) {
  const cache = new Map()
  return async function readManifest(manifest) {
    if (cache.has(manifest.id)) return cache.get(manifest.id)
    let parsed = null
    try {
      const raw = await fs.readFile(path.join(baseDir, manifest.filePath))
      if (createHash('sha256').update(raw).digest('hex') === manifest.fileSha256) {
        const lines = raw.toString('utf8').trim().split('\n')
        const header = JSON.parse(lines[0])
        const segmentLines = lines.slice(1)
        parsed = { header, segmentLines }
      }
    } catch {
      parsed = null
    }
    cache.set(manifest.id, parsed)
    return parsed
  }
}

function findSegmentLine(segmentLines, customerId) {
  return segmentLines.find((line) => {
    try {
      return JSON.parse(line).customerId === customerId
    } catch {
      return false
    }
  })
}

/**
 * Decrypt this Customer's segment in one manifest and return the newest
 * `createdAt` among its lines, or `null` if this manifest has no segment for
 * them. Throws `ChatEvidenceArchiveCryptoError` on a segment that exists but
 * cannot be opened (wrong key epoch, tampered ciphertext) — the caller treats
 * that as "cannot verify," not as an age of zero or infinity.
 */
function newestLineInSegment(parsed, { dek, tenantId, customerId }) {
  const segmentLine = findSegmentLine(parsed.segmentLines, customerId)
  if (!segmentLine) return null
  const segment = JSON.parse(segmentLine)
  const gzipped = openArchiveSegment(segment, { dek, tenantId, customerId, runId: parsed.header.runId })
  const plaintext = gunzipSync(gzipped).toString('utf8')
  let newest = null
  for (const line of plaintext.trim().split('\n')) {
    if (!line) continue
    const createdAt = new Date(JSON.parse(line).createdAt)
    if (!newest || createdAt > newest) newest = createdAt
  }
  return newest
}

/**
 * Run 10-year expiry for one Tenant (ADR-093 D5, D6). Destroys every Customer
 * key whose archived lines are now entirely past `retentionYears`, unless an
 * active legal hold protects them, and deletes every archive file whose lines
 * have all expired for every Customer it names (see the module docstring for
 * exactly what that means). Always writes one `ARCHIVE_EXPIRY_COMPLETED` audit
 * event, including a run that destroys and deletes nothing, or one refused
 * outright by a broken chain — an access review must see the attempt either way.
 *
 * @param {object} db - a Prisma client (not a transaction: this makes many
 *   independent, individually-safe writes across possibly many Customers and
 *   files, not one atomic unit — the same shape `runRetentionSweep` uses
 *   across Tenants).
 * @param {{tenantId: string, now?: Date, baseDir?: string, env?: object, retentionYears?: number}} input
 */
export async function expireChatEvidenceArchive(db, {
  tenantId, now = new Date(), baseDir = resolveArchiveBaseDir(), env = process.env,
  retentionYears = CHAT_EVIDENCE_ARCHIVE_RETENTION_YEARS,
} = {}) {
  if (!tenantId) throw new Error('expireChatEvidenceArchive requires tenantId')
  const cutoff = cutoffDate(now, retentionYears)
  const readManifest = manifestReader(baseDir)

  const chainIntegrity = await verifyManifestChain(db, tenantId, { baseDir, checkFiles: true })
  if (!chainIntegrity.valid) {
    const audit = await recordAudit(db, {
      entityType: 'ARCHIVE',
      entityId: `expiry:${tenantId}:${now.toISOString()}`,
      action: 'ARCHIVE_EXPIRY_COMPLETED',
      actorType: 'SYSTEM',
      tenantId,
      payload: { tenantId, ranAt: now.toISOString(), skipped: true, chainIntegrity, destroyedKeys: [], deletedFiles: [] },
    })
    return { tenantId, ranAt: now, skipped: true, chainIntegrity, destroyedKeys: [], deletedFiles: [], auditEventId: audit.id }
  }

  const manifests = await db.archiveManifest.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })

  // customerId -> Set(manifest.id) — which files carry a segment naming them,
  // discovered by parsing each segment's wrapper JSON (cheap: it is the
  // ciphertext envelope, not a decryption) rather than trusting anything
  // outside the files themselves.
  const manifestsByCustomer = new Map()
  for (const manifest of manifests) {
    const parsed = await readManifest(manifest)
    if (!parsed) continue
    for (const line of parsed.segmentLines) {
      let customerId
      try {
        customerId = JSON.parse(line).customerId
      } catch {
        continue
      }
      if (!customerId) continue
      if (!manifestsByCustomer.has(customerId)) manifestsByCustomer.set(customerId, new Set())
      manifestsByCustomer.get(customerId).add(manifest.id)
    }
  }

  const keysAtStart = await db.customerArchiveKey.findMany({ where: { tenantId } })
  const destroyedKeys = []
  // customerId -> Map(manifest.id -> newest createdAt in that file's segment),
  // populated only for a Customer this run could fully and successfully
  // decrypt across every manifest naming them.
  const verifiedAges = new Map()

  for (const keyRow of keysAtStart) {
    const hold = await findActiveLegalHold(db, { customerId: keyRow.customerId }, now)
    if (hold) continue // key survives; every one of their segments is "held", not expired

    const manifestIds = manifestsByCustomer.get(keyRow.customerId)
    if (!manifestIds || manifestIds.size === 0) continue // a key with no archived line found anywhere — leave it alone rather than guess

    let dek
    try {
      dek = openCustomerArchiveKey(keyRow, { customerId: keyRow.customerId, tenantId }, env)
    } catch {
      continue // cannot open this Customer's key — leave it alone
    }
    try {
      const perManifestNewest = new Map()
      let overallNewest = null
      let verifiable = true
      for (const manifestId of manifestIds) {
        const manifest = manifests.find((m) => m.id === manifestId)
        const parsed = manifest ? await readManifest(manifest) : null
        if (!parsed) {
          verifiable = false
          break
        }
        let newest
        try {
          newest = newestLineInSegment(parsed, { dek, tenantId, customerId: keyRow.customerId })
        } catch (error) {
          if (error instanceof ChatEvidenceArchiveCryptoError) {
            verifiable = false
            break
          }
          throw error
        }
        if (!newest) {
          verifiable = false // the presence scan found this customerId in this file, but the segment could not be opened/parsed after all
          break
        }
        perManifestNewest.set(manifestId, newest)
        if (!overallNewest || newest > overallNewest) overallNewest = newest
      }
      if (!verifiable) continue // cannot positively account for every one of this Customer's lines — leave the key alone

      verifiedAges.set(keyRow.customerId, perManifestNewest)
      if (overallNewest && overallNewest < cutoff) {
        const result = await destroyCustomerArchiveKey(db, { tenantId, customerId: keyRow.customerId, now })
        if (result.destroyed) destroyedKeys.push(keyRow.customerId)
      }
    } finally {
      dek.fill(0)
    }
  }

  const keyExistedAtStart = new Set(keysAtStart.map((k) => k.customerId))
  const deletedFiles = []
  for (const manifest of manifests) {
    const parsed = await readManifest(manifest)
    if (!parsed) continue // cannot positively account for this file's own contents — never delete it

    const customerIdsInFile = new Set()
    for (const line of parsed.segmentLines) {
      try {
        const customerId = JSON.parse(line).customerId
        if (customerId) customerIdsInFile.add(customerId)
      } catch {
        // an unparsable segment line: leave the whole file alone below
        customerIdsInFile.add(Symbol('unparsable'))
      }
    }

    let allExpired = customerIdsInFile.size > 0
    for (const customerId of customerIdsInFile) {
      if (typeof customerId !== 'string') { allExpired = false; break }
      if (!keyExistedAtStart.has(customerId)) continue // key already gone (any reason, any prior run) — permanently unreadable, counts as expired

      // A key existed at the start of this run. Either it is still alive
      // (held, too young, or unverifiable) or this same run just destroyed it
      // moments ago because every line it has, everywhere, is past the cutoff
      // — which necessarily covers this file too.
      if (destroyedKeys.includes(customerId)) continue // this run itself just proved every one of their lines, including this file's, is expired

      const hold = await findActiveLegalHold(db, { customerId }, now)
      if (hold) { allExpired = false; break }

      const perManifestNewest = verifiedAges.get(customerId)
      const newestInThisFile = perManifestNewest?.get(manifest.id)
      if (!newestInThisFile || !(newestInThisFile < cutoff)) { allExpired = false; break }
    }

    if (allExpired) {
      try {
        await fs.unlink(path.join(baseDir, manifest.filePath))
        deletedFiles.push(manifest.id)
      } catch {
        // Already gone, or this host does not have the file mounted (ADR-093
        // D8's second copy) — not fatal to the rest of the run.
      }
    }
  }

  const audit = await recordAudit(db, {
    entityType: 'ARCHIVE',
    entityId: `expiry:${tenantId}:${now.toISOString()}`,
    action: 'ARCHIVE_EXPIRY_COMPLETED',
    actorType: 'SYSTEM',
    tenantId,
    payload: {
      tenantId, ranAt: now.toISOString(), skipped: false, chainIntegrity,
      destroyedKeys, deletedFiles, retentionYears,
    },
  })

  return { tenantId, ranAt: now, skipped: false, chainIntegrity, destroyedKeys, deletedFiles, auditEventId: audit.id }
}
