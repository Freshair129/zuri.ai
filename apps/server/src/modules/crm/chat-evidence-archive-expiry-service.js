// @req SEC-034 — ADR-093 D5, TASK-ZAI-113: an archived message is kept until it
//   is N years old and then destroyed. A Customer's data key is destroyed once
//   no unexpired archived line of theirs remains anywhere, and a file is
//   deleted once every line in every segment it holds has expired — both
//   deferred, per Customer, by an active legal hold (D6).
// @spec ADR-093 D5, D6; SEC-034
// @tested tests/integration/crm-archive-legal-hold.test.js
//
// WHY THIS DECRYPTS RATHER THAN TRUSTING A TIMESTAMP ELSEWHERE
// ---------------------------------------------------------------
// The only record of an archived line's own `createdAt` is inside the
// encrypted segment itself (`ArchiveManifest.createdAt` is when the FILE was
// written, not when any message in it was originally sent). So expiry can
// only be evaluated by opening each Customer's segment in each of their
// files and reading the lines. This is a full re-scan, run rarely (the term
// is years, ADR-093 D5 proposes ten), not a hot path — unlike the retrieval
// service, correctness is worth more here than avoiding the decrypt cost.
//
// FAIL CLOSED ON AN UNREADABLE SEGMENT
// --------------------------------------
// A segment this run could not read or decrypt (a missing file, a hash
// mismatch, a corrupt or wrong-epoch key) contributes NOTHING to either
// destroy decision — never treated as "no lines, therefore already expired".
// A Customer's key is destroyed only once every one of their segments this
// run COULD read is confirmed to hold nothing but expired lines; a file is
// deleted only once every segment in it is confirmed expired or its
// Customer's key is already gone. Silence is not evidence of expiry.
//
// TWO PASSES, ONE READ
// -----------------------
// Every manifest still on disk is read and every readable segment decrypted
// exactly once per run, into an in-memory working set. Pass 1 (per Customer,
// across every manifest) decides key destruction; pass 2 (per manifest,
// across every segment in it) decides file deletion, re-checking which keys
// survived pass 1 — a segment whose key pass 1 just destroyed counts as
// expired for pass 2 without re-reading anything.

import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { resolveArchiveBaseDir } from './chat-evidence-archive-service'
import { openCustomerArchiveKey, openArchiveSegment, ChatEvidenceArchiveCryptoError } from './chat-evidence-archive-crypto'
import { activeLegalHolds } from './archive-legal-hold-service'

const DEFAULT_TERM_YEARS = 10

function cutoffDate(now, termYears) {
  const cutoff = new Date(now.getTime())
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - termYears)
  return cutoff
}

/** Read, verify and parse one manifest's file into { customerId -> raw segment }. Missing/tampered files answer null. */
async function readManifestSegments(baseDir, manifest) {
  let raw
  try {
    raw = await readFile(path.join(baseDir, manifest.filePath))
  } catch {
    return null
  }
  if (createHash('sha256').update(raw).digest('hex') !== manifest.fileSha256) return null
  const lines = raw.toString('utf8').trim().split('\n')
  try {
    const segments = new Map()
    for (const line of lines.slice(1)) {
      const segment = JSON.parse(line)
      segments.set(segment.customerId, segment)
    }
    return segments
  } catch {
    return null
  }
}

/** Decrypt one Customer's segment into its parsed archive lines, or null if it cannot be read this run. */
function decryptSegmentLines(segment, { keyRow, tenantId, customerId, runId, env }) {
  try {
    const dek = openCustomerArchiveKey(keyRow, { customerId, tenantId }, env)
    try {
      const gzipped = openArchiveSegment(segment, { dek, tenantId, customerId, runId })
      const plaintext = gunzipSync(gzipped).toString('utf8').trim()
      return plaintext ? plaintext.split('\n').map((line) => JSON.parse(line)) : []
    } finally {
      dek.fill(0)
    }
  } catch (err) {
    if (err instanceof ChatEvidenceArchiveCryptoError) return null
    throw err
  }
}

/**
 * Sweep one Tenant's chat evidence archive for term-expired content (ADR-093
 * D5): destroy a Customer's archive key once no unexpired line of theirs
 * remains anywhere, and delete a file once every segment in it has expired —
 * both skipped for a Customer under an active legal hold (D6).
 */
async function sweepTenantArchiveExpiry(db, tenantId, { now, cutoff, baseDir, env }) {
  const manifests = await db.archiveManifest.findMany({ where: { tenantId, fileDeletedAt: null }, orderBy: { createdAt: 'asc' } })
  const keys = await db.customerArchiveKey.findMany({ where: { tenantId } })
  if (keys.length === 0) return { destroyedArchiveKeys: 0, deletedFiles: 0 }

  // One read, one decrypt attempt per (manifest, Customer) pair this run will
  // ever need — reused by both passes below.
  const rawSegmentsByManifest = new Map()
  const linesByManifestAndCustomer = new Map() // `${manifestId}:${customerId}` -> lines[] | null (unreadable)
  for (const manifest of manifests) {
    const rawSegments = await readManifestSegments(baseDir, manifest)
    rawSegmentsByManifest.set(manifest.id, rawSegments)
    if (!rawSegments) continue
    for (const keyRow of keys) {
      const segment = rawSegments.get(keyRow.customerId)
      if (!segment) continue
      const lines = decryptSegmentLines(segment, { keyRow, tenantId, customerId: keyRow.customerId, runId: manifest.runId, env })
      linesByManifestAndCustomer.set(`${manifest.id}:${keyRow.customerId}`, lines)
    }
  }

  // Pass 1 — per-Customer key destruction.
  let destroyedArchiveKeys = 0
  const survivingCustomerIds = new Set(keys.map((keyRow) => keyRow.customerId))
  for (const keyRow of keys) {
    const holds = await activeLegalHolds(db, { customerId: keyRow.customerId, now })
    if (holds.length > 0) continue

    let sawAnyLine = false
    let sawUnexpiredLine = false
    for (const manifest of manifests) {
      const lines = linesByManifestAndCustomer.get(`${manifest.id}:${keyRow.customerId}`)
      if (!lines) continue // unreadable this run — contributes nothing
      for (const line of lines) {
        sawAnyLine = true
        if (new Date(line.createdAt).getTime() > cutoff.getTime()) { sawUnexpiredLine = true; break }
      }
      if (sawUnexpiredLine) break
    }
    if (sawAnyLine && !sawUnexpiredLine) {
      await db.customerArchiveKey.delete({ where: { id: keyRow.id } })
      survivingCustomerIds.delete(keyRow.customerId)
      destroyedArchiveKeys += 1
    }
  }

  // Pass 2 — per-file deletion, against post-pass-1 key survival.
  let deletedFiles = 0
  for (const manifest of manifests) {
    const rawSegments = rawSegmentsByManifest.get(manifest.id)
    if (!rawSegments) continue // unreadable this run — never delete on "could not check"

    let everySegmentExpired = true
    for (const customerId of rawSegments.keys()) {
      if (!survivingCustomerIds.has(customerId)) continue // key already gone — this segment is already permanently unreadable
      const holds = await activeLegalHolds(db, { customerId, now })
      if (holds.length > 0) { everySegmentExpired = false; break }
      const lines = linesByManifestAndCustomer.get(`${manifest.id}:${customerId}`)
      if (!lines) { everySegmentExpired = false; break } // unreadable this run — fail closed, do not delete
      if (lines.some((line) => new Date(line.createdAt).getTime() > cutoff.getTime())) { everySegmentExpired = false; break }
    }

    if (everySegmentExpired) {
      await unlink(path.join(baseDir, manifest.filePath))
      await db.archiveManifest.update({ where: { id: manifest.id }, data: { fileDeletedAt: now } })
      deletedFiles += 1
    }
  }

  return { destroyedArchiveKeys, deletedFiles }
}

/**
 * Sweep every Tenant's chat evidence archive for term-expired content
 * (ADR-093 D5) and write exactly one audit event naming the totals.
 *
 * @param {{db?: object, now?: Date, termYears?: number, baseDir?: string, env?: object}} [options]
 * @returns {Promise<{auditEventId: string, destroyedArchiveKeys: number, deletedFiles: number}>}
 */
export async function sweepArchiveExpiry({ db = prisma, now = new Date(), termYears = DEFAULT_TERM_YEARS, baseDir = resolveArchiveBaseDir(), env = process.env } = {}) {
  const cutoff = cutoffDate(now, termYears)
  const tenantIds = [...new Set((await db.customerArchiveKey.findMany({ select: { tenantId: true } })).map((row) => row.tenantId))]

  let destroyedArchiveKeys = 0
  let deletedFiles = 0
  for (const tenantId of tenantIds) {
    const result = await sweepTenantArchiveExpiry(db, tenantId, { now, cutoff, baseDir, env })
    destroyedArchiveKeys += result.destroyedArchiveKeys
    deletedFiles += result.deletedFiles
  }

  const event = await recordAudit(db, {
    entityType: 'ARCHIVE',
    entityId: `expiry-sweep:${now.toISOString()}`,
    action: 'ARCHIVE_EXPIRY_SWEEP_COMPLETED',
    actorType: 'SYSTEM',
    payload: { ranAt: now.toISOString(), termYears, tenantsSwept: tenantIds.length, destroyedArchiveKeys, deletedFiles },
  })

  return { auditEventId: event.id, destroyedArchiveKeys, deletedFiles }
}
