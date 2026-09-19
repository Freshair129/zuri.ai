// @req FR-245 — the chat evidence cold archive writer (ADR-093 D2-D4, D6; SDD-103;
//   SEC-034). Called from `retention-sweep-service.js` in the gap between
//   candidate selection and the tombstone writes it used to run unconditionally:
//   for each Tenant, this module writes the batch to a new file, flushes it,
//   reads it back, verifies its hash, and only then does the caller's
//   transaction insert a manifest row and tombstone exactly what was archived.
// @spec ADR-093 D2, D3, D4, D6; SDD-103; SEC-034; BR-002
// @tested tests/unit/crm-chat-evidence-archive-crypto.test.js, tests/integration/crm-chat-evidence-archive.test.js
//
// FAIL CLOSED, STRUCTURALLY (ADR-093 D2)
// ---------------------------------------
// `archiveAndTombstoneTenantMessages` is the ONLY function this module exports
// that touches `Message`/`MessageAttachment`, and the tombstone `updateMany`
// calls live textually inside the same `db.$transaction` callback that just
// inserted the verified manifest row — there is no earlier return that reaches
// them, and no other exported function can reach them at all. Every step
// before that transaction (minting/opening a Customer's key, building and
// gzip-sealing their segment, writing the file under a temp name, fsyncing,
// renaming, reading it back, comparing its SHA-256) either produces the exact
// input the transaction needs or throws — it never partially tombstones and
// never tombstones on a caught error. A caller that wants "the rest of the
// sweep keeps going" catches around this call per Tenant; this module itself
// never swallows a failure into a false success.
//
// ARCHIVE DIRECTORY (ADR-093 D3)
// -------------------------------
// Local/test calls may omit `ZURI_ARCHIVE_DIR` and use a per-machine temp
// directory. Production is fail-closed: `ZURI_ARCHIVE_DIR=/archive` must be
// selected, exist as a real directory and match the process mount-info boundary
// before any key, file or tombstone operation. The app guard cannot prove the
// host's separate physical disk; that remains a deployment gate.
//
// FILE FORMAT (SDD-103)
// ----------------------
// `<baseDir>/<tenantId>/<yyyy>/<runId>.zca`, UTF-8, newline-delimited JSON:
//   line 1   header — { v, tenantId, runId, kekId, createdAt }
//   line 2.. one sealed segment per Customer — { customerId, iv, tag, ciphertext }
// A segment's ciphertext is AES-256-GCM over gzip(JSON Lines), one line per
// archived message (see `buildArchiveLine`). The writer creates the file under
// a temporary name in the same directory, fsyncs it, renames it into place,
// reads it back and compares SHA-256 against what was written — verification
// is against the bytes actually on disk after the rename, not against the
// buffer still held in memory. A run never overwrites an existing file: the
// target path is checked before anything is written.

import { createHash, randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ChatEvidenceArchiveCryptoError,
  mintCustomerArchiveKey,
  openCustomerArchiveKey,
  resolveArchiveKeyring,
  sealArchiveSegment,
} from './chat-evidence-archive-crypto'
import { RETENTION_SWEEP_TOMBSTONE } from './retention-sweep-tombstone'

export class ChatEvidenceArchiveWriteError extends Error {
  constructor(code, cause) {
    super(code)
    this.name = 'ChatEvidenceArchiveWriteError'
    this.code = code
    if (cause) this.cause = cause
  }
}

export class ChatEvidenceArchiveStorageError extends Error {
  constructor(code, cause) {
    super(code)
    this.name = 'ChatEvidenceArchiveStorageError'
    this.code = code
    if (cause) this.cause = cause
  }
}

export class ChatEvidenceArchiveTransactionError extends Error {
  constructor(code, cause) {
    super(code)
    this.name = 'ChatEvidenceArchiveTransactionError'
    this.code = code
    this.status = 503
    this.retryable = true
    if (cause) this.cause = cause
  }
}

const PRODUCTION_ARCHIVE_ROOT = '/archive'

const REPLY_AUDIT_ACTIONS = ['REPLY_DELIVERED', 'OUTBOUND_ACCEPTED', 'STAFF_REPLY_DELIVERED']

/**
 * The archive's base directory. Local/test calls retain the per-machine temp
 * fallback. Production is a different boundary: only the canonical container
 * root named by ADR-093/SDD-103 is accepted here; existence and mount proof are
 * checked asynchronously before any key, file or tombstone operation.
 */
export function resolveArchiveBaseDir(env = process.env) {
  const raw = typeof env.ZURI_ARCHIVE_DIR === 'string' ? env.ZURI_ARCHIVE_DIR.trim() : ''
  if (env.NODE_ENV === 'production') {
    if (!raw) throw new ChatEvidenceArchiveStorageError('ARCHIVE_STORAGE_REQUIRED')
    if (!path.posix.isAbsolute(raw) || path.posix.normalize(raw) !== PRODUCTION_ARCHIVE_ROOT || raw !== path.posix.normalize(raw)) {
      throw new ChatEvidenceArchiveStorageError('ARCHIVE_STORAGE_ROOT_INVALID')
    }
    return PRODUCTION_ARCHIVE_ROOT
  }
  if (raw) return raw
  return path.join(os.tmpdir(), 'zuri-chat-evidence-archive')
}

function decodeMountInfoPath(value) {
  return value.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\134/g, '\\')
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/**
 * Prove the selected production root is usable before any archive key or file
 * write. `/proc/self/mountinfo` is intentionally required in production: an
 * env var naming `/archive` does not prove the compose overlay mounted there.
 * The separate physical-disk property remains a deployment-level check.
 */
export async function assertArchiveStorageReady(baseDir, env = process.env) {
  if (env.NODE_ENV !== 'production') return baseDir
  const configured = resolveArchiveBaseDir(env)
  const selected = path.posix.normalize(String(baseDir || ''))
  if (selected !== configured || selected !== PRODUCTION_ARCHIVE_ROOT) {
    throw new ChatEvidenceArchiveStorageError('ARCHIVE_STORAGE_ROOT_INVALID')
  }
  let stat
  let realPath
  try {
    stat = await fs.stat(selected)
    realPath = await fs.realpath(selected)
  } catch (error) {
    throw new ChatEvidenceArchiveStorageError('ARCHIVE_STORAGE_UNAVAILABLE', error)
  }
  if (!stat.isDirectory() || realPath !== selected) {
    throw new ChatEvidenceArchiveStorageError('ARCHIVE_STORAGE_NOT_CANONICAL')
  }
  let mountInfo
  try {
    mountInfo = await fs.readFile('/proc/self/mountinfo', 'utf8')
  } catch (error) {
    throw new ChatEvidenceArchiveStorageError('ARCHIVE_STORAGE_MOUNT_UNVERIFIED', error)
  }
  const mounted = mountInfo.split(/\r?\n/).some((line) => {
    const fields = line.split(' ')
    return decodeMountInfoPath(fields[4] || '') === selected
  })
  if (!mounted) throw new ChatEvidenceArchiveStorageError('ARCHIVE_STORAGE_MOUNT_UNVERIFIED')
  return selected
}

function buildRunId(now) {
  return `${now.toISOString().replace(/[:.]/g, '')}-${randomBytes(4).toString('hex')}`
}

/** Deterministic across the exact same set of ids, regardless of input order. */
export function hashMessageIdList(messageIds) {
  const sorted = [...messageIds].sort()
  return createHash('sha256').update(sorted.join('\n')).digest('hex')
}

/**
 * The per-Tenant chain hash: computed once, at insert, over a manifest row's
 * own fields — including the previous manifest's own hash, which is what makes
 * this a chain rather than a set of independent checksums. Recomputing it from
 * a row's stored fields and comparing against the stored `manifestHash` is the
 * whole of chain verification; a single changed field anywhere breaks every
 * hash computed after it.
 */
export function computeManifestHash({ tenantId, runId, filePath, fileSha256, messageCount, messageIdListHash, previousManifestHash }) {
  const canonical = JSON.stringify({
    tenantId, runId, filePath, fileSha256, messageCount, messageIdListHash,
    previousManifestHash: previousManifestHash ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Walk one Tenant's manifest chain from the oldest row, recomputing every
 * hash. `checkFiles: true` additionally re-hashes the actual file on disk
 * (needs `baseDir`) — a manifest row can be internally consistent while the
 * file it names has been altered after the fact, and that is exactly the case
 * this flag exists to catch.
 */
function orderPersistedManifestChain(manifests) {
  if (manifests.length === 0) return { manifests, error: null }
  if (!manifests.every((manifest) => manifest && Object.prototype.hasOwnProperty.call(manifest, 'previousManifestId'))) {
    return { manifests: [], error: { reason: 'MANIFEST_CHAIN_LINK_MISSING', brokenAtManifestId: manifests.find((manifest) => !manifest || !Object.prototype.hasOwnProperty.call(manifest, 'previousManifestId'))?.id } }
  }
  const byId = new Map()
  for (const manifest of manifests) {
    if (!manifest || typeof manifest.id !== 'string' || !manifest.id || byId.has(manifest.id)) return { manifests: [], error: { reason: 'MANIFEST_CHAIN_ID_INVALID', brokenAtManifestId: manifest?.id } }
    byId.set(manifest.id, manifest)
  }
  const children = new Map()
  const roots = []
  for (const manifest of manifests) {
    const previousId = manifest.previousManifestId ?? null
    if (previousId === null) {
      roots.push(manifest)
      continue
    }
    const previous = byId.get(previousId)
    if (!previous) return { manifests: [], error: { reason: 'PREVIOUS_MANIFEST_MISSING', brokenAtManifestId: manifest.id } }
    if (manifest.previousManifestHash !== previous.manifestHash) {
      return { manifests: [], error: { reason: 'PREVIOUS_HASH_MISMATCH', brokenAtManifestId: manifest.id } }
    }
    const successors = children.get(previousId) || []
    successors.push(manifest)
    children.set(previousId, successors)
  }
  if (roots.length !== 1) {
    const detachedRoot = roots.find((manifest) => manifest.previousManifestHash !== null && manifest.previousManifestHash !== undefined)
    return { manifests: [], error: { reason: 'MANIFEST_CHAIN_ROOT_INVALID', brokenAtManifestId: detachedRoot?.id || roots[0]?.id } }
  }
  for (const [previousId, successors] of children) {
    if (successors.length > 1) return { manifests: [], error: { reason: 'MANIFEST_CHAIN_BRANCH', brokenAtManifestId: previousId } }
  }
  const ordered = []
  const seen = new Set()
  let current = roots[0]
  while (current) {
    if (seen.has(current.id)) return { manifests: [], error: { reason: 'MANIFEST_CHAIN_CYCLE', brokenAtManifestId: current.id } }
    seen.add(current.id)
    ordered.push(current)
    current = (children.get(current.id) || [])[0] || null
  }
  if (ordered.length !== manifests.length) {
    const disconnected = manifests.find((manifest) => !seen.has(manifest.id))
    return { manifests: [], error: { reason: 'MANIFEST_CHAIN_CYCLE', brokenAtManifestId: disconnected?.id } }
  }
  return { manifests: ordered, error: null }
}

export async function verifyManifestChain(db, tenantId, { baseDir, checkFiles = false } = {}) {
  const queried = await db.archiveManifest.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })
  const ordered = orderPersistedManifestChain(queried)
  if (ordered.error) return { valid: false, ...ordered.error }
  let expectedPreviousHash = null
  for (const manifest of ordered.manifests) {
    if ((manifest.previousManifestHash ?? null) !== expectedPreviousHash) {
      return { valid: false, brokenAtManifestId: manifest.id, reason: 'PREVIOUS_HASH_MISMATCH' }
    }
    const recomputed = computeManifestHash(manifest)
    if (recomputed !== manifest.manifestHash) {
      return { valid: false, brokenAtManifestId: manifest.id, reason: 'MANIFEST_HASH_MISMATCH' }
    }
    if (checkFiles) {
      if (!baseDir) throw new Error('verifyManifestChain: checkFiles requires baseDir')
      let actual
      try {
        actual = createHash('sha256').update(await fs.readFile(path.join(baseDir, manifest.filePath))).digest('hex')
      } catch (error) {
        return { valid: false, brokenAtManifestId: manifest.id, reason: 'ARCHIVE_FILE_MISSING', cause: error }
      }
      if (actual !== manifest.fileSha256) {
        return { valid: false, brokenAtManifestId: manifest.id, reason: 'ARCHIVE_FILE_TAMPERED' }
      }
    }
    expectedPreviousHash = manifest.manifestHash
  }
  return { valid: true }
}

/**
 * This Customer's data key, as a usable (unwrapped) DEK — minted and persisted
 * the first time this Customer's content is archived, opened from the
 * existing row every time after. A row that names a different Tenant than the
 * one asking is refused rather than trusted (a Customer never moves Tenant;
 * seeing this would mean the row or the caller is wrong, not that the mismatch
 * should be papered over).
 */
export async function getOrCreateCustomerArchiveKeyDek(db, { tenantId, customerId }, env = process.env, { baseDir } = {}) {
  const resolvedBaseDir = baseDir ?? resolveArchiveBaseDir(env)
  await assertArchiveStorageReady(resolvedBaseDir, env)
  const existing = await db.customerArchiveKey.findUnique({ where: { customerId } })
  if (existing) {
    if (existing.tenantId !== tenantId) throw new ChatEvidenceArchiveCryptoError('ARCHIVE_KEY_SCOPE_MISMATCH')
    return openCustomerArchiveKey(existing, { customerId, tenantId }, env)
  }
  const { row, dek } = mintCustomerArchiveKey({ customerId, tenantId }, env)
  try {
    await db.customerArchiveKey.create({ data: row })
    return dek
  } catch (error) {
    // Another concurrent sweep (or a retry) minted this Customer's key first —
    // the unique constraint on customerId is the tiebreaker; the loser opens
    // the winner's row instead of erroring the whole run over a race that has
    // exactly one correct outcome either way.
    if (error?.code !== 'P2002') throw error
    dek.fill(0)
    const winner = await db.customerArchiveKey.findUnique({ where: { customerId } })
    if (!winner) throw error
    return openCustomerArchiveKey(winner, { customerId, tenantId }, env)
  }
}

async function resolveReplySources(db, conversationIds) {
  if (conversationIds.length === 0) return new Map()
  // The exact STACK/TRANSPORT_FALLBACK/STAFF distinction is recorded only in
  // the audit payload (reply-record-service.js never stores it on Message
  // itself) — reading it here rather than guessing from externalMessageId's
  // shape is what makes the archived `replySource` field trustworthy evidence
  // instead of a best-effort label. A message with no matching event (a row
  // that predates this audit trail) archives with replySource "UNKNOWN" rather
  // than failing the whole run over one unrecorded provenance.
  const events = await db.auditEvent.findMany({
    where: { entityType: 'CONVERSATION', entityId: { in: conversationIds }, action: { in: REPLY_AUDIT_ACTIONS } },
    select: { payloadJson: true },
  })
  const bySource = new Map()
  for (const event of events) {
    let payload
    try {
      payload = JSON.parse(event.payloadJson)
    } catch {
      continue
    }
    if (payload && typeof payload.messageId === 'string' && typeof payload.source === 'string') {
      bySource.set(payload.messageId, payload.source)
    }
  }
  return bySource
}

function buildArchiveLine(message, { tenantId, replySource }) {
  return JSON.stringify({
    messageId: message.id,
    sessionId: message.sessionId ?? null,
    conversationId: message.conversation.id,
    customerId: message.conversation.customerId,
    businessId: message.conversation.businessId ?? null,
    tenantId,
    direction: message.direction,
    contentKind: message.contentKind,
    body: message.body,
    replySource: message.direction === 'OUTBOUND' ? (replySource ?? 'UNKNOWN') : null,
    createdAt: message.createdAt.toISOString(),
    attachments: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      fetchState: attachment.fetchState,
      mimeType: attachment.mimeType ?? null,
      sizeBytes: attachment.sizeBytes ?? null,
      providerContentId: attachment.providerContentId ?? null,
    })),
  })
}

/**
 * Write one archive file for one Tenant's run. Creates the file under a
 * temporary name beside its final path, fsyncs it, renames it into place, then
 * reads the FINAL file back and compares its SHA-256 against what was written
 * — proof that what is on disk is what this run produced, not merely that the
 * write call returned. Never overwrites an existing file at the final path.
 *
 * @returns {Promise<{relativePath: string, fileSha256: string}>}
 */
async function writeArchiveFile({ baseDir, tenantId, runId, now, header, segments }) {
  const dir = path.join(baseDir, tenantId, String(now.getUTCFullYear()))
  if (!isPathInside(path.resolve(baseDir), path.resolve(dir))) throw new ChatEvidenceArchiveWriteError('ARCHIVE_PATH_ESCAPES_ROOT')
  await fs.mkdir(dir, { recursive: true })
  try {
    const rootRealPath = await fs.realpath(baseDir)
    const directoryRealPath = await fs.realpath(dir)
    if (!isPathInside(rootRealPath, directoryRealPath)) throw new ChatEvidenceArchiveWriteError('ARCHIVE_PATH_ESCAPES_ROOT')
  } catch (error) {
    if (error instanceof ChatEvidenceArchiveWriteError) throw error
    throw new ChatEvidenceArchiveWriteError('ARCHIVE_PATH_UNAVAILABLE', error)
  }
  const finalPath = path.join(dir, `${runId}.zca`)
  if (existsSync(finalPath)) throw new ChatEvidenceArchiveWriteError('ARCHIVE_FILE_ALREADY_EXISTS')

  const tempPath = path.join(dir, `.${runId}.zca.tmp-${randomBytes(4).toString('hex')}`)
  const lines = [JSON.stringify(header), ...segments.map((segment) => JSON.stringify(segment))]
  const content = `${lines.join('\n')}\n`
  const expectedSha256 = createHash('sha256').update(content, 'utf8').digest('hex')

  const handle = await fs.open(tempPath, 'wx')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    if (existsSync(finalPath)) throw new ChatEvidenceArchiveWriteError('ARCHIVE_FILE_ALREADY_EXISTS')
    await fs.rename(tempPath, finalPath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error instanceof ChatEvidenceArchiveWriteError ? error : new ChatEvidenceArchiveWriteError('ARCHIVE_FILE_RENAME_FAILED', error)
  }

  const readBack = await fs.readFile(finalPath)
  const actualSha256 = createHash('sha256').update(readBack).digest('hex')
  if (actualSha256 !== expectedSha256) throw new ChatEvidenceArchiveWriteError('ARCHIVE_FILE_VERIFICATION_FAILED')

  return { relativePath: path.relative(baseDir, finalPath).split(path.sep).join('/'), fileSha256: actualSha256 }
}

/**
 * Archive one Tenant's candidate messages and, only once that archive is
 * written and verified, tombstone exactly them — inside the same database
 * transaction that inserts the chained manifest row (ADR-093 D2). Throws on
 * any failure along the way (a bad KEK, a directory the process cannot write,
 * a hash mismatch, a database error) without touching a single Message or
 * MessageAttachment row; the caller decides what "the rest of the sweep keeps
 * going" means for its own run.
 *
 * @param {object} db - a Prisma client (or transaction proxy) whose
 *   `$transaction` method this function calls directly.
 * @param {{tenantId: string, candidates: object[], now: Date, env?: object,
 *   baseDir?: string, runId?: string}} input - `candidates` are `Message` rows
 *   selected with `conversation: { id, customerId, businessId }` and
 *   `attachments` included, exactly the shape `retention-sweep-service.js`'s
 *   candidate query produces. `runId` defaults to a fresh random id per call
 *   (production never passes one); accepting an override exists so a test can
 *   deterministically exercise the "never overwrite an existing file" guard.
 */
export async function archiveAndTombstoneTenantMessages(db, { tenantId, candidates, now, env = process.env, baseDir, runId: runIdOverride }) {
  if (!candidates || candidates.length === 0) {
    return { archived: false, manifest: null, redactedMessages: 0, redactedAttachments: 0 }
  }
  const resolvedBaseDir = baseDir ?? resolveArchiveBaseDir(env)
  await assertArchiveStorageReady(resolvedBaseDir, env)
  const runId = runIdOverride ?? buildRunId(now)
  const conversationIds = [...new Set(candidates.map((message) => message.conversation.id))]
  const replySourceByMessageId = await resolveReplySources(db, conversationIds)

  const byCustomer = new Map()
  for (const message of candidates) {
    const customerId = message.conversation.customerId
    if (!byCustomer.has(customerId)) byCustomer.set(customerId, [])
    byCustomer.get(customerId).push(message)
  }

  const segments = []
  for (const [customerId, messages] of byCustomer) {
    const dek = await getOrCreateCustomerArchiveKeyDek(db, { tenantId, customerId }, env, { baseDir: resolvedBaseDir })
    try {
      const lines = messages
        .map((message) => buildArchiveLine(message, { tenantId, replySource: replySourceByMessageId.get(message.id) }))
        .join('\n')
      const gzipped = gzipSync(Buffer.from(`${lines}\n`, 'utf8'))
      segments.push(sealArchiveSegment({ dek, tenantId, customerId, runId, plaintext: gzipped }))
    } finally {
      dek.fill(0)
    }
  }

  const header = { v: 1, tenantId, runId, kekId: resolveArchiveKeyring(env).current.label, createdAt: now.toISOString() }
  const { relativePath, fileSha256 } = await writeArchiveFile({ baseDir: resolvedBaseDir, tenantId, runId, now, header, segments })

  const messageIds = candidates.map((message) => message.id)
  const messageIdListHash = hashMessageIdList(messageIds)
  const previous = await db.archiveManifest.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
  const previousManifestHash = previous?.manifestHash ?? null
  const manifestHash = computeManifestHash({
    tenantId, runId, filePath: relativePath, fileSha256, messageCount: messageIds.length, messageIdListHash, previousManifestHash,
  })

  // Everything above this line either produced exactly what this transaction
  // needs or already threw. Nothing below can run without a written, verified
  // file and a computed chain hash — this is the fail-closed boundary D2
  // requires, made structural rather than conventional: the tombstone
  // updateMany calls are unreachable except from here.
  return db.$transaction(async (tx) => {
    const manifest = await tx.archiveManifest.create({
      data: { tenantId, runId, filePath: relativePath, fileSha256, messageCount: messageIds.length, messageIdListHash, previousManifestId: previous?.id ?? null, previousManifestHash, manifestHash },
    })
    const redacted = await tx.message.updateMany({
      where: { id: { in: messageIds } },
      data: { body: RETENTION_SWEEP_TOMBSTONE },
    })
    const redactedAttachments = await tx.messageAttachment.updateMany({
      where: { messageId: { in: messageIds }, fetchState: { not: 'ERASED' } },
      data: { fetchState: 'ERASED', providerContentId: null },
    })
    return { archived: true, manifest, redactedMessages: redacted.count, redactedAttachments: redactedAttachments.count, messageIds }
  })
}

// @req SEC-034 — key destruction and the legal hold (ADR-093 D5, D6; TASK-ZAI-113).
// -------------------------------------------------------------------------------
// `destroyCustomerArchiveKey` is the ONLY function in this codebase that may delete
// a `CustomerArchiveKey` row, and the legal-hold check lives INSIDE it rather than at
// each call site. Both callers that can end a Customer's chat evidence archive key —
// `erase-principal.js`'s PDPA erasure and `chat-evidence-archive-expiry-service.js`'s
// 10-year expiry — go through this one function, so there is exactly one place that
// answers "may this key be destroyed right now?" and no way to destroy a key by
// re-deriving that answer slightly differently at a second call site. A sibling task
// built the same week shipped with two independently-maintained "is this readable"
// checks that drifted apart; this is the structural fix for that failure mode here.
//
// Hard delete, not tombstone-and-clear. The row's only reason to exist is to open
// this Customer's archived lines: once it may never do that again, a cleared row
// (kekId/wrappedDek nulled, a destroyedAt column) would carry no information a
// `recordAudit` call at the call site doesn't already record more precisely (who,
// when, why), while still naming a real Customer id next to a "this used to be a
// live key" fact forever — a PII-adjacent shape with no reader. `MfaFactor` keeps its
// REVOKED rows because a Person's factor history is itself useful (which factors did
// they ever have, when), and a revoked factor can be re-enrolled; a destroyed archive
// key has no re-enrolment and nothing analogous to show. Hard delete also matches
// the design intent this table's own schema comment already states: "a future
// PDPA-erasure writer destroys exactly one row... to make every line that Customer
// ever had archived... permanently unreadable."

const CUSTOMER_TRANSACTION_OPTIONS = Object.freeze({ maxWait: 10_000, timeout: 30_000 })

function detectCrmDialect(db, explicitDialect = null) {
  const provider = explicitDialect
    || db?.dialect
    || db?.provider
    || db?._activeProvider
    || db?._engineConfig?.activeProvider
    || db?._engineConfig?.datasources?.[0]?.activeProvider
    || db?._engineConfig?.datasources?.[0]?.provider
  if (typeof provider !== 'string') return null
  if (/postgres/i.test(provider)) return 'postgres'
  if (/sqlite/i.test(provider)) return 'sqlite'
  return null
}

function customerNotFound() {
  const error = new Error('CUSTOMER_NOT_FOUND')
  error.status = 404
  return error
}

async function queryRaw(tx, sql, params = []) {
  if (typeof tx.$queryRawUnsafe === 'function') return tx.$queryRawUnsafe(sql, ...params)
  throw new ChatEvidenceArchiveTransactionError('ARCHIVE_CUSTOMER_LOCK_UNAVAILABLE')
}

/**
 * Lock one tenant-bound Customer before a hold or archive-key decision. The
 * lock is the shared linearization point for both operations:
 * `recordCustomerLegalHold` uses the root client's transaction path, while
 * Identity erasure supplies its already-open transaction client. Never accept
 * a caller-provided hold result as a substitute for this check.
 *
 * PostgreSQL uses the exact row lock required by SEC-034. SQLite relies on the
 * existing Prisma write-transaction serialization path and performs the same
 * tenant-bound existence check without sending PostgreSQL syntax to SQLite.
 * An adapter must identify its provider and expose a transaction boundary;
 * silently running the mutation on an unscoped client would make the lock
 * claim false.
 */
export async function withLockedCustomer(db, {
  tenantId, customerId, now = new Date(), dialect = null,
}, callback, { transactionClient = false } = {}) {
  if (typeof callback !== 'function') throw new TypeError('withLockedCustomer callback is required')
  if (typeof tenantId !== 'string' || !tenantId || typeof customerId !== 'string' || !customerId) {
    throw new ChatEvidenceArchiveTransactionError('ARCHIVE_CUSTOMER_SCOPE_REQUIRED')
  }

  const provider = detectCrmDialect(db, dialect)
  if (!provider) throw new ChatEvidenceArchiveTransactionError('ARCHIVE_CUSTOMER_PROVIDER_UNAVAILABLE')

  const execute = async (tx) => {
    let customer
    if (provider === 'postgres') {
      const rows = await queryRaw(
        tx,
        'SELECT "id" FROM "Customer" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
        [customerId, tenantId],
      )
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== customerId) throw customerNotFound()
      // FOR UPDATE alone does not refresh a pre-existing Serializable
      // snapshot. Both writers mark the row's MVCC version so a stale waiter
      // aborts before reading an obsolete hold set. Logical fields stay equal.
      const marked = await queryRaw(
        tx,
        'UPDATE "Customer" SET "id" = "id" WHERE "id" = $1 AND "tenantId" = $2 RETURNING "id"',
        [customerId, tenantId],
      )
      if (!Array.isArray(marked) || marked.length !== 1 || marked[0]?.id !== customerId) throw customerNotFound()
      customer = { id: rows[0].id, tenantId }
    } else {
      if (typeof tx.customer?.findMany !== 'function') {
        throw new ChatEvidenceArchiveTransactionError('ARCHIVE_CUSTOMER_LOCK_UNAVAILABLE')
      }
      const rows = await tx.customer.findMany({
        where: { id: customerId, tenantId },
        select: { id: true, tenantId: true },
      })
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== customerId || rows[0]?.tenantId !== tenantId) {
        throw customerNotFound()
      }
      customer = rows[0]
    }
    return callback(tx, { customer, now })
  }

  const canUseSuppliedTransaction = transactionClient
    || (typeof db?.$transaction !== 'function'
      && (typeof db?._activeProvider === 'string' || typeof db?._engineConfig?.activeProvider === 'string'))
  if (!canUseSuppliedTransaction && typeof db?.$transaction !== 'function') {
    throw new ChatEvidenceArchiveTransactionError('ARCHIVE_CUSTOMER_TRANSACTION_UNAVAILABLE')
  }
  try {
    return await (canUseSuppliedTransaction ? execute(db) : db.$transaction(execute, CUSTOMER_TRANSACTION_OPTIONS))
  } catch (error) {
    const conflictCodes = ['P2034', '40001', '40P01', 'SQLITE_BUSY', 'SQLITE_LOCKED']
    if (conflictCodes.includes(error?.code) || conflictCodes.includes(error?.meta?.code)) {
      throw new ChatEvidenceArchiveTransactionError('ARCHIVE_CUSTOMER_LOCK_UNAVAILABLE', error)
    }
    throw error
  }
}

/**
 * The Customer's current legal hold, if one is still unexpired. "Active" is
 * derived — `now < endDate` — never a stored status, so ending a hold means
 * only letting its endDate pass; there is no code path that edits one in place.
 * A Customer may have more than one hold on file (sequential disputes); the one
 * with the furthest-out endDate is what "does a hold still cover this Customer"
 * needs, so that is what is returned when more than one is still active.
 */
export async function findActiveLegalHold(db, { customerId }, now = new Date()) {
  return db.customerLegalHold.findFirst({
    where: { customerId, endDate: { gt: now } },
    orderBy: { endDate: 'desc' },
  })
}

/**
 * Destroy one Customer's chat evidence archive key (SEC-034, ADR-093 D5, D6) —
 * unless an active legal hold protects it, in which case nothing is touched and
 * the hold is returned so the caller can report it (ADR-093 D6: "the erasure
 * status shows the hold"). A Customer with no key row at all (never archived, or
 * already destroyed) is reported as `destroyed: false, hold: null` — indistinguishable
 * from "nothing to do" on purpose, since re-destroying an absent key is not a
 * failure for either caller.
 *
 * Callers are responsible for their own audit event: this function's job is the
 * one mechanical, hold-gated destruction, not deciding what each caller's audit
 * trail should say about it (the same division `archiveAndTombstoneTenantMessages`
 * above keeps from its own caller).
 *
 * @param {object} db - a Prisma client or transaction proxy.
 * @param {{tenantId: string, customerId: string, now?: Date}} input
 * @returns {Promise<{destroyed: boolean, hold: object|null}>}
 */
export async function destroyCustomerArchiveKey(db, { tenantId, customerId, now = new Date() }) {
  return withLockedCustomer(db, { tenantId, customerId, now }, async (tx) => {
    const hold = await findActiveLegalHold(tx, { customerId }, now)
    if (hold) return { destroyed: false, hold }

    const existing = await tx.customerArchiveKey.findUnique({ where: { customerId } })
    if (!existing || existing.tenantId !== tenantId) return { destroyed: false, hold: null }

    await tx.customerArchiveKey.delete({ where: { customerId } })
    return { destroyed: true, hold: null }
  })
}
