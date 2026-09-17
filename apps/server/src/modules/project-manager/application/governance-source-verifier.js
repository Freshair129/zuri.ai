import { createHash, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { anchor, canonicalStatement, splitRow, statementDigest } from '../../../../scripts/id-anchors.mjs'

// @req FR-252 — only a server-local, operator-bound Git verifier may produce
// the immutable provenance used by a GovernanceSnapshot or a Feature binding.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/unit/governance-source-verifier.test.js, tests/integration/governance-snapshot-capture.test.js

const execFile = promisify(execFileCallback)

export const SOURCE_MANIFEST_SCHEMA_VERSION = '1.0.0'
export const VERIFIER_ID = 'zuri.git-registry'
export const VERIFIER_VERSION = '1.0.0'
export const ZAI_SOURCE_NAMESPACE = 'ZAI'
export const REQUIRED_SOURCE_PATHS = Object.freeze([
  'docs/PRD-SDD-v1.0.md',
  'docs/FEATURES.md',
])

export const MAX_MANIFEST_BYTES = 1024 * 1024
export const MAX_MANIFEST_ENTRIES = 1000
export const MAX_REGISTRY_BINDINGS = 200
export const MAX_BLOB_BYTES = 8 * 1024 * 1024
export const MAX_INSPECTED_BYTES = 32 * 1024 * 1024
export const GIT_COMMAND_TIMEOUT_MS = 5000
export const GIT_VERIFICATION_TIMEOUT_MS = 20_000

const COMMIT_SHA_RE = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const SHA256_RE = /^[0-9a-f]{64}$/
const FR_KEY_RE = /^FR-[0-9]{3}$/
const FEAT_KEY_RE = /^FEAT-[0-9]{3}$/
const REGISTRY_MAX_BYTES = 1024 * 1024

const zUuid = z.string().uuid()
const zIsoDate = z.string().datetime({ offset: true })
const zSha256 = z.string().regex(SHA256_RE)
const zCommitSha = z.string().regex(COMMIT_SHA_RE)

function validRepositoryPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  if (/[/\\]$/.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) return false
  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return false
  return path.posix.normalize(value) === value
}

const zSourceManifestPath = z.string().min(1).max(512).refine(validRepositoryPath, {
  message: 'Repository path is not a canonical relative POSIX path.',
})

export const zSourceManifestEntry = z.object({
  path: zSourceManifestPath,
  sha256: zSha256,
}).strict()

export const zSourceManifest = z.object({
  schemaVersion: z.literal(SOURCE_MANIFEST_SCHEMA_VERSION),
  entries: z.array(zSourceManifestEntry).max(MAX_MANIFEST_ENTRIES),
}).strict().superRefine((value, ctx) => {
  const manifestBytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (manifestBytes > MAX_MANIFEST_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entries'], message: 'Manifest exceeds the maximum byte length.' })
  }
  const paths = new Set()
  for (const [index, entry] of value.entries.entries()) {
    if (paths.has(entry.path)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entries', index, 'path'], message: 'Manifest paths must be unique.' })
    }
    paths.add(entry.path)
  }
})

export const zCaptureSnapshotInput = z.object({
  repositoryId: zUuid,
  commitSha: zCommitSha,
  manifestHash: zSha256,
  sourceManifest: zSourceManifest,
}).strict()

const zAbsoluteCheckoutRoot = z.string().min(1).max(4096).refine((value) => path.isAbsolute(value), {
  message: 'Checkout root must be absolute.',
})

export const zCheckoutBinding = z.object({
  checkoutBindingId: z.string().min(1).max(256),
  repositoryId: zUuid,
  absoluteCheckoutRoot: zAbsoluteCheckoutRoot,
}).strict()

export const zCheckoutRegistry = z.object({
  schemaVersion: z.literal(SOURCE_MANIFEST_SCHEMA_VERSION),
  bindings: z.array(zCheckoutBinding).max(MAX_REGISTRY_BINDINGS),
}).strict().superRefine((value, ctx) => {
  const ids = new Set()
  for (const [index, binding] of value.bindings.entries()) {
    if (ids.has(binding.checkoutBindingId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bindings', index, 'checkoutBindingId'], message: 'Checkout binding ids must be unique.' })
    }
    ids.add(binding.checkoutBindingId)
  }
})

export const zGovernanceVerificationProof = z.object({
  proofId: zUuid,
  verifierId: z.string().min(1).max(128),
  verifierVersion: z.string().min(1).max(64),
  verifiedAt: zIsoDate,
  projectId: zUuid,
  projectRepositoryId: zUuid,
  checkoutBindingId: z.string().min(1).max(256),
  repositoryId: zUuid,
  commitSha: zCommitSha,
  manifestHash: zSha256,
  outcome: z.literal('VALID'),
}).strict()

export const zGovernanceSnapshot = z.object({
  id: zUuid,
  tenantId: zUuid,
  businessId: zUuid,
  createdAt: zIsoDate,
  repositoryId: zUuid,
  projectRepositoryId: zUuid,
  checkoutBindingId: z.string().min(1).max(256),
  commitSha: zCommitSha,
  manifestHash: zSha256,
  capturedAt: zIsoDate,
  verifiedAt: zIsoDate,
  verifierId: z.string().min(1).max(128),
  verifierVersion: z.string().min(1).max(64),
  proofId: zUuid,
  verificationProof: zGovernanceVerificationProof,
  validationStatus: z.literal('VALID'),
  sourceManifest: zSourceManifest,
}).strict()

function storedJson(value, reason) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw invalid(reason)
  }
}

function storedIsoDate(value, reason) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw invalid(reason)
  return date.toISOString()
}

export function toGovernanceSnapshotDto(row) {
  try {
    return zGovernanceSnapshot.parse({
      id: row?.id,
      tenantId: row?.tenantId,
      businessId: row?.businessId,
      createdAt: storedIsoDate(row?.createdAt, 'stored-created-at'),
      repositoryId: row?.repositoryId,
      projectRepositoryId: row?.projectRepositoryId,
      checkoutBindingId: row?.checkoutBindingId,
      commitSha: row?.commitSha,
      manifestHash: row?.manifestHash,
      capturedAt: storedIsoDate(row?.capturedAt, 'stored-captured-at'),
      verifiedAt: storedIsoDate(row?.verifiedAt, 'stored-verified-at'),
      verifierId: row?.verifierId,
      verifierVersion: row?.verifierVersion,
      proofId: row?.proofId,
      verificationProof: storedJson(row?.verificationProof, 'stored-proof-json'),
      validationStatus: row?.validationStatus,
      sourceManifest: storedJson(row?.sourceManifest, 'stored-manifest-json'),
    })
  } catch (error) {
    if (error instanceof GovernanceSourceVerificationError) throw error
    throw invalid('stored-snapshot-shape')
  }
}

export class GovernanceSourceVerificationError extends Error {
  constructor(code, status, retryable, reason) {
    super(code)
    this.name = 'GovernanceSourceVerificationError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.reason = reason
  }
}

function invalid(reason) {
  return new GovernanceSourceVerificationError('SNAPSHOT_INVALID', 422, false, reason)
}

function unavailable(reason) {
  return new GovernanceSourceVerificationError('DATA_INTEGRITY_UNAVAILABLE', 503, true, reason)
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_RE.test(value)
}

function isCommitSha(value) {
  return typeof value === 'string' && COMMIT_SHA_RE.test(value)
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function compareOrdinal(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function parseManifest(value) {
  try {
    return zSourceManifest.parse(value)
  } catch {
    throw invalid('manifest-schema')
  }
}

export function normalizeSourceManifest(value, { manifestHash = null } = {}) {
  const parsed = parseManifest(value)
  const entries = [...parsed.entries]
    .sort((left, right) => compareOrdinal(left.path, right.path))
    .map(({ path: entryPath, sha256 }) => ({ path: entryPath, sha256 }))
  const normalized = { schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION, entries }
  const bytes = Buffer.from(JSON.stringify(normalized), 'utf8')
  if (bytes.length > MAX_MANIFEST_BYTES) throw invalid('manifest-too-large')
  const digest = sha256Bytes(bytes)
  if (manifestHash !== null && manifestHash !== digest) throw invalid('manifest-digest-mismatch')
  return { manifest: normalized, bytes, manifestHash: digest }
}

export function canonicalSourceManifestBytes(value) {
  return normalizeSourceManifest(value).bytes
}

export function computeSourceManifestHash(value) {
  return normalizeSourceManifest(value).manifestHash
}

function decodeUtf8(bytes, reason) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  const text = buffer.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(buffer)) throw invalid(reason)
  return text
}

function normalizeRootForComparison(value) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '') || path.parse(path.resolve(value)).root
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function gitEnvironment() {
  const safe = {}
  for (const key of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'WINDIR', 'TMP', 'TEMP']) {
    if (process.env[key]) safe[key] = process.env[key]
  }
  safe.GIT_CONFIG_NOSYSTEM = '1'
  safe.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
  safe.GIT_CONFIG_SYSTEM = process.platform === 'win32' ? 'NUL' : '/dev/null'
  safe.GIT_TERMINAL_PROMPT = '0'
  safe.GIT_OPTIONAL_LOCKS = '0'
  safe.GIT_NO_REPLACE_OBJECTS = '1'
  return safe
}

async function runGitCommand(args, {
  cwd,
  maxBuffer = 8 * 1024 * 1024,
  timeoutMs = GIT_COMMAND_TIMEOUT_MS,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw unavailable('verification-timeout')
  try {
    const result = await execFile('git', args, {
      cwd,
      env: gitEnvironment(),
      shell: false,
      windowsHide: true,
      timeout: Math.max(1, Math.min(GIT_COMMAND_TIMEOUT_MS, timeoutMs)),
      maxBuffer,
      encoding: null,
    })
    return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '')
  } catch {
    throw unavailable('git-command-failed')
  }
}

function outputBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value && Buffer.isBuffer(value.stdout)) return value.stdout
  if (value && typeof value.stdout === 'string') return Buffer.from(value.stdout, 'utf8')
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  return Buffer.alloc(0)
}

async function invokeGit(gitRunner, args, options) {
  try {
    const output = await (gitRunner || runGitCommand)(args, options)
    return outputBuffer(output)
  } catch (error) {
    if (error instanceof GovernanceSourceVerificationError) throw error
    throw unavailable('git-command-failed')
  }
}

async function gitText(gitRunner, args, options, reason) {
  const text = decodeUtf8(await invokeGit(gitRunner, args, options), reason).replace(/\r\n/g, '\n')
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

async function loadRegistry(env) {
  const registryPath = env?.ZURI_PM_CHECKOUT_REGISTRY_PATH
  if (typeof registryPath !== 'string' || !path.isAbsolute(registryPath)) throw unavailable('registry-path-unavailable')
  let bytes
  try {
    bytes = await readFile(registryPath)
  } catch {
    throw unavailable('registry-unavailable')
  }
  if (bytes.length > REGISTRY_MAX_BYTES) throw unavailable('registry-too-large')
  let value
  try {
    value = JSON.parse(decodeUtf8(bytes, 'registry-encoding'))
  } catch (error) {
    if (error instanceof GovernanceSourceVerificationError) throw unavailable('registry-encoding')
    throw unavailable('registry-json')
  }
  try {
    return zCheckoutRegistry.parse(value)
  } catch {
    throw unavailable('registry-schema')
  }
}

function remainingOrRefuse(deadline) {
  if (deadline === null || deadline === undefined) return GIT_COMMAND_TIMEOUT_MS
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw unavailable('verification-timeout')
  return remaining
}

async function verifyCheckoutRoot(root, gitRunner, deadline = null) {
  let resolved
  try {
    resolved = await realpath(root)
    const info = await stat(resolved)
    if (!info.isDirectory()) throw unavailable('checkout-not-directory')
  } catch (error) {
    if (error instanceof GovernanceSourceVerificationError) throw error
    throw unavailable('checkout-unavailable')
  }
  const topLevelText = await gitText(
    gitRunner,
    ['rev-parse', '--show-toplevel'],
    { cwd: resolved, timeoutMs: remainingOrRefuse(deadline) },
    'git-path-encoding',
  )
  if (!topLevelText) throw unavailable('git-root-unavailable')
  let topLevel
  try {
    topLevel = await realpath(topLevelText)
  } catch {
    throw unavailable('git-root-unavailable')
  }
  if (normalizeRootForComparison(topLevel) !== normalizeRootForComparison(resolved)) {
    throw unavailable('git-root-mismatch')
  }
  return resolved
}

async function resolveCheckoutBinding({ repositoryId, checkoutBindingId = null, env, gitRunner, deadline = null }) {
  const registry = await loadRegistry(env)
  const matches = registry.bindings.filter((binding) => (
    binding.repositoryId === repositoryId
      && (checkoutBindingId === null || binding.checkoutBindingId === checkoutBindingId)
  ))
  if (matches.length !== 1) throw unavailable(checkoutBindingId === null ? 'registry-binding-cardinality' : 'historic-binding-unavailable')
  const binding = matches[0]
  const absoluteCheckoutRoot = await verifyCheckoutRoot(binding.absoluteCheckoutRoot, gitRunner, deadline)
  return { ...binding, absoluteCheckoutRoot }
}

async function verifyCommit(gitRunner, checkoutRoot, commitSha, remainingMs = () => GIT_COMMAND_TIMEOUT_MS) {
  if (!isCommitSha(commitSha)) throw invalid('commit-sha')
  const resolved = await gitText(
    gitRunner,
    ['rev-parse', '--verify', '--end-of-options', `${commitSha}^{commit}`],
    { cwd: checkoutRoot, timeoutMs: remainingMs() },
    'commit-encoding',
  )
  if (resolved !== commitSha) throw invalid('commit-alias-or-object-mismatch')
}

function parseTreeListing(bytes, requestedPath) {
  const text = decodeUtf8(bytes, 'tree-encoding')
  const records = text.split('\0').filter(Boolean)
  if (records.length !== 1) throw invalid('tree-path-cardinality')
  const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]+)\t([\s\S]*)$/.exec(records[0])
  if (!match || match[4] !== requestedPath) throw invalid('tree-path-mismatch')
  if (match[1] !== '100644' && match[1] !== '100755') throw invalid('non-regular-git-object')
  if (match[2] !== 'blob') throw invalid('non-blob-git-object')
}

async function readBlob(gitRunner, checkoutRoot, commitSha, entryPath, remainingMs = () => GIT_COMMAND_TIMEOUT_MS) {
  const listing = await invokeGit(
    gitRunner,
    ['ls-tree', '-z', '-r', '--full-tree', commitSha, '--', `:(literal)${entryPath}`],
    { cwd: checkoutRoot, maxBuffer: MAX_BLOB_BYTES, timeoutMs: remainingMs() },
  )
  parseTreeListing(listing, entryPath)
  const bytes = await invokeGit(
    gitRunner,
    ['cat-file', 'blob', `${commitSha}:${entryPath}`],
    { cwd: checkoutRoot, maxBuffer: MAX_BLOB_BYTES, timeoutMs: remainingMs() },
  )
  if (bytes.length > MAX_BLOB_BYTES) throw invalid('blob-too-large')
  return bytes
}

async function verifyManifestAgainstCommit({ binding, commitSha, manifest, manifestHash, gitRunner, deadline = null }) {
  const normalized = normalizeSourceManifest(manifest, { manifestHash })
  const verificationDeadline = deadline ?? (Date.now() + GIT_VERIFICATION_TIMEOUT_MS)
  const remainingMs = () => remainingOrRefuse(verificationDeadline)
  await verifyCommit(gitRunner, binding.absoluteCheckoutRoot, commitSha, remainingMs)
  const blobs = new Map()
  let inspectedBytes = 0
  for (const entry of normalized.manifest.entries) {
    const bytes = await readBlob(gitRunner, binding.absoluteCheckoutRoot, commitSha, entry.path, remainingMs)
    remainingOrRefuse(verificationDeadline)
    inspectedBytes += bytes.length
    if (inspectedBytes > MAX_INSPECTED_BYTES) throw invalid('inspection-limit')
    if (sha256Bytes(bytes) !== entry.sha256) throw invalid('blob-digest-mismatch')
    blobs.set(entry.path, bytes)
  }
  for (const requiredPath of REQUIRED_SOURCE_PATHS) {
    if (!blobs.has(requiredPath)) throw invalid('required-source-path-missing')
  }
  remainingOrRefuse(verificationDeadline)
  return { ...normalized, blobs, checkoutBindingId: binding.checkoutBindingId }
}

export async function verifyGovernanceSnapshotIntent({
  projectId,
  scope,
  repository,
  projectRepository,
  input,
  env = process.env,
  gitRunner = null,
  now = new Date(),
}) {
  const parsed = zCaptureSnapshotInput.safeParse(input)
  if (!parsed.success) throw invalid('capture-input-schema')
  const command = normalizeSourceManifest(parsed.data.sourceManifest, { manifestHash: parsed.data.manifestHash })
  if (!zUuid.safeParse(projectId).success
    || !zUuid.safeParse(scope?.tenantId).success
    || !zUuid.safeParse(scope?.businessId).success
    || !zUuid.safeParse(scope?.project?.id).success
    || !zUuid.safeParse(repository?.id).success
    || !zUuid.safeParse(projectRepository?.id).success
    || !scope?.project?.id || scope.project.id !== projectId
    || scope.businessId !== repository?.businessId
    || scope.businessId !== projectRepository?.repo?.businessId
    || repository?.id !== parsed.data.repositoryId
    || repository?.status !== 'ACTIVE'
    || projectRepository?.projectId !== projectId
    || projectRepository?.repoId !== parsed.data.repositoryId
    || projectRepository?.repo?.status !== 'ACTIVE'
    || projectRepository?.repo?.id !== parsed.data.repositoryId) {
    throw invalid('project-repository-scope')
  }
  const deadline = Date.now() + GIT_VERIFICATION_TIMEOUT_MS
  const binding = await resolveCheckoutBinding({ repositoryId: repository.id, env, gitRunner, deadline })
  await verifyManifestAgainstCommit({
    binding,
    commitSha: parsed.data.commitSha,
    manifest: command.manifest,
    manifestHash: command.manifestHash,
    gitRunner,
    deadline,
  })
  const verifiedAt = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(verifiedAt.getTime())) throw invalid('verification-clock')
  const proof = zGovernanceVerificationProof.parse({
    proofId: randomUUID(),
    verifierId: VERIFIER_ID,
    verifierVersion: VERIFIER_VERSION,
    verifiedAt: verifiedAt.toISOString(),
    projectId,
    projectRepositoryId: projectRepository.id,
    checkoutBindingId: binding.checkoutBindingId,
    repositoryId: repository.id,
    commitSha: parsed.data.commitSha,
    manifestHash: command.manifestHash,
    outcome: 'VALID',
  })
  return {
    proof,
    manifest: command.manifest,
    manifestHash: command.manifestHash,
    commitSha: parsed.data.commitSha,
    checkoutBindingId: binding.checkoutBindingId,
    validationStatus: 'VALID',
  }
}

function decodeRegistryDocument(bytes, reason) {
  return decodeUtf8(bytes, reason).replace(/\r\n/g, '\n')
}

function parsePrdRegistry(text) {
  const rows = new Map()
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = splitRow(line)
    const id = cells[1]
    if (!FR_KEY_RE.test(id || '')) continue
    const statement = (cells[2] || '').replace(/\s+/g, ' ').trim()
    const canonical = canonicalStatement(statement)
    if (!statement || !canonical || cells.length < 4 || cells[0] !== '' || cells[cells.length - 1] !== '' || rows.has(id)) throw invalid('prd-row-invalid')
    rows.set(id, {
      id,
      statement,
      canonicalSubject: canonical,
      revisionHash: statementDigest(statement),
      sourcePath: REQUIRED_SOURCE_PATHS[0],
    })
  }
  return rows
}

function parseFeaturesRegistry(text) {
  const rows = new Map()
  const memberships = new Map()
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = splitRow(line)
    const id = cells[1]
    if (!FEAT_KEY_RE.test(id || '')) continue
    const statement = (cells[2] || '').replace(/\s+/g, ' ').trim()
    const canonical = canonicalStatement(statement)
    const references = (cells[3] || '').trim()
    const keys = references ? references.split(',').map((value) => value.trim()) : []
    if (!statement || !canonical || cells.length < 5 || cells[0] !== '' || cells[cells.length - 1] !== '' || keys.length === 0 || keys.some((key) => !FR_KEY_RE.test(key))) throw invalid('features-row-invalid')
    if (new Set(keys).size !== keys.length || rows.has(id)) throw invalid('features-row-duplicate')
    const row = {
      id,
      statement,
      canonicalSubject: canonical,
      revisionHash: statementDigest(statement),
      requirementKeys: keys,
      sourcePath: REQUIRED_SOURCE_PATHS[1],
    }
    rows.set(id, row)
    for (const key of keys) memberships.set(key, [...(memberships.get(key) || []), id])
  }
  return { rows, memberships }
}

function parseZaiRegistry(blobs) {
  return {
    requirements: parsePrdRegistry(decodeRegistryDocument(blobs.get(REQUIRED_SOURCE_PATHS[0]), 'prd-encoding')),
    features: parseFeaturesRegistry(decodeRegistryDocument(blobs.get(REQUIRED_SOURCE_PATHS[1]), 'features-encoding')),
  }
}

function unavailableFeature(canonicalFeatureKey) {
  return { state: 'UNAVAILABLE', canonicalFeatureKey, canonicalSubject: null, ref: null }
}

function unavailableRequirement({ sourceNamespace, requirementKey, revisionHash }) {
  return {
    state: 'UNAVAILABLE',
    sourceNamespace,
    requirementKey,
    revisionHash,
    canonicalSubject: null,
    ref: null,
  }
}

async function proveDatabaseBinding({ tx, scope, snapshot, projectRepository }) {
  if (!tx?.repository?.findMany || !tx?.projectRepository?.findMany || !scope?.project?.id) throw unavailable('database-binding-unavailable')
  if (!snapshot || snapshot.validationStatus !== 'VALID'
    || snapshot.tenantId !== scope.tenantId || snapshot.businessId !== scope.businessId
    || snapshot.projectRepositoryId !== projectRepository?.id
    || snapshot.repositoryId !== projectRepository?.repoId
    || projectRepository.projectId !== scope.project.id) throw invalid('snapshot-binding-invalid')
  const repositories = await tx.repository.findMany({
    where: { id: snapshot.repositoryId, businessId: scope.businessId, status: 'ACTIVE' },
    select: { id: true, businessId: true, status: true },
  })
  const links = await tx.projectRepository.findMany({
    where: { projectId: scope.project.id, repoId: snapshot.repositoryId },
    select: { id: true, projectId: true, repoId: true },
  })
  if (repositories.length !== 1 || links.length !== 1 || links[0].id !== snapshot.projectRepositoryId || links[0].id !== projectRepository.id) {
    throw invalid('database-binding-cardinality')
  }
  return { repository: repositories[0], projectRepository: links[0] }
}

async function materializeSnapshotEvidence({ tx, scope, snapshot, projectRepository, env, gitRunner }) {
  try {
    await proveDatabaseBinding({ tx, scope, snapshot, projectRepository })
    const typedSnapshot = toGovernanceSnapshotDto(snapshot)
    const proof = typedSnapshot.verificationProof
    if (typedSnapshot.verifierId !== VERIFIER_ID
      || typedSnapshot.verifierVersion !== VERIFIER_VERSION
      || proof.verifierId !== typedSnapshot.verifierId
      || proof.verifierVersion !== typedSnapshot.verifierVersion
      || proof.proofId !== typedSnapshot.proofId
      || proof.projectId !== scope.project.id
      || proof.projectRepositoryId !== typedSnapshot.projectRepositoryId
      || proof.repositoryId !== typedSnapshot.repositoryId
      || proof.checkoutBindingId !== typedSnapshot.checkoutBindingId
      || proof.commitSha !== typedSnapshot.commitSha
      || proof.manifestHash !== typedSnapshot.manifestHash
      || proof.outcome !== 'VALID'
      || new Date(proof.verifiedAt).getTime() !== new Date(typedSnapshot.verifiedAt).getTime()) {
      throw invalid('stored-proof-mismatch')
    }
    if (!isCommitSha(typedSnapshot.commitSha) || !isSha256(typedSnapshot.manifestHash)) throw invalid('stored-snapshot-identity')
    const normalized = normalizeSourceManifest(typedSnapshot.sourceManifest, { manifestHash: typedSnapshot.manifestHash })
    const deadline = Date.now() + GIT_VERIFICATION_TIMEOUT_MS
    const binding = await resolveCheckoutBinding({
      repositoryId: typedSnapshot.repositoryId,
      checkoutBindingId: typedSnapshot.checkoutBindingId,
      env,
      gitRunner,
      deadline,
    })
    const verified = await verifyManifestAgainstCommit({
      binding,
      commitSha: typedSnapshot.commitSha,
      manifest: normalized.manifest,
      manifestHash: normalized.manifestHash,
      gitRunner,
      deadline,
    })
    return { snapshot: typedSnapshot, binding, ...verified, registry: parseZaiRegistry(verified.blobs) }
  } catch {
    return null
  }
}

function positiveReference(row, key, commitSha) {
  return `${row.sourcePath}#${key}@${commitSha}`
}

function resolveFeatureKey(canonicalFeatureKey, registry) {
  if (FEAT_KEY_RE.test(canonicalFeatureKey || '')) {
    const row = registry.features.rows.get(canonicalFeatureKey)
    if (!row) return null
    if (row.requirementKeys.some((key) => !registry.requirements.has(key)
      || (registry.features.memberships.get(key) || []).length !== 1)) return null
    return { key: canonicalFeatureKey, row, allowedRequirements: new Set(row.requirementKeys) }
  }
  if (FR_KEY_RE.test(canonicalFeatureKey || '')) {
    const row = registry.requirements.get(canonicalFeatureKey)
    if (!row || (registry.features.memberships.get(canonicalFeatureKey) || []).length !== 0) return null
    return { key: canonicalFeatureKey, row, allowedRequirements: new Set([canonicalFeatureKey]) }
  }
  return null
}

export function createGovernanceEvidencePort({ env = process.env, gitRunner = null } = {}) {
  const evidenceCache = new Map()

  async function materializeCached(args, keyTuple) {
    const cacheKey = JSON.stringify(keyTuple)
    if (!evidenceCache.has(cacheKey)) {
      evidenceCache.set(cacheKey, materializeSnapshotEvidence(args))
    }
    return evidenceCache.get(cacheKey)
  }

  async function verifyFeatureKey({ tx, scope, snapshot, projectRepository, canonicalFeatureKey }) {
    const unavailableResult = unavailableFeature(canonicalFeatureKey)
    if (typeof canonicalFeatureKey !== 'string'
      || canonicalFeatureKey.length > 200
      || (!FR_KEY_RE.test(canonicalFeatureKey) && !FEAT_KEY_RE.test(canonicalFeatureKey))) return unavailableResult
    const evidence = await materializeCached(
      { tx, scope, snapshot, projectRepository, env, gitRunner },
      ['feature', scope?.tenantId, scope?.businessId, scope?.project?.id, projectRepository?.id,
        snapshot?.id, snapshot?.tenantId, snapshot?.businessId, snapshot?.repositoryId,
        snapshot?.projectRepositoryId, snapshot?.checkoutBindingId, snapshot?.commitSha, snapshot?.manifestHash,
        snapshot?.proofId, snapshot?.verifiedAt, snapshot?.verifierId, snapshot?.verifierVersion,
        snapshot?.verificationProof, snapshot?.sourceManifest,
        canonicalFeatureKey],
    )
    if (!evidence) return unavailableResult
    const resolved = resolveFeatureKey(canonicalFeatureKey, evidence.registry)
    if (!resolved) return unavailableResult
    return {
      state: 'AVAILABLE',
      canonicalFeatureKey,
      canonicalSubject: resolved.row.canonicalSubject,
      revisionHash: resolved.row.revisionHash,
      ref: positiveReference(resolved.row, canonicalFeatureKey, snapshot.commitSha),
    }
  }

  async function verifyRequirement({
    tx,
    scope,
    feature,
    snapshot,
    projectRepository,
    sourceNamespace,
    requirementKey,
    revisionHash,
  }) {
    const unavailableResult = unavailableRequirement({ sourceNamespace, requirementKey, revisionHash })
    if (sourceNamespace !== ZAI_SOURCE_NAMESPACE || !FR_KEY_RE.test(requirementKey || '') || !isSha256(revisionHash)) return unavailableResult
    const evidence = await materializeCached(
      { tx, scope, snapshot, projectRepository, env, gitRunner },
      ['requirement', scope?.tenantId, scope?.businessId, scope?.project?.id, projectRepository?.id,
        snapshot?.id, snapshot?.tenantId, snapshot?.businessId, snapshot?.repositoryId,
        snapshot?.projectRepositoryId, snapshot?.checkoutBindingId, snapshot?.commitSha, snapshot?.manifestHash,
        snapshot?.proofId, snapshot?.verifiedAt, snapshot?.verifierId, snapshot?.verifierVersion,
        snapshot?.verificationProof, snapshot?.sourceManifest,
        feature?.canonicalFeatureKey, sourceNamespace, requirementKey, revisionHash],
    )
    if (!evidence) return unavailableResult
    const resolvedFeature = resolveFeatureKey(feature?.canonicalFeatureKey, evidence.registry)
    const requirement = evidence.registry.requirements.get(requirementKey)
    if (!resolvedFeature || !requirement || !resolvedFeature.allowedRequirements.has(requirementKey) || requirement.revisionHash !== revisionHash) return unavailableResult
    return {
      state: 'AVAILABLE',
      sourceNamespace,
      requirementKey,
      revisionHash,
      canonicalSubject: requirement.canonicalSubject,
      canonicalFeatureKey: resolvedFeature.key,
      ref: positiveReference(requirement, requirementKey, snapshot.commitSha),
    }
  }

  return Object.freeze({ verifyFeatureKey, verifyRequirement })
}

export { anchor, canonicalStatement, splitRow, statementDigest }
