import { createHash, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { writeSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { anchor } from '../../scripts/id-anchors.mjs'
import { parseCanonicalRecord } from '../../scripts/document-registry-format.mjs'
import { authoredRecordMarkdown } from '../../../../tools/document-record-migration.mjs'
import { buildCanonicalIndex } from '../../../../tools/document-registry.mjs'
import {
  CANONICAL_INDEX_PATH, CANONICAL_SOURCE_MANIFEST_SCHEMA_VERSION,
  MAX_BLOB_BYTES, GIT_VERIFICATION_TIMEOUT_MS,
  createGovernanceEvidencePort, normalizeSourceManifest, statementDigest,
  verifyGovernanceSnapshotIntent,
} from '@/modules/project-manager/application/governance-source-verifier'

// @req FR-252
// @spec docs/migrations/document-reintegration/INTEGRATION.md
// @tested tests/unit/governance-canonical-source.test.js

const execFile = promisify(execFileCallback)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const syntheticFr = (number) => `FR-${String(number).padStart(3, '0')}`
const projectId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const businessId = '33333333-3333-4333-8333-333333333333'
const repositoryId = '44444444-4444-4444-8444-444444444444'
const projectRepositoryId = '55555555-5555-4555-8555-555555555555'
const repository = { id: repositoryId, businessId, status: 'ACTIVE' }
const projectRepository = { id: projectRepositoryId, projectId, repoId: repositoryId, repo: repository }
const scope = { project: { id: projectId }, tenantId, businessId }
const sourceRevision = 'a'.repeat(40)
const rootPaths = []
let fixture

function canonical(id, family, row, filePath, requirementCells = [], featureId) {
  const sourcePath = family === 'FEAT' ? 'docs/FEATURES.md' : 'docs/PRD-SDD-v1.0.md'
  const sourceRowSha256 = sha256(`${row}\n`)
  const text = [
    '---', `id: ${id}`, 'namespace: ZAI', `family: ${family}`, 'version: 1', 'status: source-preserved',
    `source_revision: ${sourceRevision}`, `source_path: ${sourcePath}`,
    `source_row_sha256: ${sourceRowSha256}`, 'source_row_eol: LF', 'statement_cell: 2',
    `requirement_cells: ${JSON.stringify(requirementCells)}`, ...(featureId ? [`feature_id: ${featureId}`] : []), '---', '', `# ${id}`, '',
    '<!-- canonical-row:start -->', '```text', row, '```', '<!-- canonical-row:end -->', '',
  ].join('\n')
  return { text, entry: { id, namespace: 'ZAI', family, recordVersion: 1, status: 'source-preserved', path: filePath, sourcePath,
    sourceRowSha256, recordSha256: sha256(text), statementCell: 2, requirementCells, ...(featureId ? { featureId } : {}),
    exportDocument: sourcePath, exportOrder: family === 'FEAT' ? 0 : 1 } }
}

const fr = canonical('FR-252', 'FR', '| FR-252 | **Bind** the canonical requirement. |', 'docs/requirements/FR-252.md', [], 'FEAT-001')
const feature = canonical('FEAT-001', 'FEAT', '| FEAT-001 | Feature one | FR-252 | live |', 'docs/features/FEAT-001/feature.md', [3])

async function git(args, cwd) {
  const { stdout } = await execFile('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd, shell: false, windowsHide: true,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout.trim()
}

function fixtureTrace(label = 'canonical-fixture') {
  const started = performance.now()
  return stage => {
    if (process.env.CI || process.env.CANONICAL_FIXTURE_TRACE === '1') {
      // Diagnostics must not interrupt fixture work or cleanup if stderr closes.
      try { writeSync(2, `[${label}] ${stage} elapsedMs=${Math.round(performance.now() - started)}\n`) } catch {}
    }
  }
}

async function makeFixture(transform = (value) => value, trace = () => {}) {
  trace('fixture-start')
  const root = await mkdtemp(path.join(os.tmpdir(), 'zuri-canonical-proof-'))
  rootPaths.push(root)
  trace(`directory-created-${rootPaths.length}`)
  await git(['init', '--quiet'], root)
  trace('git-init')
  await git(['config', 'user.name', 'Canonical fixture'], root)
  trace('git-config-name')
  await git(['config', 'user.email', 'fixture@example.test'], root)
  trace('git-config-email')
  const original = { index: { version: 1, sourceRevision, records: [fr.entry, feature.entry] },
    files: { [fr.entry.path]: fr.text, [feature.entry.path]: feature.text } }
  const { index, files } = transform(structuredClone(original))
  trace('records-ready')
  files[CANONICAL_INDEX_PATH] = JSON.stringify(index)
  let written = 0
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), content)
    if (++written % 32 === 0) trace(`files-written-${written}`)
  }
  trace('files-written')
  await git(['add', '--', '.'], root)
  trace('git-add')
  await git(['commit', '--quiet', '-m', 'canonical fixture'], root)
  trace('git-commit')
  const commitSha = await git(['rev-parse', 'HEAD'], root)
  trace('git-head')
  const normalized = normalizeSourceManifest({ schemaVersion: CANONICAL_SOURCE_MANIFEST_SCHEMA_VERSION,
    entries: Object.entries(files).map(([name, content]) => ({ path: name, sha256: sha256(content) })) })
  const registryPath = path.join(root, 'operator.json')
  await writeFile(registryPath, JSON.stringify({ schemaVersion: '1.0.0', bindings: [
    { checkoutBindingId: 'canonical-fixture', repositoryId, absoluteCheckoutRoot: root },
  ] }))
  trace('fixture-ready')
  return { root, commitSha, ...normalized, env: { ZURI_PM_CHECKOUT_REGISTRY_PATH: registryPath } }
}

async function makeAuthoredFixture(fault = null) {
  const approvalPath = 'docs/change-requests/fixture-approved.md'
  const approval = '---\nstatus: approved\nversion: "1.0.0"\n---\n# Receiver fixture\n'
  const base = await makeFixture(value => { value.files[approvalPath] = approval; value.files['docs/.id-ledger.json'] = '{}\n'; return value })
  const manifestPath = 'docs/migrations/document-reintegration/record-migrations/snapshot-fixture.manifest.json'
  const statement = 'Report credential isolation: a synthetic standalone machine permission.'
  const item = { id: syntheticFr(900), family: 'FR', statement, statementSha256: sha256(statement), subjectAnchor: anchor(statement) }
  const migration = { version: 1, migrationId: 'snapshot-fixture',
    base: { commit: base.commitSha, indexSha256: fault === 'forged-base' ? 'a'.repeat(64) : sha256(await readFile(path.join(base.root, CANONICAL_INDEX_PATH))), ledgerSha256: sha256('{}\n') },
    approval: { path: approvalPath, revision: fault === 'forged-origin' ? 'f'.repeat(40) : base.commitSha, version: '1.0.0', sha256: sha256(approval) }, records: [item] }
  const manifestText = `${JSON.stringify(migration, null, 2)}\n`
  let text = authoredRecordMarkdown(item, migration, manifestPath, sha256(manifestText))
  if (fault === 'unsupported-record') text = text.replace('version: 2', 'version: 3')
  if (fault === 'statement-hash') text = text.replace(`statement_sha256: ${item.statementSha256}`, `statement_sha256: ${'e'.repeat(64)}`)
  const parsed = parseCanonicalRecord(authoredRecordMarkdown(item, migration, manifestPath, sha256(manifestText)))
  const recordPath = `docs/requirements/${syntheticFr(900)}.md`
  const entry = buildCanonicalIndex([{ ...parsed, path: recordPath, recordSha256: sha256(text), exportDocument: 'docs/PRD-SDD-v1.0.md', exportOrder: 1 }]).records[0]
  if (fault === 'unsupported-record') entry.recordVersion = 3
  const index = JSON.parse(await readFile(path.join(base.root, CANONICAL_INDEX_PATH), 'utf8'))
  index.version = fault === 'unsupported-index' ? 3 : 2
  index.records.push(entry)
  const files = {
    [CANONICAL_INDEX_PATH]: JSON.stringify(index), [recordPath]: text,
    [manifestPath]: manifestText,
    [manifestPath.replace('.manifest.json', '.approval.md')]: fault === 'forged-approval' ? approval.replace('approved', 'draft') : approval,
  }
  if (fault === 'cache-forged-base' || fault === 'two-manifests') {
    const second = structuredClone(migration)
    second.migrationId = 'second-fixture'
    if (fault === 'cache-forged-base') second.base.ledgerSha256 = 'f'.repeat(64)
    const statement = 'Second report evidence: independently verified authored provenance.'
    const item = { id: syntheticFr(901), family: 'FR', statement, statementSha256: sha256(statement), subjectAnchor: anchor(statement) }
    second.records = [item]
    const secondPath = manifestPath.replace('snapshot-fixture', second.migrationId)
    const manifestText = `${JSON.stringify(second, null, 2)}\n`
    const text = authoredRecordMarkdown(item, second, secondPath, sha256(manifestText))
    const recordPath = `docs/requirements/${syntheticFr(901)}.md`
    const parsed = parseCanonicalRecord(text)
    index.records.push(buildCanonicalIndex([{ ...parsed, path: recordPath, recordSha256: sha256(text), exportDocument: 'docs/PRD-SDD-v1.0.md', exportOrder: 2 }]).records[0])
    files[CANONICAL_INDEX_PATH] = JSON.stringify(index)
    files[recordPath] = text
    files[secondPath] = manifestText
    files[secondPath.replace('.manifest.json', '.approval.md')] = approval
  }
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(base.root, file)), { recursive: true })
    await writeFile(path.join(base.root, file), content)
  }
  await git(['add', '--', '.'], base.root)
  await git(['commit', '--quiet', '-m', 'authored fixture'], base.root)
  const commitSha = await git(['rev-parse', 'HEAD'], base.root)
  const entries = base.manifest.entries.filter(entry => !Object.hasOwn(files, entry.path))
  entries.push(...Object.entries(files).map(([file, content]) => ({ path: file, sha256: sha256(content) })))
  return { ...base, commitSha, ...normalizeSourceManifest({ schemaVersion: CANONICAL_SOURCE_MANIFEST_SCHEMA_VERSION, entries }) }
}

async function withReviewedRecord(base, fault = null) {
  const document = 'docs/change-requests/reviewed-fixture.md'
  const approval = `---\nstatus: ${fault === 'draft' ? 'draft' : 'approved'}\n---\n\n${fault === 'no-approval' ? '# Details' : '## Approval'}\nOwner approved the reviewed addition.\n`
  let revision = base.commitSha
  if (fault === 'non-ancestor') {
    // A valid commit in the same object store which is not in this history.
    const tree = await git(['rev-parse', `${base.commitSha}^{tree}`], base.root)
    revision = await git(['commit-tree', tree, '-m', 'unrelated reviewed base'], base.root)
  }
  const record = canonical(syntheticFr(903), 'FR', `| ${syntheticFr(903)} | Reviewed standalone evidence. | approved |`, `docs/requirements/${syntheticFr(903)}.md`)
  record.text = record.text.replace('status: source-preserved', 'status: reviewed-migration')
    .replace(`source_revision: ${sourceRevision}`, `migration_base_revision: ${revision}\nmigration_document: ${document}`)
  record.entry = { ...record.entry, status: 'reviewed-migration', recordSha256: sha256(record.text),
    migrationBaseRevision: revision, migrationDocument: document }
  const index = JSON.parse(await readFile(path.join(base.root, CANONICAL_INDEX_PATH), 'utf8'))
  index.records.push(record.entry)
  const files = { [CANONICAL_INDEX_PATH]: JSON.stringify(index), [record.entry.path]: record.text, [document]: approval }
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(base.root, file)), { recursive: true })
    await writeFile(path.join(base.root, file), content)
  }
  await git(['add', '--', '.'], base.root)
  await git(['commit', '--quiet', '-m', 'reviewed fixture'], base.root)
  const entries = base.manifest.entries.filter(entry => !Object.hasOwn(files, entry.path))
  entries.push(...Object.entries(files).filter(([file]) => fault !== 'missing-approval' || file !== document)
    .map(([file, content]) => ({ path: file, sha256: sha256(content) })))
  return { ...base, commitSha: await git(['rev-parse', 'HEAD'], base.root),
    ...normalizeSourceManifest({ schemaVersion: CANONICAL_SOURCE_MANIFEST_SCHEMA_VERSION, entries }) }
}

function capture(value, sourceManifest = value.manifest) {
  return verifyGovernanceSnapshotIntent({ projectId, scope, repository, projectRepository,
    env: value.env, now: new Date('2026-09-29T00:00:00.000Z'),
    input: { repositoryId, commitSha: value.commitSha,
      manifestHash: normalizeSourceManifest(sourceManifest).manifestHash, sourceManifest } })
}

async function verificationGit(args, options) {
  const pending = execFile('git', args, {
    cwd: options.cwd, shell: false, windowsHide: true, encoding: null,
    timeout: Math.min(5000, options.timeoutMs), maxBuffer: options.maxBuffer,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' },
  })
  if (options.input !== undefined) {
    pending.child.stdin.once('error', () => {})
    pending.child.stdin.end(options.input)
  }
  return (await pending).stdout
}

async function replay(value, mutate = (snapshot) => snapshot) {
  const { proof } = await capture(value)
  const snapshot = mutate({ id: randomUUID(), tenantId, businessId,
    createdAt: proof.verifiedAt, capturedAt: proof.verifiedAt, verifiedAt: proof.verifiedAt,
    repositoryId, projectRepositoryId, checkoutBindingId: proof.checkoutBindingId,
    commitSha: value.commitSha, manifestHash: value.manifestHash,
    verifierId: proof.verifierId, verifierVersion: proof.verifierVersion,
    proofId: proof.proofId, verificationProof: proof, validationStatus: 'VALID', sourceManifest: value.manifest })
  const tx = { repository: { findMany: async () => [repository] },
    projectRepository: { findMany: async () => [projectRepository] } }
  return { tx, scope, snapshot, projectRepository }
}

beforeAll(async () => { fixture = await makeFixture() })
afterAll(async () => {
  const trace = fixtureTrace('canonical-cleanup')
  for (const [index, root] of rootPaths.entries()) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)
      || !path.basename(root).startsWith('zuri-canonical-proof-')) throw Error('Unsafe fixture cleanup path')
    trace(`fixture-${index + 1}-start`)
    await rm(root, { recursive: true, force: true })
    trace(`fixture-${index + 1}-complete`)
  }
})

describe('canonical source snapshot v2', () => {
  it('reads committed canonical blobs with a bounded number of Git processes', async () => {
    const calls = []
    const gitRunner = async (args, options) => {
      calls.push(args)
      return verificationGit(args, options)
    }
    const verified = await verifyGovernanceSnapshotIntent({ projectId, scope, repository, projectRepository,
      env: fixture.env, gitRunner,
      input: { repositoryId, commitSha: fixture.commitSha, manifestHash: fixture.manifestHash, sourceManifest: fixture.manifest } })
    expect(verified.validationStatus).toBe('VALID')
    expect(calls.filter(args => args[0] === 'ls-tree')).toHaveLength(1)
    expect(calls.filter(args => args[0] === 'cat-file' && args[1] === '--batch-check')).toHaveLength(1)
    expect(calls.filter(args => args[0] === 'cat-file' && args[1] === '--batch')).toHaveLength(1)
  })
  it.each([
    ['truncated', bytes => bytes.subarray(0, -1), 'blob-batch-framing'],
    ['extra output', bytes => Buffer.concat([bytes, Buffer.from('unrequested')]), 'blob-batch-framing'],
    ['wrong type', bytes => Buffer.from(bytes.toString().replace(' blob ', ' tree ')), 'blob-batch-object'],
    ['wrong object', bytes => { const out = Buffer.from(bytes); out[0] = out[0] === 97 ? 98 : 97; return out }, 'blob-batch-object'],
    ['oversized blob', bytes => Buffer.concat([Buffer.from(bytes.subarray(0, bytes.indexOf(10)).toString().replace(/ \d+$/, ` ${MAX_BLOB_BYTES + 1}`)), bytes.subarray(bytes.indexOf(10))]), 'blob-too-large'],
    ['corrupt content', bytes => { const out = Buffer.from(bytes); out[out.indexOf(10) + 1] ^= 1; return out }, 'blob-digest-mismatch'],
    ['high-bit header', bytes => { const out = Buffer.from(bytes); out[0] |= 128; return out }, 'blob-batch-object'],
    ['wrong metadata object', bytes => { const out = Buffer.from(bytes); out[0] = out[0] === 97 ? 98 : 97; return out }, 'blob-batch-object', '--batch-check'],
    ['truncated metadata', bytes => bytes.subarray(0, -1), 'blob-batch-framing', '--batch-check'],
    ['oversized metadata', bytes => Buffer.from(bytes.toString().replace(/ blob \d+/, ` blob ${MAX_BLOB_BYTES + 1}`)), 'blob-too-large', '--batch-check'],
  ])('rejects canonical Git batch protocol %s without issuing a proof', async (_name, mutate, reason, phase = '--batch') => {
    const gitRunner = async (args, options) => {
      const output = await verificationGit(args, options)
      return args[0] === 'cat-file' && args[1] === phase ? mutate(output) : output
    }
    await expect(verifyGovernanceSnapshotIntent({ projectId, scope, repository, projectRepository,
      env: fixture.env, gitRunner,
      input: { repositoryId, commitSha: fixture.commitSha, manifestHash: fixture.manifestHash, sourceManifest: fixture.manifest } }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_INVALID', reason })
  })
  it.each([
    ['symlink mode', text => text.replace(/^100644/, '120000'), 'non-regular-git-object'],
    ['non-blob object', text => text.replace(' blob ', ' tree '), 'non-blob-git-object'],
    ['wrong literal path', text => text.replace(/\t[^\0]+/, '\tdocs/unrequested.md'), 'tree-path-mismatch'],
  ])('rejects canonical tree %s before reading blob contents', async (_name, mutate, reason) => {
    const commands = []
    const gitRunner = async (args, options) => {
      commands.push(args[0])
      const output = await verificationGit(args, options)
      return args[0] === 'ls-tree' ? Buffer.from(mutate(output.toString('utf8'))) : output
    }
    await expect(verifyGovernanceSnapshotIntent({ projectId, scope, repository, projectRepository,
      env: fixture.env, gitRunner,
      input: { repositoryId, commitSha: fixture.commitSha, manifestHash: fixture.manifestHash, sourceManifest: fixture.manifest } }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_INVALID', reason })
    expect(commands).not.toContain('cat-file')
  })
  it('does not start a canonical blob batch after the shared verification deadline', async () => {
    let clock = Date.now()
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock), commands = []
    try {
      const gitRunner = async (args, options) => {
        commands.push(args[0])
        const output = await verificationGit(args, options)
        if (args[0] === 'ls-tree') clock += GIT_VERIFICATION_TIMEOUT_MS + 1
        return output
      }
      await expect(verifyGovernanceSnapshotIntent({ projectId, scope, repository, projectRepository,
        env: fixture.env, gitRunner,
        input: { repositoryId, commitSha: fixture.commitSha, manifestHash: fixture.manifestHash, sourceManifest: fixture.manifest } }))
        .rejects.toMatchObject({ code: 'DATA_INTEGRITY_UNAVAILABLE', reason: 'verification-timeout' })
      expect(commands).not.toContain('cat-file')
    } finally { now.mockRestore() }
  })
  it('retains the aggregate byte cap even if a Git adapter returns an oversized batch', async () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      path: index === 0 ? CANONICAL_INDEX_PATH : `docs/part-${index}.md`, sha256: 'a'.repeat(64),
    }))
    const objects = entries.map((_, index) => String(index + 1).padStart(40, '0'))
    const body = Buffer.alloc(6 * 1024 * 1024, 120)
    const normalized = normalizeSourceManifest({ schemaVersion: CANONICAL_SOURCE_MANIFEST_SCHEMA_VERSION, entries })
    const gitRunner = async (args, options) => {
      if (args[0] === 'ls-tree') return Buffer.from(entries.map((entry, index) => `100644 blob ${objects[index]}\t${entry.path}\0`).join(''))
      if (args[0] === 'cat-file') {
        const requested = options.input.toString('ascii').trim().split('\n')
        if (args[1] === '--batch-check') return Buffer.from(requested.map(object => `${object} blob ${body.length}\n`).join(''))
        return Buffer.concat(requested.flatMap(object => [Buffer.from(`${object} blob ${body.length}\n`), body, Buffer.from('\n')]))
      }
      return verificationGit(args, options)
    }
    await expect(verifyGovernanceSnapshotIntent({ projectId, scope, repository, projectRepository,
      env: fixture.env, gitRunner,
      input: { repositoryId, commitSha: fixture.commitSha, manifestHash: normalized.manifestHash, sourceManifest: normalized.manifest } }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_INVALID', reason: 'inspection-limit' })
  })
  it('rejects oversized native Git batches with the original aggregate inspection guard', async () => {
    const large = await makeFixture(value => {
      for (let index = 0; index < 6; index++) value.files[`fixtures/blob-${index}.bin`] = Buffer.alloc(6 * 1024 * 1024, index)
      return value
    })
    await expect(capture(large)).rejects.toMatchObject({ code: 'SNAPSHOT_INVALID', reason: 'inspection-limit' })
  })
  it('preserves historical full-index snapshots containing only FR/FEAT source blobs', async () => {
    const historical = await makeFixture(value => {
      const omitted = canonical('SDD-049', 'SDD', '| SDD-049 | Historical non-PM source. | planned |', 'docs/requirements/SDD-049.md')
      value.index.records.push(omitted.entry)
      return value
    })
    const { proof } = await capture(historical)
    expect(proof.verifierVersion).toBe('2.0.0')
    const port = createGovernanceEvidencePort({ env: historical.env })
    expect(await port.verifyFeatureKey({ ...await replay(historical), canonicalFeatureKey: 'FEAT-001' })).toMatchObject({ state: 'AVAILABLE' })
  })
  it('captures and replays imported v1, reviewed v1 and authored v2 together', async () => {
    const mixed = await withReviewedRecord(await makeAuthoredFixture())
    expect((await capture(mixed)).validationStatus).toBe('VALID')
    const args = await replay(mixed)
    const port = createGovernanceEvidencePort({ env: mixed.env })
    expect(await port.verifyFeatureKey({ ...args, canonicalFeatureKey: syntheticFr(903) })).toMatchObject({
      state: 'AVAILABLE', canonicalSubject: 'Reviewed standalone evidence.',
    })
    expect(await port.verifyFeatureKey({ ...args, canonicalFeatureKey: syntheticFr(900) })).toMatchObject({ state: 'AVAILABLE' })
  })

  it.each(['draft', 'no-approval', 'missing-approval', 'non-ancestor'])('refuses reviewed %s provenance', async fault => {
    const reviewed = await withReviewedRecord(await makeFixture(), fault)
    await expect(capture(reviewed)).rejects.toMatchObject({ code: 'SNAPSHOT_INVALID' })
  })
  it('captures and replays mixed imported/authored records with unchanged snapshot version and subject digests', async () => {
    const mixed = await makeAuthoredFixture()
    const verified = await capture(mixed)
    expect(verified.proof.verifierVersion).toBe('2.0.0')
    expect(verified.manifest.schemaVersion).toBe('2.0.0')
    const args = await replay(mixed)
    const port = createGovernanceEvidencePort({ env: mixed.env })
    expect(await port.verifyFeatureKey({ ...args, canonicalFeatureKey: syntheticFr(900) })).toMatchObject({
      state: 'AVAILABLE', canonicalSubject: 'Report credential isolation: a synthetic standalone machine permission.',
    })
    expect(await port.verifyRequirement({ ...args, feature: { canonicalFeatureKey: syntheticFr(900) }, sourceNamespace: 'ZAI', requirementKey: syntheticFr(900),
      revisionHash: statementDigest('Report credential isolation: a synthetic standalone machine permission.') })).toMatchObject({ state: 'AVAILABLE' })
    expect(await port.verifyFeatureKey({ ...args, canonicalFeatureKey: 'FEAT-001' })).toMatchObject({ state: 'AVAILABLE', canonicalSubject: 'Feature one' })
  })

  it('verifies two legitimate migrations sharing the same approval and base', async () => {
    expect((await capture(await makeAuthoredFixture('two-manifests'))).validationStatus).toBe('VALID')
  })

  it.each(['forged-origin', 'forged-base', 'cache-forged-base', 'forged-approval', 'unsupported-record', 'unsupported-index', 'statement-hash'])('rejects authored %s without a verification proof', async (fault) => {
    await expect(capture(await makeAuthoredFixture(fault))).rejects.toMatchObject({ code: 'SNAPSHOT_INVALID' })
  })

  it('captures a full-size 277-FR and 46-feature registry within the unchanged verification budget', async () => {
    const trace = fixtureTrace()
    const full = await makeFixture(() => {
      const records = []
      const files = {}
      for (let number = 1; number <= 277; number += 1) {
        const id = `FR-${String(number).padStart(3, '0')}`
        const record = canonical(id, 'FR', `| ${id} | Requirement ${number}. |`, `docs/requirements/${id}.md`, [], number <= 46 ? `FEAT-${String(number).padStart(3, '0')}` : undefined)
        records.push(record.entry)
        files[record.entry.path] = record.text
      }
      for (let number = 1; number <= 46; number += 1) {
        const suffix = String(number).padStart(3, '0')
        const id = `FEAT-${suffix}`
        const record = canonical(id, 'FEAT', `| ${id} | Feature ${number} | FR-${suffix} | live |`, `docs/features/${id}/feature.md`, [3])
        records.push(record.entry)
        files[record.entry.path] = record.text
      }
      return { index: { version: 1, sourceRevision, records }, files }
    }, trace)
    expect(full.manifest.entries).toHaveLength(324)
    trace('capture-start')
    expect((await capture(full)).validationStatus).toBe('VALID')
    trace('capture-complete')
  })

  it('captures committed records and replays stable subjects with canonical locators', async () => {
    const verified = await capture(fixture)
    expect(verified.proof.verifierVersion).toBe('2.0.0')
    expect(verified.manifest.schemaVersion).toBe('2.0.0')
    await writeFile(path.join(fixture.root, fr.entry.path), 'dirty working copy')
    const args = await replay(fixture)
    const port = createGovernanceEvidencePort({ env: fixture.env })
    expect(await port.verifyFeatureKey({ ...args, canonicalFeatureKey: 'FEAT-001' })).toMatchObject({
      state: 'AVAILABLE', canonicalSubject: 'Feature one',
      ref: `${feature.entry.path}#FEAT-001@${fixture.commitSha}`,
    })
    expect(await port.verifyRequirement({ ...args, feature: { canonicalFeatureKey: 'FEAT-001' },
      sourceNamespace: 'ZAI', requirementKey: 'FR-252', revisionHash: statementDigest('**Bind** the canonical requirement.') })).toMatchObject({
      state: 'AVAILABLE', ref: `${fr.entry.path}#FR-252@${fixture.commitSha}`,
    })
    expect(await port.verifyRequirement({ ...args, feature: { canonicalFeatureKey: 'FEAT-001' },
      sourceNamespace: 'ZNEXT', requirementKey: 'FR-252', revisionHash: statementDigest('**Bind** the canonical requirement.') })).toMatchObject({ state: 'UNAVAILABLE' })
  })

  it('refuses omission and digest mismatch even when the manifest itself hashes correctly', async () => {
    for (const entries of [fixture.manifest.entries.filter((entry) => entry.path !== fr.entry.path),
      fixture.manifest.entries.map((entry) => entry.path === fr.entry.path ? { ...entry, sha256: 'f'.repeat(64) } : entry)]) {
      await expect(capture(fixture, { ...fixture.manifest, entries })).rejects.toMatchObject({ code: 'SNAPSHOT_INVALID' })
    }
  })

  it.each(['duplicate', 'path-escape', 'namespace', 'wrong-id', 'record-digest', 'unknown-fr', 'reverse-membership', 'index-status'])('refuses %s in committed canonical sources', async (fault) => {
    const broken = await makeFixture((value) => {
      if (fault === 'duplicate') value.index.records.push({ ...value.index.records[0] })
      if (fault === 'path-escape') value.index.records[0].path = '../escape.md'
      if (fault === 'namespace') value.index.records[0].namespace = 'ZNEXT'
      if (fault === 'wrong-id') value.index.records[0].id = 'FR-253'
      if (fault === 'record-digest') value.index.records[0].recordSha256 = 'b'.repeat(64)
      if (fault === 'reverse-membership') {
        const entry = value.index.records[0]
        value.files[entry.path] = value.files[entry.path].replace('feature_id: FEAT-001', 'feature_id: FEAT-999')
        entry.featureId = 'FEAT-999'
        entry.recordSha256 = sha256(value.files[entry.path])
      }
      if (fault === 'index-status') value.index.records[0].status = 'approved'
      if (fault === 'unknown-fr') value.index.records = [value.index.records[1]]
      return value
    })
    await expect(capture(broken)).rejects.toMatchObject({ code: 'SNAPSHOT_INVALID' })
  })

  it('never reinterprets a v2 manifest using a v1 or unsupported stored verifier', async () => {
    for (const version of ['1.0.0', '3.0.0']) {
      const args = await replay(fixture, (snapshot) => ({ ...snapshot, verifierVersion: version,
        verificationProof: { ...snapshot.verificationProof, verifierVersion: version } }))
      expect(await createGovernanceEvidencePort({ env: fixture.env }).verifyFeatureKey({ ...args, canonicalFeatureKey: 'FEAT-001' }))
        .toMatchObject({ state: 'UNAVAILABLE' })
    }
    expect(() => normalizeSourceManifest({ ...fixture.manifest, schemaVersion: '3.0.0' })).toThrow()
  })
})
