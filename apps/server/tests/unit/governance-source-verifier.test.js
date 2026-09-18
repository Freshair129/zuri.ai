import { createHash, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  GIT_VERIFICATION_TIMEOUT_MS,
  REQUIRED_SOURCE_PATHS,
  SOURCE_MANIFEST_SCHEMA_VERSION,
  createGovernanceEvidencePort,
  computeSourceManifestHash,
  normalizeSourceManifest,
  statementDigest,
  verifyGovernanceSnapshotIntent,
  zCaptureSnapshotInput,
  zSourceManifest,
} from '@/modules/project-manager/application/governance-source-verifier'

// @req FR-252 — bound-commit provenance is strict, server-local and unavailable
// when the complete source and database binding cannot be reverified.
// @spec ADR-097, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/unit/governance-source-verifier.test.js

const execFile = promisify(execFileCallback)
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const BUSINESS_ID = '33333333-3333-4333-8333-333333333333'
const REPOSITORY_ID = '44444444-4444-4444-8444-444444444444'
const PROJECT_REPOSITORY_ID = '55555555-5555-4555-8555-555555555555'
const CHECKOUT_BINDING_ID = 'fixture-checkout'

const PRD = `# Requirements\n\n| ID | Statement |\n| --- | --- |\n| FR-252 | **Bind** the [canonical requirement](https://example.test/fr-252). |\n| FR-253 | A requirement that remains an implicit feature. |\n`
const FEATURES = `# Features\n\n| Feature | Title | Requirements | Status |\n| --- | --- | --- | --- |\n| FEAT-001 | Feature one | FR-252 | live |\n`

let fixture
let commitSha
let manifest
let manifestHash
let env
let source
let scope
let snapshot

async function git(args, cwd) {
  const result = await execFile('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    },
    shell: false,
    windowsHide: true,
  })
  return result.stdout.trim()
}

async function gitRaw(args, cwd) {
  const result = await execFile('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
    },
    shell: false,
    windowsHide: true,
    encoding: null,
  })
  return result.stdout
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zuri-pm-w5-'))
  await git(['init', '--quiet'], root)
  await git(['config', 'user.email', 'w5-fixture@example.test'], root)
  await git(['config', 'user.name', 'W5 Fixture'], root)
  await mkdir(path.join(root, 'docs'), { recursive: true })
  await writeFile(path.join(root, 'docs/PRD-SDD-v1.0.md'), PRD, 'utf8')
  await writeFile(path.join(root, 'docs/FEATURES.md'), FEATURES, 'utf8')
  await writeFile(path.join(root, 'docs/source[1].md'), 'literal path fixture\n', 'utf8')
  const fixturePaths = [...REQUIRED_SOURCE_PATHS, 'docs/source[1].md']
  await git(['add', '--', ...fixturePaths], root)
  await git(['commit', '--quiet', '-m', 'w5 fixture'], root)
  const head = await git(['rev-parse', 'HEAD'], root)
  const entries = await Promise.all(fixturePaths.map(async (sourcePath) => ({
    path: sourcePath,
    sha256: createHash('sha256').update(await readFile(path.join(root, sourcePath))).digest('hex'),
  })))
  const normalized = normalizeSourceManifest({ schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION, entries })
  const registryPath = path.join(root, 'checkout-registry.json')
  await writeFile(registryPath, JSON.stringify({
    schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
    bindings: [{ checkoutBindingId: CHECKOUT_BINDING_ID, repositoryId: REPOSITORY_ID, absoluteCheckoutRoot: root }],
  }), 'utf8')
  return {
    root,
    commitSha: head,
    manifest: normalized.manifest,
    manifestHash: normalized.manifestHash,
    env: { ZURI_PM_CHECKOUT_REGISTRY_PATH: registryPath },
  }
}

function transactionFor(snapshotRow = snapshot) {
  return {
    repository: {
      findMany: async () => [{ id: REPOSITORY_ID, businessId: BUSINESS_ID, status: 'ACTIVE' }],
    },
    projectRepository: {
      findMany: async () => [{ id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID }],
    },
    governanceSnapshot: {
      findFirst: async () => snapshotRow,
    },
  }
}

beforeAll(async () => {
  fixture = await makeFixture()
  commitSha = fixture.commitSha
  manifest = fixture.manifest
  manifestHash = fixture.manifestHash
  env = fixture.env
  source = {
    id: REPOSITORY_ID,
    businessId: BUSINESS_ID,
    status: 'ACTIVE',
  }
  scope = { project: { id: PROJECT_ID }, tenantId: TENANT_ID, businessId: BUSINESS_ID }
  const verified = await verifyGovernanceSnapshotIntent({
    projectId: PROJECT_ID,
    scope,
    repository: source,
    projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID, repo: source },
    input: { repositoryId: REPOSITORY_ID, commitSha, manifestHash, sourceManifest: manifest },
    env,
    now: new Date('2026-09-17T08:00:00.000Z'),
  })
  snapshot = {
    id: randomUUID(),
    tenantId: TENANT_ID,
    businessId: BUSINESS_ID,
    createdAt: new Date('2026-09-17T08:00:00.000Z'),
    repositoryId: REPOSITORY_ID,
    projectRepositoryId: PROJECT_REPOSITORY_ID,
    checkoutBindingId: verified.checkoutBindingId,
    commitSha,
    manifestHash,
    capturedAt: new Date('2026-09-17T08:00:00.000Z'),
    verifiedAt: new Date('2026-09-17T08:00:00.000Z'),
    verifierId: verified.proof.verifierId,
    verifierVersion: verified.proof.verifierVersion,
    proofId: verified.proof.proofId,
    verificationProof: verified.proof,
    validationStatus: 'VALID',
    sourceManifest: manifest,
  }
})

afterAll(async () => {
  if (fixture?.root) await rm(fixture.root, { recursive: true, force: true })
})

describe('SourceManifest canonical contract', () => {
  it('sorts by UTF-8 ordinal bytes and hashes compact normalized JSON', () => {
    const value = {
      schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
      entries: [
        { path: 'docs/FEATURES.md', sha256: 'b'.repeat(64) },
        { path: 'docs/PRD-SDD-v1.0.md', sha256: 'a'.repeat(64) },
      ],
    }
    const result = normalizeSourceManifest(value)
    expect(result.manifest.entries.map((entry) => entry.path)).toEqual(['docs/FEATURES.md', 'docs/PRD-SDD-v1.0.md'])
    expect(result.bytes.toString('utf8')).toBe(JSON.stringify(result.manifest))
    expect(result.manifestHash).toBe(createHash('sha256').update(result.bytes).digest('hex'))
    expect(computeSourceManifestHash({ ...value, entries: [...value.entries].reverse() })).toBe(result.manifestHash)
  })

  it('rejects unknown fields, duplicate/noncanonical paths and changed manifest digests', () => {
    expect(() => zSourceManifest.parse({
      schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
      entries: [{ path: 'docs/a.md', sha256: 'a'.repeat(64) }],
      advisory: 'ignored by no one',
    })).toThrow()
    expect(() => zSourceManifest.parse({
      schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
      entries: [
        { path: 'docs/a.md', sha256: 'a'.repeat(64) },
        { path: 'docs/a.md', sha256: 'a'.repeat(64) },
      ],
    })).toThrow()
    for (const badPath of ['/docs/a.md', 'docs//a.md', 'docs/./a.md', 'docs/../a.md', 'docs\\a.md']) {
      expect(() => zSourceManifest.parse({
        schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
        entries: [{ path: badPath, sha256: 'a'.repeat(64) }],
      })).toThrow()
    }
    expect(() => normalizeSourceManifest({
      schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
      entries: [{ path: 'docs/a.md', sha256: 'a'.repeat(64) }],
    }, { manifestHash: 'f'.repeat(64) })).toThrow()
    const oversized = {
      schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
      entries: Array.from({ length: 1000 }, (_, index) => ({
        path: `${'é'.repeat(500)}/${index}`,
        sha256: 'a'.repeat(64),
      })),
    }
    expect(zSourceManifest.safeParse(oversized).success).toBe(false)
    expect(zCaptureSnapshotInput.safeParse({
      repositoryId: REPOSITORY_ID,
      commitSha: commitSha || 'a'.repeat(40),
      manifestHash: 'a'.repeat(64),
      sourceManifest: { schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION, entries: [] },
    }).success).toBe(true)
  })
})

describe('bound Git verification', () => {
  it('proves raw committed blobs even when the working tree is dirty', async () => {
    await writeFile(path.join(fixture.root, 'docs/PRD-SDD-v1.0.md'), `${PRD}\nDIRTY WORKTREE\n`, 'utf8')
    const verified = await verifyGovernanceSnapshotIntent({
      projectId: PROJECT_ID,
      scope,
      repository: source,
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID, repo: source },
      input: { repositoryId: REPOSITORY_ID, commitSha, manifestHash, sourceManifest: manifest },
      env,
      now: new Date('2026-09-17T08:01:00.000Z'),
    })
    expect(verified.proof.outcome).toBe('VALID')
    expect(verified.proof.verifiedAt).toBe('2026-09-17T08:01:00.000Z')
    expect(verified.checkoutBindingId).toBe(CHECKOUT_BINDING_ID)
    expect(verified.manifestHash).toBe(manifestHash)
  })

  it('refuses wrong blob evidence, missing registry and unsupported commit aliases', async () => {
    await expect(verifyGovernanceSnapshotIntent({
      projectId: PROJECT_ID,
      scope,
      repository: source,
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID, repo: source },
      input: { repositoryId: REPOSITORY_ID, commitSha, manifestHash, sourceManifest: {
        ...manifest,
        entries: manifest.entries.map((entry) => entry.path === REQUIRED_SOURCE_PATHS[0] ? { ...entry, sha256: 'f'.repeat(64) } : entry),
      } },
      env,
    })).rejects.toMatchObject({ code: 'SNAPSHOT_INVALID' })
    await expect(verifyGovernanceSnapshotIntent({
      projectId: PROJECT_ID,
      scope,
      repository: source,
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID, repo: source },
      input: { repositoryId: REPOSITORY_ID, commitSha: commitSha.toUpperCase(), manifestHash, sourceManifest: manifest },
      env,
    })).rejects.toMatchObject({ code: 'SNAPSHOT_INVALID' })
    await expect(verifyGovernanceSnapshotIntent({
      projectId: PROJECT_ID,
      scope,
      repository: source,
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID, repo: source },
      input: { repositoryId: REPOSITORY_ID, commitSha, manifestHash, sourceManifest: manifest },
      env: {},
    })).rejects.toMatchObject({ code: 'DATA_INTEGRITY_UNAVAILABLE' })
  })

  it('passes the aggregate verification bound to injected Git runners', async () => {
    const optionsSeen = []
    const gitRunner = async (args, options) => {
      optionsSeen.push({ args, options })
      return gitRaw(args, options.cwd)
    }
    await verifyGovernanceSnapshotIntent({
      projectId: PROJECT_ID,
      scope,
      repository: source,
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID, repo: source },
      input: { repositoryId: REPOSITORY_ID, commitSha, manifestHash, sourceManifest: manifest },
      env,
      gitRunner,
    })
    expect(optionsSeen.length).toBeGreaterThan(0)
    expect(optionsSeen.every(({ options }) => options.timeoutMs > 0 && options.timeoutMs <= GIT_VERIFICATION_TIMEOUT_MS)).toBe(true)
    expect(GIT_VERIFICATION_TIMEOUT_MS).toBe(20_000)
  })

  it('ignores Git replacement refs when proving the requested commit object', async () => {
    await writeFile(path.join(fixture.root, 'docs/PRD-SDD-v1.0.md'), `${PRD}\nREPLACEMENT OBJECT\n`, 'utf8')
    await git(['add', '--', 'docs/PRD-SDD-v1.0.md'], fixture.root)
    await git(['commit', '--quiet', '-m', 'replacement object'], fixture.root)
    const replacementSha = await git(['rev-parse', 'HEAD'], fixture.root)
    await git(['replace', commitSha, replacementSha], fixture.root)
    try {
      await expect(verifyGovernanceSnapshotIntent({
        projectId: PROJECT_ID,
        scope,
        repository: source,
        projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID, repo: source },
        input: { repositoryId: REPOSITORY_ID, commitSha, manifestHash, sourceManifest: manifest },
        env,
      })).resolves.toMatchObject({ proof: { outcome: 'VALID' } })
    } finally {
      await git(['replace', '-d', commitSha], fixture.root).catch(() => {})
    }
  })

  it('fails closed at the shared verification deadline before starting another Git command', async () => {
    const calls = []
    let clock = 1_000_000
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const gitRunner = async (args) => {
      calls.push(args)
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        clock += GIT_VERIFICATION_TIMEOUT_MS + 1
        return Buffer.from(`${fixture.root}\n`, 'utf8')
      }
      throw new Error('no command should execute after checkout verification expires')
    }
    try {
      await expect(verifyGovernanceSnapshotIntent({
        projectId: PROJECT_ID,
        scope,
        repository: source,
        projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID, repo: source },
        input: { repositoryId: REPOSITORY_ID, commitSha, manifestHash, sourceManifest: manifest },
        env,
        gitRunner,
      })).rejects.toMatchObject({ code: 'DATA_INTEGRITY_UNAVAILABLE', reason: 'verification-timeout' })
      expect(calls).toHaveLength(1)
    } finally {
      dateNow.mockRestore()
    }
  })
})

describe('canonical key evidence port', () => {
  it('proves explicit bundles, implicit feature-of-one FRs and exact revision hashes', async () => {
    const port = createGovernanceEvidencePort({ env })
    const tx = transactionFor()
    const explicit = await port.verifyFeatureKey({
      tx, scope, snapshot, projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID }, canonicalFeatureKey: 'FEAT-001',
    })
    expect(explicit).toMatchObject({ state: 'AVAILABLE', canonicalFeatureKey: 'FEAT-001', canonicalSubject: 'Feature one' })
    const implicit = await port.verifyFeatureKey({
      tx, scope, snapshot, projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID }, canonicalFeatureKey: 'FR-253',
    })
    expect(implicit).toMatchObject({ state: 'AVAILABLE', canonicalFeatureKey: 'FR-253', canonicalSubject: 'A requirement that remains an implicit feature.' })
    const requirement = await port.verifyRequirement({
      tx, scope, feature: { canonicalFeatureKey: 'FEAT-001' }, snapshot, projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID },
      sourceNamespace: 'ZAI', requirementKey: 'FR-252', revisionHash: statementDigest('**Bind** the [canonical requirement](https://example.test/fr-252).'),
    })
    expect(requirement).toMatchObject({ state: 'AVAILABLE', sourceNamespace: 'ZAI', requirementKey: 'FR-252', canonicalFeatureKey: 'FEAT-001' })
  })

  it('returns unavailable for namespace, membership, revision and database-binding failures', async () => {
    const port = createGovernanceEvidencePort({ env })
    const base = {
      tx: transactionFor(), scope, feature: { canonicalFeatureKey: 'FEAT-001' }, snapshot,
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID },
      sourceNamespace: 'ZAI', requirementKey: 'FR-252', revisionHash: statementDigest('**Bind** the [canonical requirement](https://example.test/fr-252).'),
    }
    await expect(port.verifyRequirement({ ...base, sourceNamespace: 'zuri' })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })
    await expect(port.verifyRequirement({ ...base, revisionHash: 'f'.repeat(64) })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })
    await expect(port.verifyRequirement({ ...base, feature: { canonicalFeatureKey: 'FR-253' } })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })
    await expect(port.verifyFeatureKey({
      tx: transactionFor({ ...snapshot, projectRepositoryId: randomUUID() }), scope, snapshot: { ...snapshot, projectRepositoryId: randomUUID() },
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID }, canonicalFeatureKey: 'FEAT-001',
    })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })
    await expect(port.verifyFeatureKey({
      tx: transactionFor(), scope, snapshot: { ...snapshot, sourceManifest: JSON.stringify({ schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION, entries: [] }) },
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID }, canonicalFeatureKey: 'FEAT-001',
    })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })
    await expect(port.verifyFeatureKey({
      tx: transactionFor(), scope,
      snapshot: { ...snapshot, verificationProof: { ...snapshot.verificationProof, manifestHash: 'f'.repeat(64) } },
      projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID }, canonicalFeatureKey: 'FEAT-001',
    })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })
  })

  it('does not reuse verified evidence across a malformed proof or ambiguous ProjectRepository binding', async () => {
    const port = createGovernanceEvidencePort({ env })
    const projectRepository = { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID }
    await expect(port.verifyFeatureKey({
      tx: transactionFor(), scope, snapshot, projectRepository, canonicalFeatureKey: 'FEAT-001',
    })).resolves.toMatchObject({ state: 'AVAILABLE' })

    const malformedProof = {
      ...snapshot,
      verificationProof: { ...snapshot.verificationProof, verifierId: 'untrusted.verifier' },
    }
    await expect(port.verifyFeatureKey({
      tx: transactionFor(malformedProof), scope, snapshot: malformedProof, projectRepository, canonicalFeatureKey: 'FEAT-001',
    })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })

    const ambiguousTx = {
      ...transactionFor(),
      projectRepository: {
        findMany: async () => [
          { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID },
          { id: randomUUID(), projectId: PROJECT_ID, repoId: REPOSITORY_ID },
        ],
      },
    }
    const ambiguousPort = createGovernanceEvidencePort({ env })
    await expect(ambiguousPort.verifyFeatureKey({
      tx: ambiguousTx, scope, snapshot, projectRepository, canonicalFeatureKey: 'FEAT-001',
    })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })
  })

  it('rejects malformed feature keys before touching the checkout', async () => {
    const calls = []
    const port = createGovernanceEvidencePort({
      env,
      gitRunner: async () => {
        calls.push(true)
        throw new Error('unexpected Git call')
      },
    })
    await expect(port.verifyFeatureKey({
      tx: transactionFor(), scope, snapshot, projectRepository: { id: PROJECT_REPOSITORY_ID, projectId: PROJECT_ID, repoId: REPOSITORY_ID },
      canonicalFeatureKey: 'arbitrary-client-text',
    })).resolves.toMatchObject({ state: 'UNAVAILABLE', canonicalSubject: null })
    expect(calls).toHaveLength(0)
  })
})
