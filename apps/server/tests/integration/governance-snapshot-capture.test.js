import { createHash, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock('@/modules/project-manager/application/project-feature-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, resolveRequestViewerForFeatureMutation: mocks.authorize }
})

import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject } from '@/modules/project-manager/application/project-service'
import {
  computeSourceManifestHash,
  REQUIRED_SOURCE_PATHS,
  SOURCE_MANIFEST_SCHEMA_VERSION,
  statementDigest,
  zGovernanceSnapshot,
} from '@/modules/project-manager/application/governance-source-verifier'
import { captureGovernanceSnapshot, zSnapshotCaptureResult } from '@/modules/project-manager/application/governance-snapshot-service'
import { POST as captureRoute } from '@/app/api/projects/[id]/governance-snapshots/route'
import { createProjectFeature, replaceProjectFeatureRequirementBindings, zMutationError, zMutationReceipt } from '@/modules/project-manager/application/project-feature-service'
import { getProjectFeature as getProjectFeatureDetail } from '@/modules/project-manager/application/project-feature-read-model'
import { createProjectFeatureRepository } from '@/modules/project-manager/application/project-feature-repository'

// @req FR-252 — snapshot capture uses the owner/CSRF boundary and the shared
// scoped mutation transaction so invalid evidence cannot create protected rows.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/integration/governance-snapshot-capture.test.js

const execFile = promisify(execFileCallback)
const PRD = `# Requirements\n\n| ID | Statement |\n| --- | --- |\n| FR-252 | **Bind** the [approved requirement](https://example.test/fr-252). |\n| FR-253 | An implicit requirement. |\n`
const FEATURES = `# Features\n\n| Feature | Title | Requirements | Status |\n| --- | --- | --- | --- |\n| FEAT-001 | Feature one | FR-252 | live |\n`

const fixture = {
  portfolios: [],
  tenants: [],
  businesses: [],
  workspaces: [],
  projects: [],
  repositories: [],
  projectRepositories: [],
  snapshots: [],
  receipts: [],
  audits: [],
  features: [],
}

let project
let viewer
let sourceFixture
let captureInput
const previousRegistryPath = process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH

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

async function makeGitFixture(repositoryId) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zuri-pm-w5-capture-'))
  await mkdir(path.join(root, 'docs'), { recursive: true })
  await writeFile(path.join(root, 'docs/PRD-SDD-v1.0.md'), PRD, 'utf8')
  await writeFile(path.join(root, 'docs/FEATURES.md'), FEATURES, 'utf8')
  await git(['init', '--quiet'], root)
  await git(['config', 'user.email', 'w5-capture@example.test'], root)
  await git(['config', 'user.name', 'W5 Capture Fixture'], root)
  await git(['add', '--', ...REQUIRED_SOURCE_PATHS], root)
  await git(['commit', '--quiet', '-m', 'capture fixture'], root)
  const commitSha = await git(['rev-parse', 'HEAD'], root)
  const entries = await Promise.all(REQUIRED_SOURCE_PATHS.map(async (sourcePath) => ({
    path: sourcePath,
    sha256: createHash('sha256').update(await readFile(path.join(root, sourcePath))).digest('hex'),
  })))
  const sourceManifest = {
    schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
    entries,
  }
  const manifestHash = computeSourceManifestHash(sourceManifest)
  const registryPath = path.join(root, 'checkout-registry.json')
  await writeFile(registryPath, JSON.stringify({
    schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
    bindings: [{ checkoutBindingId: 'capture-binding', repositoryId, absoluteCheckoutRoot: root }],
  }), 'utf8')
  return { root, commitSha, sourceManifest, manifestHash, registryPath }
}

async function nextCaptureInput() {
  await writeFile(path.join(sourceFixture.root, 'docs/FEATURES.md'), `${FEATURES}\n<!-- committed revision ${randomUUID()} -->\n`, 'utf8')
  await git(['add', '--', 'docs/FEATURES.md'], sourceFixture.root)
  await git(['commit', '--quiet', '-m', 'capture second revision'], sourceFixture.root)
  const commitSha = await git(['rev-parse', 'HEAD'], sourceFixture.root)
  const entries = await Promise.all(REQUIRED_SOURCE_PATHS.map(async (sourcePath) => ({
    path: sourcePath,
    sha256: createHash('sha256').update(await readFile(path.join(sourceFixture.root, sourcePath))).digest('hex'),
  })))
  const sourceManifest = { schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION, entries }
  return { repositoryId: captureInput.repositoryId, commitSha, sourceManifest, manifestHash: computeSourceManifestHash(sourceManifest) }
}

function requestFor(input, idempotencyKey) {
  return new Request(`http://local/api/projects/${project.id}/governance-snapshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-CSRF-Token': 'test-token',
    },
    body: JSON.stringify(input),
  })
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8).toUpperCase()
  const portfolio = await createPortfolio({ name: `W5 capture portfolio ${suffix}`, code: `PF-W5-${suffix}` })
  fixture.portfolios.push(portfolio.id)
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `W5 capture tenant ${suffix}`, code: `TN-W5-${suffix}` })
  fixture.tenants.push(tenant.id)
  const business = await createBusiness({ tenantId: tenant.id, name: `W5 capture business ${suffix}`, code: `BU-W5-${suffix}` })
  fixture.businesses.push(business.id)
  const workspace = await createWorkspace({
    businessId: business.id, scopeType: 'BUSINESS', name: `W5 capture workspace ${suffix}`, code: `WS-W5-${suffix}`,
  })
  fixture.workspaces.push(workspace.id)
  viewer = makeViewer({
    principal: { id: randomUUID(), code: `W5-OWNER-${suffix}`, displayName: 'W5 Capture Owner' },
    visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
  })
  project = await createProject({
    workspaceId: workspace.id, businessId: business.id, name: `W5 capture project ${suffix}`, code: `PR-W5-${suffix}`,
  }, { viewer })
  fixture.projects.push(project.id)
  const repository = await prisma.repository.create({ data: {
    code: `REPO-W5-${suffix}`, businessId: business.id, provider: 'GITHUB', fullName: `fixture/w5-${suffix}`, status: 'ACTIVE',
  } })
  fixture.repositories.push(repository.id)
  const projectRepository = await prisma.projectRepository.create({ data: {
    projectId: project.id, repoId: repository.id, role: 'PRIMARY', branch: 'main',
  } })
  fixture.projectRepositories.push(projectRepository.id)
  sourceFixture = await makeGitFixture(repository.id)
  captureInput = {
    repositoryId: repository.id,
    commitSha: sourceFixture.commitSha,
    manifestHash: sourceFixture.manifestHash,
    sourceManifest: sourceFixture.sourceManifest,
  }
  process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH = sourceFixture.registryPath
})

afterAll(async () => {
  if (fixture.receipts.length) await prisma.projectFeatureMutationReceipt.deleteMany({ where: { id: { in: fixture.receipts } } })
  if (fixture.audits.length) await prisma.auditEvent.deleteMany({ where: { id: { in: fixture.audits } } })
  if (fixture.features.length) {
    await prisma.requirementBinding.deleteMany({ where: { featureId: { in: fixture.features } } })
    await prisma.projectFeature.deleteMany({ where: { id: { in: fixture.features } } })
  }
  if (fixture.snapshots.length) await prisma.governanceSnapshot.deleteMany({ where: { id: { in: fixture.snapshots } } })
  if (fixture.projectRepositories.length) await prisma.projectRepository.deleteMany({ where: { id: { in: fixture.projectRepositories } } })
  if (fixture.repositories.length) await prisma.repository.deleteMany({ where: { id: { in: fixture.repositories } } })
  if (fixture.projects.length) await prisma.project.deleteMany({ where: { id: { in: fixture.projects } } })
  if (fixture.workspaces.length) await prisma.workspace.deleteMany({ where: { id: { in: fixture.workspaces } } })
  if (fixture.businesses.length) await prisma.business.deleteMany({ where: { id: { in: fixture.businesses } } })
  if (fixture.tenants.length) await prisma.tenant.deleteMany({ where: { id: { in: fixture.tenants } } })
  if (fixture.portfolios.length) await prisma.portfolio.deleteMany({ where: { id: { in: fixture.portfolios } } })
  if (sourceFixture?.root) await rm(sourceFixture.root, { recursive: true, force: true })
  if (previousRegistryPath === undefined) delete process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH
  else process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH = previousRegistryPath
})

describe('FR-252 GovernanceSnapshot capture', () => {
  beforeEach(() => {
    mocks.authorize.mockResolvedValue({ viewer, session: null })
  })

  it('uses the default server evidence port from capture through Feature and requirement binding to read', async () => {
    const captured = await captureGovernanceSnapshot(project.id, await nextCaptureInput(), { viewer, idempotencyKey: `journey-capture-${randomUUID()}` })
    fixture.snapshots.push(captured.snapshot.id)
    fixture.receipts.push(captured.receipt.receiptId)
    fixture.audits.push(captured.receipt.auditRef)
    const created = await createProjectFeature(project.id, {
      code: `PIN-${randomUUID().slice(0, 8)}`, title: 'Verified feature',
      problem: 'Evidence must come from the committed registry', outcome: 'Pinned evidence',
      primaryDomainId: 'DOM-CRM', canonicalFeatureKey: 'FEAT-001', governanceSnapshotId: captured.snapshot.id,
    }, { viewer, idempotencyKey: `journey-feature-${randomUUID()}` })
    fixture.features.push(created.receipt.resourceId)
    fixture.receipts.push(created.receipt.receiptId)
    fixture.audits.push(created.receipt.auditRef)
    const bound = await replaceProjectFeatureRequirementBindings(project.id, created.receipt.resourceId, { bindings: [{
      governanceSnapshotId: captured.snapshot.id, sourceNamespace: 'ZAI', requirementKey: 'FR-252',
      revisionHash: statementDigest('**Bind** the [approved requirement](https://example.test/fr-252).'),
      acceptanceRef: 'docs/PRD-SDD-v1.0.md#fr-252',
    }] }, { viewer, idempotencyKey: `journey-binding-${randomUUID()}`, ifMatch: created.receipt.etag })
    fixture.receipts.push(bound.receipt.receiptId)
    fixture.audits.push(bound.receipt.auditRef)
    const detail = await getProjectFeatureDetail(project.id, created.receipt.resourceId, { viewer })
    expect(detail.evidenceState).toBe('AVAILABLE')
    expect(detail.requirementBindings).toHaveLength(1)
    expect(detail.requirementBindings[0]).toMatchObject({ bindingState: 'PINNED', canonicalSubject: 'Bind the approved requirement.' })
    expect(JSON.stringify(detail)).not.toContain(sourceFixture.root)
  })

  it('returns the committed winner after a rolled-back capture attempt is replayed', async () => {
    const key = `rollback-replay-${randomUUID()}`
    const retryInput = await nextCaptureInput()
    const actualRepository = createProjectFeatureRepository({ db: prisma })
    const rollback = new Error('ISOLATED_ATTEMPT_ROLLBACK')
    let winner
    const retryRepository = {
      dialect: actualRepository.dialect,
      async withProjectTransaction(options, callback) {
        if (options.mode !== 'mutation') return actualRepository.withProjectTransaction(options, callback)
        await expect(actualRepository.withProjectTransaction(options, async (tx, scope) => {
          await callback(tx, scope)
          throw rollback
        })).rejects.toBe(rollback)
        winner = await captureGovernanceSnapshot(project.id, retryInput, { viewer, idempotencyKey: key })
        fixture.snapshots.push(winner.snapshot.id)
        fixture.receipts.push(winner.receipt.receiptId)
        fixture.audits.push(winner.receipt.auditRef)
        return actualRepository.withProjectTransaction(options, callback)
      },
    }
    const result = await captureGovernanceSnapshot(project.id, retryInput, { viewer, idempotencyKey: key, repository: retryRepository })
    expect(result.replayed).toBe(true)
    expect(result.receipt.receiptId).toBe(winner.receipt.receiptId)
    expect(result.snapshot).toEqual(winner.snapshot)
    expect(result.snapshot.id).toBe(result.receipt.resourceId)
    expect(await prisma.governanceSnapshot.count({ where: { id: result.snapshot.id } })).toBe(1)
  })

  it('persists a typed snapshot and receipt, then replays the same resource', async () => {
    const key = `capture-${randomUUID()}`
    const firstResponse = await captureRoute(requestFor(captureInput, key), { params: { id: project.id } })
    const firstBody = await firstResponse.json()
    expect(firstResponse.status).toBe(201)
    expect(zSnapshotCaptureResult.parse(firstBody)).toEqual(firstBody)
    expect(zGovernanceSnapshot.parse(firstBody.snapshot)).toEqual(firstBody.snapshot)
    expect(zMutationReceipt.parse(firstBody.receipt)).toEqual(firstBody.receipt)
    const featureReceipt = { ...firstBody.receipt, operation: 'CREATE_FEATURE', resourceType: 'PROJECT_FEATURE', version: 1 }
    expect(zMutationReceipt.safeParse(featureReceipt).success).toBe(true)
    expect(zSnapshotCaptureResult.safeParse({ ...firstBody, receipt: featureReceipt }).success).toBe(false)
    expect(zSnapshotCaptureResult.safeParse({ ...firstBody, receipt: { ...firstBody.receipt, resourceId: randomUUID() } }).success).toBe(false)
    expect(firstBody.receipt).toMatchObject({
      targetId: project.id,
      targetType: 'PROJECT',
      operation: 'CAPTURE_GOVERNANCE_SNAPSHOT',
      resourceType: 'GOVERNANCE_SNAPSHOT',
      version: null,
    })
    fixture.snapshots.push(firstBody.snapshot.id)
    fixture.receipts.push(firstBody.receipt.receiptId)
    const firstAudit = await prisma.auditEvent.findFirst({ where: { entityType: 'GOVERNANCE_SNAPSHOT', entityId: firstBody.snapshot.id } })
    expect(firstAudit).not.toBeNull()
    fixture.audits.push(firstAudit.id)
    const beforeCounts = {
      snapshots: await prisma.governanceSnapshot.count({ where: { id: firstBody.snapshot.id } }),
      receipts: await prisma.projectFeatureMutationReceipt.count({ where: { targetId: project.id, operation: 'CAPTURE_GOVERNANCE_SNAPSHOT' } }),
      audits: await prisma.auditEvent.count({ where: { entityType: 'GOVERNANCE_SNAPSHOT', entityId: firstBody.snapshot.id } }),
    }

    const replayResponse = await captureRoute(requestFor(captureInput, key), { params: { id: project.id } })
    const replayBody = await replayResponse.json()
    expect(replayResponse.status).toBe(200)
    expect(replayBody.snapshot).toEqual(firstBody.snapshot)
    expect(replayBody.receipt.receiptId).toBe(firstBody.receipt.receiptId)
    expect(await prisma.governanceSnapshot.count({ where: { id: firstBody.snapshot.id } })).toBe(beforeCounts.snapshots)
    expect(await prisma.projectFeatureMutationReceipt.count({ where: { targetId: project.id, operation: 'CAPTURE_GOVERNANCE_SNAPSHOT' } })).toBe(beforeCounts.receipts)
    expect(await prisma.auditEvent.count({ where: { entityType: 'GOVERNANCE_SNAPSHOT', entityId: firstBody.snapshot.id } })).toBe(beforeCounts.audits)
  })

  it('refuses invalid committed evidence without creating any protected row', async () => {
    const before = {
      snapshots: await prisma.governanceSnapshot.count({ where: { businessId: project.businessId } }),
      receipts: await prisma.projectFeatureMutationReceipt.count({ where: { projectId: project.id, operation: 'CAPTURE_GOVERNANCE_SNAPSHOT' } }),
      audits: await prisma.auditEvent.count({ where: { entityType: 'GOVERNANCE_SNAPSHOT' } }),
    }
    const invalidInput = {
      ...captureInput,
      manifestHash: 'f'.repeat(64),
    }
    const response = await captureRoute(requestFor(invalidInput, `invalid-${randomUUID()}`), { params: { id: project.id } })
    const body = await response.json()
    expect(response.status).toBe(422)
    expect(zMutationError.parse(body)).toEqual(body)
    expect(body.code).toBe('SNAPSHOT_INVALID')
    expect(await prisma.governanceSnapshot.count({ where: { businessId: project.businessId } })).toBe(before.snapshots)
    expect(await prisma.projectFeatureMutationReceipt.count({ where: { projectId: project.id, operation: 'CAPTURE_GOVERNANCE_SNAPSHOT' } })).toBe(before.receipts)
    expect(await prisma.auditEvent.count({ where: { entityType: 'GOVERNANCE_SNAPSHOT' } })).toBe(before.audits)
  })

  it('keeps the direct service transaction-scoped when no HTTP adapter is involved', async () => {
    const result = await captureGovernanceSnapshot(project.id, await nextCaptureInput(), {
      viewer,
      idempotencyKey: `service-${randomUUID()}`,
      env: { ZURI_PM_CHECKOUT_REGISTRY_PATH: sourceFixture.registryPath },
    })
    expect(result.httpStatus).toBe(201)
    expect(zGovernanceSnapshot.parse(result.snapshot)).toEqual(result.snapshot)
    fixture.snapshots.push(result.snapshot.id)
    fixture.receipts.push(result.receipt.receiptId)
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'GOVERNANCE_SNAPSHOT', entityId: result.snapshot.id } })
    if (audit) fixture.audits.push(audit.id)
  })
})
