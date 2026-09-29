import { createHash, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CANONICAL_INDEX_PATH, CANONICAL_SOURCE_MANIFEST_SCHEMA_VERSION,
  createGovernanceEvidencePort, normalizeSourceManifest, statementDigest,
  verifyGovernanceSnapshotIntent,
} from '@/modules/project-manager/application/governance-source-verifier'

// @req FR-252
// @spec docs/migrations/document-reintegration/INTEGRATION.md
// @tested tests/unit/governance-canonical-source.test.js

const execFile = promisify(execFileCallback)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
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

async function makeFixture(transform = (value) => value) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zuri-canonical-proof-'))
  rootPaths.push(root)
  await git(['init', '--quiet'], root)
  await git(['config', 'user.name', 'Canonical fixture'], root)
  await git(['config', 'user.email', 'fixture@example.test'], root)
  const original = { index: { version: 1, sourceRevision, records: [fr.entry, feature.entry] },
    files: { [fr.entry.path]: fr.text, [feature.entry.path]: feature.text } }
  const { index, files } = transform(structuredClone(original))
  files[CANONICAL_INDEX_PATH] = JSON.stringify(index)
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), content)
  }
  await git(['add', '--', '.'], root)
  await git(['commit', '--quiet', '-m', 'canonical fixture'], root)
  const commitSha = await git(['rev-parse', 'HEAD'], root)
  const normalized = normalizeSourceManifest({ schemaVersion: CANONICAL_SOURCE_MANIFEST_SCHEMA_VERSION,
    entries: Object.entries(files).map(([name, content]) => ({ path: name, sha256: sha256(content) })) })
  const registryPath = path.join(root, 'operator.json')
  await writeFile(registryPath, JSON.stringify({ schemaVersion: '1.0.0', bindings: [
    { checkoutBindingId: 'canonical-fixture', repositoryId, absoluteCheckoutRoot: root },
  ] }))
  return { root, commitSha, ...normalized, env: { ZURI_PM_CHECKOUT_REGISTRY_PATH: registryPath } }
}

function capture(value, sourceManifest = value.manifest) {
  return verifyGovernanceSnapshotIntent({ projectId, scope, repository, projectRepository,
    env: value.env, now: new Date('2026-09-29T00:00:00.000Z'),
    input: { repositoryId, commitSha: value.commitSha,
      manifestHash: normalizeSourceManifest(sourceManifest).manifestHash, sourceManifest } })
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
  for (const root of rootPaths) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)
      || !path.basename(root).startsWith('zuri-canonical-proof-')) throw Error('Unsafe fixture cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})

describe('canonical source snapshot v2', () => {
  it('captures a full-size 277-FR and 46-feature registry within the unchanged verification budget', async () => {
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
    })
    expect(full.manifest.entries).toHaveLength(324)
    expect((await capture(full)).validationStatus).toBe('VALID')
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
