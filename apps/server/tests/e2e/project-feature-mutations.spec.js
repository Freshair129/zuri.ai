// @req FR-252 — an authorized Project owner can complete the bounded Feature
// mutation flows through CSRF, idempotency and CAS-aware forms, with a fresh
// authority reread after each durable receipt.
// @spec ADR-097, SDD-019, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/e2e/project-feature-mutations.spec.js

const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

const PROJECT_ID = '00000000-0000-4000-8000-000000000201'
const FEATURE_ID = '00000000-0000-4000-8000-000000000202'
const WORK_ID = '00000000-0000-4000-8000-000000000203'
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000204'
const NEW_FEATURE_ID = '00000000-0000-4000-8000-000000000205'
const REQUEST_ID = '00000000-0000-4000-8000-000000000206'
const NEXT_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000211'
const DELETED_EXTRA_ID = '00000000-0000-4000-8000-000000000212'
const GRAPH_ETAG = '"PROJECT_FEATURE_GRAPH/' + PROJECT_ID + '/' + 'a'.repeat(64) + '"'
const SNAPSHOT_ETAG = '"PROJECT_FEATURE_GRAPH/' + PROJECT_ID + '/' + 'b'.repeat(64) + '"'

function featureRecord(projectId = PROJECT_ID, overrides = {}) {
  return {
    id: FEATURE_ID,
    version: 1,
    projectId,
    code: 'FEAT-E2E-001',
    title: 'Owner Feature',
    problem: 'A bounded Project problem.',
    outcome: 'A visible owner outcome.',
    primaryDomain: { domainId: 'DOM-CRM', label: 'Customer relationship', mappingState: 'MAPPED' },
    contributions: [],
    workLinks: [],
    requirementBindings: [],
    canonicalFeatureKey: null,
    governanceSnapshotId: null,
    lifecycle: 'DRAFT',
    uniqueWorkCount: 0,
    evidence: [],
    evidenceState: 'UNAVAILABLE',
    ...overrides,
  }
}

function featureView(projectId, features) {
  return {
    schemaVersion: '1.0',
    projectId,
    snapshotId: null,
    snapshotState: 'UNAVAILABLE',
    observedAt: '2026-09-17T00:00:00.000Z',
    uniqueWorkCount: features.length ? 1 : 0,
    features,
  }
}

function receipt(operation, {
  targetId = FEATURE_ID,
  targetType = 'FEATURE',
  resourceId = FEATURE_ID,
  resourceType = 'PROJECT_FEATURE',
  httpMethod = operation === 'CREATE_FEATURE' || operation === 'RESTORE_FEATURE' || operation === 'CAPTURE_GOVERNANCE_SNAPSHOT'
    ? 'POST'
    : operation === 'UPDATE_FEATURE'
      ? 'PATCH'
      : operation === 'DELETE_FEATURE'
        ? 'DELETE'
        : 'PUT',
  version = 2,
  etag = '"PROJECT_FEATURE/' + FEATURE_ID + '/v2"',
} = {}) {
  return {
    receiptId: REQUEST_ID,
    targetId,
    targetType,
    operation,
    httpMethod,
    resourceId,
    resourceType,
    status: 'COMMITTED',
    version,
    etag,
    recordedAt: '2026-09-17T00:00:00.000Z',
    auditRef: 'audit/' + REQUEST_ID,
    requestId: REQUEST_ID,
  }
}

function snapshotMetadata(id = SNAPSHOT_ID) {
  return {
    id,
    repositoryId: PROJECT_ID,
    commitSha: 'a'.repeat(40),
    manifestHash: 'b'.repeat(64),
    capturedAt: '2026-09-17T00:00:00.000Z',
    validationStatus: 'VALID',
  }
}

function snapshotResult() {
  return {
    snapshot: {
      ...snapshotMetadata(),
      tenantId: '00000000-0000-4000-8000-000000000207',
      businessId: '00000000-0000-4000-8000-000000000208',
      createdAt: '2026-09-17T00:00:00.000Z',
      projectRepositoryId: '00000000-0000-4000-8000-000000000209',
      checkoutBindingId: 'checkout-e2e',
      verifiedAt: '2026-09-17T00:00:00.000Z',
      verifierId: 'e2e-verifier',
      verifierVersion: '1',
      proofId: '00000000-0000-4000-8000-000000000210',
      verificationProof: {},
      sourceManifest: { schemaVersion: '1.0.0', entries: [] },
    },
    receipt: receipt('CAPTURE_GOVERNANCE_SNAPSHOT', {
      targetId: PROJECT_ID,
      targetType: 'PROJECT',
      resourceId: SNAPSHOT_ID,
      resourceType: 'GOVERNANCE_SNAPSHOT',
      httpMethod: 'POST',
      version: null,
      etag: SNAPSHOT_ETAG,
    }),
  }
}

async function openOwnerFeaturePage(page, { uncertainOperation = null, invalidOperation = null, featureOverrides = {}, holdUncertainResponse = false } = {}) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const projectResponse = await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')
  expect(projectResponse.ok(), 'Project fixture resolution failed').toBe(true)
  const project = await projectResponse.json()
  const features = new Map([[FEATURE_ID, featureRecord(project.id, featureOverrides)]])
  const deleted = new Map()
  const mutationRequests = []
  const mutationAttempts = new Map()
  const graphEtag = '"PROJECT_FEATURE_GRAPH/' + project.id + '/' + 'a'.repeat(64) + '"'
  let releaseUncertainResponse = () => {}
  let uncertainResponseReleased = Promise.resolve()
  if (holdUncertainResponse) {
    uncertainResponseReleased = new Promise((resolve) => { releaseUncertainResponse = resolve })
  }

  const specialMutationResponse = (operation) => {
    const attempt = (mutationAttempts.get(operation) || 0) + 1
    mutationAttempts.set(operation, attempt)
    if (attempt !== 1) return null
    if (uncertainOperation === operation) return { status: 503, contentType: 'text/html', body: '<html>gateway unavailable</html>' }
    if (invalidOperation === operation) return { status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_ALLOCATION', message: 'Allocation is invalid.', requestId: REQUEST_ID, retryable: false, fields: [{ path: 'links.0.allocationBps', code: 'INVALID_FIELD', message: 'Allocation must be reviewed.' }] }) }
    return null
  }

  await page.route('**/api/auth/csrf', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'csrf-e2e', expiresAt: '2026-09-17T00:15:00.000Z' }) })
  })

  await page.route('**/api/work**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.searchParams.get('projectId') !== project.id) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: WORK_ID,
          code: 'WI-E2E',
          title: 'E2E WorkItem',
          deletedAt: null,
          workstream: { id: '00000000-0000-4000-8000-000000000215', projectId: project.id, status: 'ACTIVE', deletedAt: null, project: { id: project.id } },
        }],
        limit: 500,
        truncated: false,
      }),
    })
  })

  await page.route('**/api/projects/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const base = '/api/projects/' + project.id
    const detailPrefix = base + '/features/'
    const detailParts = path.startsWith(detailPrefix) ? path.slice(detailPrefix.length).split('/') : []
    const detailId = detailParts.length > 0 && detailParts.length <= 2 ? detailParts[0] : null
    const detailAction = detailParts[1] || null
    if (path === base + '/feature-view' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        headers: { ETag: graphEtag },
        contentType: 'application/json',
        body: JSON.stringify(featureView(project.id, [...features.values()])),
      })
      return
    }
    if (path === base + '/governance-snapshots' && request.method() === 'GET') {
      const cursor = url.searchParams.get('cursor')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [snapshotMetadata(cursor ? NEXT_SNAPSHOT_ID : SNAPSHOT_ID)], nextCursor: cursor ? null : 'snapshot-page-2', observedAt: '2026-09-17T00:00:00.000Z' }),
      })
      return
    }
    if (path === base + '/features' && request.method() === 'GET' && url.searchParams.get('visibility') === 'DELETED') {
      const cursor = url.searchParams.get('cursor')
      const extra = featureRecord(project.id, { id: DELETED_EXTRA_ID, code: 'FEAT-E2E-HISTORY-002' })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: cursor ? [...deleted.values(), { id: extra.id, projectId: project.id, code: extra.code, lifecycle: extra.lifecycle, version: extra.version, deletedAt: '2026-09-17T00:00:00.000Z', deleteBatchId: REQUEST_ID }] : [...deleted.values()], nextCursor: cursor ? null : (deleted.size ? 'deleted-page-2' : null), observedAt: '2026-09-17T00:00:00.000Z' }),
      })
      return
    }
    if (path === base + '/features' && request.method() === 'POST') {
      const body = request.postDataJSON()
      mutationRequests.push({ path, method: request.method(), headers: request.headers(), body })
      const created = featureRecord(project.id, {
        id: NEW_FEATURE_ID,
        code: body.code,
        title: body.title,
        problem: body.problem,
        outcome: body.outcome,
        primaryDomain: { domainId: body.primaryDomainId, label: 'Customer relationship', mappingState: 'MAPPED' },
      })
      features.set(created.id, created)
      await route.fulfill({ status: 201, contentType: 'application/json', headers: { ETag: '"PROJECT_FEATURE/' + NEW_FEATURE_ID + '/v1"', 'X-Request-ID': REQUEST_ID }, body: JSON.stringify(receipt('CREATE_FEATURE', { targetId: project.id, targetType: 'PROJECT', resourceId: NEW_FEATURE_ID, version: 1, httpMethod: 'POST', etag: '"PROJECT_FEATURE/' + NEW_FEATURE_ID + '/v1"' })) })
      return
    }
    if (detailId && detailParts.length === 1 && request.method() === 'GET') {
      const current = features.get(detailId)
      if (!current) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'RESOURCE_NOT_FOUND', message: 'Resource not found.', requestId: REQUEST_ID, retryable: false }) })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: '"PROJECT_FEATURE/' + current.id + '/v' + current.version + '"' },
        body: JSON.stringify(current),
      })
      return
    }
    if (detailId && detailParts.length >= 1 && request.method() !== 'GET') {
      const current = features.get(detailId) || deleted.get(detailId)
      const body = request.postDataJSON()
      mutationRequests.push({ path, method: request.method(), headers: request.headers(), body })
      if (detailAction === 'restore') {
        const restored = deleted.get(detailId)
        if (restored) {
          features.set(restored.id, featureRecord(project.id, { ...restored, lifecycle: 'DRAFT', version: restored.version + 1 }))
          deleted.delete(restored.id)
        }
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: '"PROJECT_FEATURE/' + detailId + '/v2"' }, body: JSON.stringify(receipt('RESTORE_FEATURE', { resourceId: detailId, etag: '"PROJECT_FEATURE/' + detailId + '/v2"' })) })
        return
      }
      if (request.method() === 'DELETE' && current) {
        deleted.set(current.id, { id: current.id, projectId: project.id, code: current.code, lifecycle: current.lifecycle, version: current.version + 1, deletedAt: '2026-09-17T00:00:00.000Z', deleteBatchId: REQUEST_ID })
        features.delete(current.id)
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: '"PROJECT_FEATURE/' + detailId + '/v' + (current.version + 1) + '"' }, body: JSON.stringify(receipt('DELETE_FEATURE', { resourceId: detailId, version: current.version + 1, etag: '"PROJECT_FEATURE/' + detailId + '/v' + (current.version + 1) + '"' })) })
        return
      }
      if (current && body) {
        const next = { ...current, version: current.version + 1 }
        if (request.method() === 'PATCH') Object.assign(next, body)
        if (path.endsWith('/contributions')) next.contributions = (body.contributions || []).map((row, index) => ({ id: '00000000-0000-4000-8000-00000000021' + index, version: 1, domainId: row.domainId, label: 'Customer relationship', mappingState: 'MAPPED', responsibility: row.responsibility }))
        if (path.endsWith('/work-links')) next.workLinks = (body.links || []).map((row, index) => ({ id: '00000000-0000-4000-8000-00000000031' + index, version: 1, workItemId: row.workItemId, allocationBps: row.allocationBps, allocationState: 'PARTIAL', workItem: { code: 'WORK-E2E', title: 'E2E WorkItem' } }))
        if (path.endsWith('/requirement-bindings')) next.requirementBindings = (body.bindings || []).map((row, index) => ({ id: '00000000-0000-4000-8000-00000000041' + index, version: 1, ...row, canonicalSubject: null, bindingState: 'UNAVAILABLE' }))
        const operation = path.endsWith('/contributions') ? 'REPLACE_CONTRIBUTIONS' : path.endsWith('/work-links') ? 'REPLACE_WORK_LINKS' : path.endsWith('/requirement-bindings') ? 'REPLACE_REQUIREMENT_BINDINGS' : 'UPDATE_FEATURE'
        const special = specialMutationResponse(operation)
        if (special) {
          if (holdUncertainResponse && uncertainOperation === operation) await uncertainResponseReleased
          await route.fulfill(special)
          return
        }
        features.set(next.id, next)
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: '"PROJECT_FEATURE/' + next.id + '/v' + next.version + '"' }, body: JSON.stringify(receipt(operation, { resourceId: next.id, version: next.version, httpMethod: operation === 'UPDATE_FEATURE' ? 'PATCH' : 'PUT', etag: '"PROJECT_FEATURE/' + next.id + '/v' + next.version + '"' })) })
        return
      }
    }
    if (path === base + '/feature-work-links' && request.method() === 'PUT') {
      mutationRequests.push({ path, method: request.method(), headers: request.headers(), body: request.postDataJSON() })
      const special = specialMutationResponse('REPLACE_FEATURE_WORK_GRAPH')
      if (special) {
        if (holdUncertainResponse && uncertainOperation === 'REPLACE_FEATURE_WORK_GRAPH') await uncertainResponseReleased
        await route.fulfill(special)
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: graphEtag }, body: JSON.stringify(receipt('REPLACE_FEATURE_WORK_GRAPH', { targetId: project.id, targetType: 'PROJECT', resourceId: project.id, resourceType: 'PROJECT_FEATURE_GRAPH', version: null, httpMethod: 'PUT', etag: graphEtag })) })
      return
    }
    if (path === base + '/governance-snapshots' && request.method() === 'POST') {
      mutationRequests.push({ path, method: request.method(), headers: request.headers(), body: request.postDataJSON() })
      await route.fulfill({ status: 201, contentType: 'application/json', headers: { ETag: SNAPSHOT_ETAG }, body: JSON.stringify(snapshotResult()) })
      return
    }
    await route.continue()
  })

  await page.goto('/projects/' + project.id + '/feature-view')
  await expect(page.getByTestId('project-feature-view')).toHaveAttribute('data-view-state', 'ready')
  return { project, features, deleted, mutationRequests, releaseUncertainResponse }
}

test.describe('FR-252 Project Feature owner forms', () => {
  test('creates and edits a Feature with owner graph capability, CSRF, idempotency and fresh rereads', async ({ page }) => {
    const { project, mutationRequests } = await openOwnerFeaturePage(page)
    await page.getByRole('button', { name: 'Create Feature', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'Create Project Feature' })
    await create.getByLabel('Feature code').fill('FEAT-E2E-NEW')
    await create.getByLabel('Title').fill('Created by owner')
    await create.getByLabel('Problem').fill('A create problem.')
    await create.getByLabel('Outcome').fill('A create outcome.')
    await create.getByLabel('Primary Domain', { exact: true }).selectOption('DOM-CRM')
    await create.getByRole('button', { name: 'Create Feature', exact: true }).click()
    await expect(create.getByTestId('feature-review-summary')).toBeVisible()
    await create.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect(create).toHaveCount(0)
    const createRequest = mutationRequests.find((request) => request.method === 'POST' && request.path.endsWith('/features'))
    expect(createRequest.body).toEqual({
      code: 'FEAT-E2E-NEW',
      title: 'Created by owner',
      problem: 'A create problem.',
      outcome: 'A create outcome.',
      primaryDomainId: 'DOM-CRM',
      lifecycle: 'DRAFT',
    })
    expect(createRequest.headers['x-csrf-token']).toBe('csrf-e2e')
    expect(createRequest.headers['idempotency-key']).toMatch(/^pm-feature-.{8,}$/)
    expect(createRequest.headers['if-match']).toBeUndefined()

    const row = page.getByRole('button', { name: 'Open Feature FEAT-E2E-001' })
    await row.click()
    const drawer = page.getByRole('dialog', { name: 'Feature detail' })
    await expect(drawer.getByTestId('feature-owner-actions')).toBeVisible()
    await drawer.getByRole('button', { name: 'Edit Feature', exact: true }).click()
    const edit = page.getByRole('dialog', { name: /Edit FEAT-E2E-001/ })
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(edit).toBeVisible()
    await edit.getByLabel('Title').fill('Owner Feature edited')
    await page.keyboard.press('Escape')
    await expect(edit).toHaveCount(0)
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Edit Feature', exact: true })).toBeFocused()
    await drawer.getByRole('button', { name: 'Edit Feature', exact: true }).click()
    const reopenedEdit = page.getByRole('dialog', { name: /Edit FEAT-E2E-001/ })
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await reopenedEdit.getByLabel('Title').fill('Owner Feature edited')
    await reopenedEdit.getByRole('button', { name: 'Save Feature', exact: true }).click()
    await expect(reopenedEdit.getByTestId('feature-review-summary')).toBeVisible()
    await reopenedEdit.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect(reopenedEdit).toHaveCount(0)
    const editRequest = mutationRequests.find((request) => request.method === 'PATCH')
    expect(editRequest.headers['if-match']).toBe('"PROJECT_FEATURE/' + FEATURE_ID + '/v1"')
    await expect(drawer).toContainText('Owner Feature edited')
  })

  test('replaces relationships, captures snapshot evidence, and preserves a delete/restore tombstone flow', async ({ page }) => {
    const { mutationRequests } = await openOwnerFeaturePage(page)
    const row = page.getByRole('button', { name: 'Open Feature FEAT-E2E-001' })
    await row.click()
    const drawer = page.getByRole('dialog', { name: 'Feature detail' })

    await drawer.getByRole('button', { name: 'Edit Domain contributions', exact: true }).click()
    const contributions = page.getByRole('dialog', { name: /Supporting Domains/ })
    await contributions.getByRole('button', { name: 'Add supporting Domain' }).click()
    await contributions.getByLabel('Supporting Domain 1', { exact: true }).selectOption('DOM-COMMERCE')
    await contributions.getByLabel('Responsibility').fill('Supports owner delivery')
    await contributions.getByRole('button', { name: 'Save Domains', exact: true }).click()
    await expect(contributions.getByTestId('feature-review-summary')).toBeVisible()
    await contributions.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect(contributions).toHaveCount(0)

    await drawer.getByRole('button', { name: 'Edit Work links', exact: true }).click()
    const links = page.getByRole('dialog', { name: /WorkItem links/ })
    await links.getByRole('button', { name: 'Add WorkItem link' }).click()
    await links.getByLabel('WorkItem 1', { exact: true }).selectOption(WORK_ID)
    await links.getByLabel('Allocation bps').fill('10000')
    await links.getByRole('button', { name: 'Save Work links', exact: true }).click()
    await expect(links.getByTestId('feature-review-summary')).toBeVisible()
    await links.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect(links).toHaveCount(0)

    await drawer.getByRole('button', { name: 'Edit Work graph', exact: true }).click()
    const graph = page.getByRole('dialog', { name: 'Cross-Feature Work graph' })
    await graph.getByRole('button', { name: 'Save Work graph', exact: true }).click()
    await expect(graph.getByTestId('feature-review-summary')).toBeVisible()
    await graph.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect(graph).toHaveCount(0)

    await drawer.getByRole('button', { name: 'Edit Requirement bindings', exact: true }).click()
    const requirements = page.getByRole('dialog', { name: /Requirement evidence/ })
    await requirements.getByRole('button', { name: 'Add requirement binding' }).click()
    await requirements.getByLabel('Governance Snapshot ID').fill(SNAPSHOT_ID)
    await requirements.getByLabel('Source namespace').fill('zuri')
    await requirements.getByLabel('Requirement key').fill('FR-252')
    await requirements.getByLabel('Revision hash').fill('a'.repeat(64))
    await requirements.getByLabel('Acceptance reference').fill('owner flow')
    await requirements.getByRole('button', { name: 'Save requirements', exact: true }).click()
    await expect(requirements.getByTestId('feature-review-summary')).toBeVisible()
    await requirements.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect(requirements).toHaveCount(0)

    await drawer.getByRole('button', { name: 'Close feature detail', exact: true }).click()
    await expect(drawer).toHaveCount(0)
    await page.getByRole('button', { name: 'Snapshot evidence', exact: true }).click()
    const snapshots = page.getByRole('dialog', { name: 'Governance snapshot evidence' })
    await expect(snapshots).toContainText(SNAPSHOT_ID)
    await snapshots.getByRole('button', { name: 'Load more snapshots', exact: true }).click()
    await expect(snapshots).toContainText(NEXT_SNAPSHOT_ID)
    await snapshots.getByRole('button', { name: 'Capture snapshot', exact: true }).click()
    const capture = page.getByRole('dialog', { name: 'Capture governance snapshot' })
    await capture.getByLabel('Repository ID').fill(PROJECT_ID)
    await capture.getByLabel('Commit SHA').fill('a'.repeat(40))
    await capture.getByLabel('Manifest hash').fill('b'.repeat(64))
    await capture.getByLabel('Source manifest JSON').fill(JSON.stringify({ schemaVersion: '1.0.0', entries: [] }))
    await capture.getByRole('button', { name: 'Capture snapshot', exact: true }).click()
    await expect(capture).toHaveCount(0)
    expect(mutationRequests.some((request) => request.method === 'POST' && request.path.endsWith('/governance-snapshots'))).toBe(true)

    await row.click()
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Delete Feature', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: /Delete FEAT-E2E-001/ })
    await deletion.getByRole('checkbox').check()
    await deletion.getByRole('button', { name: 'Delete Feature', exact: true }).click()
    await expect(deletion).toHaveCount(0)
    await expect(drawer.locator('[data-detail-view-state="not-found"]')).toBeVisible()
    await drawer.getByRole('button', { name: 'Close feature detail', exact: true }).click()
    await expect(drawer).toHaveCount(0)

    await page.getByRole('button', { name: 'Restore deleted Feature', exact: true }).click()
    const restore = page.getByRole('dialog', { name: 'Restore deleted Feature' })
    await restore.getByLabel('Deleted Feature').selectOption(FEATURE_ID)
    await restore.getByRole('button', { name: 'Load more deleted Features', exact: true }).click()
    await expect(restore.getByLabel('Deleted Feature')).toHaveValue(FEATURE_ID)
    await restore.getByRole('button', { name: 'Restore Feature', exact: true }).click()
    await expect(restore).toHaveCount(0)
    await row.click()
    await expect(drawer.getByTestId('feature-detail-content')).toContainText('Owner Feature')
    expect(mutationRequests.some((request) => request.method === 'PUT' && request.path.endsWith('/contributions'))).toBe(true)
    expect(mutationRequests.some((request) => request.method === 'PUT' && request.path.endsWith('/work-links'))).toBe(true)
    expect(mutationRequests.some((request) => request.method === 'PUT' && request.path.endsWith('/feature-work-links'))).toBe(true)
    expect(mutationRequests.some((request) => request.method === 'PUT' && request.path.endsWith('/requirement-bindings'))).toBe(true)
  })

  test('persists an owner create/edit/delete/restore journey through the live CSRF and Project APIs', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByRole('button', { name: /Open Business Business 01/ }).click()
    await expect(page).toHaveURL(/\/overview$/)
    const projectResponse = await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')
    expect(projectResponse.ok(), 'Project fixture resolution failed').toBe(true)
    const project = await projectResponse.json()
    const code = 'FEAT-E2E-REAL-' + Date.now().toString(36).slice(-8).toUpperCase()
    const requests = []
    const responses = []
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/csrf') || request.url().includes('/api/projects/' + project.id + '/features')) {
        requests.push(request)
      }
    })
    page.on('response', (response) => {
      if (response.url().includes('/api/auth/csrf') || response.url().includes('/api/projects/' + project.id + '/features')) {
        responses.push(response)
      }
    })

    await page.goto('/projects/' + project.id + '/feature-view')
    await expect(page.getByTestId('project-feature-view')).toHaveAttribute('data-view-state', 'empty')
    await page.getByRole('button', { name: 'Create Feature', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'Create Project Feature' })
    await create.getByLabel('Feature code').fill(code)
    await create.getByLabel('Title').fill('Live owner feature')
    await create.getByLabel('Problem').fill('A live persisted problem.')
    await create.getByLabel('Outcome').fill('A live persisted outcome.')
    await create.getByLabel('Primary Domain', { exact: true }).selectOption('DOM-CRM')
    const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/features') && response.request().method() === 'POST')
    await create.getByRole('button', { name: 'Create Feature', exact: true }).click()
    await expect(create.getByTestId('feature-review-summary')).toBeVisible()
    await create.getByRole('button', { name: 'Confirm save', exact: true }).click()
    const createResponse = await createResponsePromise
    expect(createResponse.status()).toBe(201)
    const createReceipt = await createResponse.json()
    expect(createReceipt.operation).toBe('CREATE_FEATURE')
    expect(createReceipt.resourceType).toBe('PROJECT_FEATURE')
    await expect(create).toHaveCount(0)
    const row = page.getByRole('button', { name: 'Open Feature ' + code, exact: true })
    await expect(row).toBeVisible()
    expect(requests.some((request) => request.url().endsWith('/api/auth/csrf') && request.method() === 'GET')).toBe(true)
    const createRequest = requests.find((request) => request.url().endsWith('/features') && request.method() === 'POST')
    expect(createRequest).toBeTruthy()
    expect(createRequest.headers()['x-csrf-token']).toBeTruthy()
    expect(createRequest.headers()['idempotency-key']).toMatch(/^pm-feature-.{8,}$/)
    expect(createRequest.headers()['if-match']).toBeUndefined()
    expect(createRequest.postDataJSON()).toEqual({
      code,
      title: 'Live owner feature',
      problem: 'A live persisted problem.',
      outcome: 'A live persisted outcome.',
      primaryDomainId: 'DOM-CRM',
      lifecycle: 'DRAFT',
    })

    await row.click()
    const drawer = page.getByRole('dialog', { name: 'Feature detail' })
    await expect(drawer).toContainText('Live owner feature')
    await drawer.getByRole('button', { name: 'Edit Feature', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit ' + code })
    await edit.getByLabel('Title').fill('Live owner feature edited')
    const editResponsePromise = page.waitForResponse((response) => response.url().endsWith('/features/' + createReceipt.resourceId) && response.request().method() === 'PATCH')
    await edit.getByRole('button', { name: 'Save Feature', exact: true }).click()
    await expect(edit.getByTestId('feature-review-summary')).toBeVisible()
    await edit.getByRole('button', { name: 'Confirm save', exact: true }).click()
    const editResponse = await editResponsePromise
    expect(editResponse.status()).toBe(200)
    const editReceipt = await editResponse.json()
    expect(editReceipt.version).toBe(2)
    await expect(edit).toHaveCount(0)
    await expect(drawer).toContainText('Live owner feature edited')
    const editRequest = requests.find((request) => request.url().endsWith('/features/' + createReceipt.resourceId) && request.method() === 'PATCH')
    expect(editRequest.headers()['if-match']).toMatch(/^"PROJECT_FEATURE\/.+\/v1"$/)
    expect(editRequest.headers()['idempotency-key']).toMatch(/^pm-feature-.{8,}$/)

    await drawer.getByRole('button', { name: 'Delete Feature', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: 'Delete ' + code })
    await deletion.getByRole('checkbox').check()
    const deleteResponsePromise = page.waitForResponse((response) => response.url().endsWith('/features/' + createReceipt.resourceId) && response.request().method() === 'DELETE')
    await deletion.getByRole('button', { name: 'Delete Feature', exact: true }).click()
    const deleteResponse = await deleteResponsePromise
    expect(deleteResponse.status()).toBe(200)
    const deleteReceipt = await deleteResponse.json()
    expect(deleteReceipt.version).toBe(editReceipt.version + 1)
    await expect(deletion).toHaveCount(0)
    await expect(drawer.locator('[data-detail-view-state="not-found"]')).toBeVisible()
    await drawer.getByRole('button', { name: 'Close feature detail', exact: true }).click()
    await expect(drawer).toHaveCount(0)
    const deleteRequest = requests.find((request) => request.url().endsWith('/features/' + createReceipt.resourceId) && request.method() === 'DELETE')
    expect(deleteRequest.headers()['if-match']).toBe('"PROJECT_FEATURE/' + createReceipt.resourceId + '/v' + editReceipt.version + '"')

    await page.getByRole('button', { name: 'Restore deleted Feature', exact: true }).click()
    const restore = page.getByRole('dialog', { name: 'Restore deleted Feature' })
    await expect(restore.getByTestId('feature-restore-select')).toContainText(code)
    await restore.getByLabel('Deleted Feature').selectOption(createReceipt.resourceId)
    const restoreResponsePromise = page.waitForResponse((response) => response.url().endsWith('/features/' + createReceipt.resourceId + '/restore') && response.request().method() === 'POST')
    await restore.getByRole('button', { name: 'Restore Feature', exact: true }).click()
    const restoreResponse = await restoreResponsePromise
    expect(restoreResponse.status()).toBe(200)
    await expect(restore).toHaveCount(0)
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByRole('dialog', { name: 'Feature detail' })).toContainText('Live owner feature edited')
    const restoreRequest = requests.find((request) => request.url().endsWith('/features/' + createReceipt.resourceId + '/restore') && request.method() === 'POST')
    expect(restoreRequest.headers()['if-match']).toBe('"PROJECT_FEATURE/' + createReceipt.resourceId + '/v' + deleteReceipt.version + '"')
    expect(restoreRequest.headers()['idempotency-key']).toMatch(/^pm-feature-.{8,}$/)
    expect(responses.some((response) => response.url().endsWith('/features/' + createReceipt.resourceId) && response.status() === 200)).toBe(true)
  })

  test('retains the exact uncertain graph intent across Escape, unrelated save, reopen and reconciliation', async ({ page }) => {
    const { mutationRequests, releaseUncertainResponse } = await openOwnerFeaturePage(page, { uncertainOperation: 'REPLACE_FEATURE_WORK_GRAPH', holdUncertainResponse: true })
    await page.getByRole('button', { name: 'Open Feature FEAT-E2E-001', exact: true }).click()
    let drawer = page.getByRole('dialog', { name: 'Feature detail' })
    await drawer.getByRole('button', { name: 'Edit Work graph', exact: true }).click()
    let graph = page.getByRole('dialog', { name: 'Cross-Feature Work graph' })
    await graph.getByRole('button', { name: 'Save Work graph', exact: true }).click()
    await expect(graph.getByTestId('feature-review-summary')).toBeVisible()
    await graph.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect.poll(() => mutationRequests.filter((request) => request.path.endsWith('/feature-work-links')).length).toBe(1)
    const firstRequest = mutationRequests.find((request) => request.path.endsWith('/feature-work-links'))
    expect(firstRequest).toBeTruthy()

    await page.keyboard.press('Escape')
    await expect(graph).toHaveCount(0)

    await drawer.getByRole('button', { name: 'Edit Feature', exact: true }).click()
    const unrelatedEdit = page.getByRole('dialog', { name: /Edit FEAT-E2E-001/ })
    await unrelatedEdit.getByLabel('Title').fill('Owner Feature unrelated save')
    await unrelatedEdit.getByRole('button', { name: 'Save Feature', exact: true }).click()
    await expect(unrelatedEdit.getByTestId('feature-review-summary')).toBeVisible()
    await unrelatedEdit.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect(unrelatedEdit).toHaveCount(0)
    await expect(drawer).toContainText('Owner Feature unrelated save')

    await drawer.getByRole('button', { name: 'Edit Work graph', exact: true }).click()
    graph = page.getByRole('dialog', { name: 'Cross-Feature Work graph' })
    await expect(graph.getByTestId('feature-mutation-reconciliation')).toBeVisible()
    await expect(graph.getByTestId('feature-pending-intent-summary')).toContainText('Features in graph: 1')
    await expect(graph.getByRole('button', { name: 'Save Work graph', exact: true })).toBeDisabled()
    releaseUncertainResponse()
    await expect(graph.getByTestId('feature-mutation-error')).toContainText('Response uncertain')
    await graph.getByRole('button', { name: 'Check save result', exact: true }).click()
    await expect(graph).toHaveCount(0)

    const graphRequests = mutationRequests.filter((request) => request.path.endsWith('/feature-work-links'))
    expect(graphRequests).toHaveLength(2)
    expect(graphRequests[1].method).toBe(graphRequests[0].method)
    expect(graphRequests[1].body).toEqual(graphRequests[0].body)
    expect(graphRequests[1].headers['idempotency-key']).toBe(graphRequests[0].headers['idempotency-key'])
    expect(graphRequests[1].headers['if-match']).toBe(graphRequests[0].headers['if-match'])
  })

  test('links a typed 422 field refusal to its control and focuses the first invalid field', async ({ page }) => {
    await openOwnerFeaturePage(page, { invalidOperation: 'REPLACE_WORK_LINKS' })
    await page.getByRole('button', { name: 'Open Feature FEAT-E2E-001', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Feature detail' })
    await drawer.getByRole('button', { name: 'Edit Work links', exact: true }).click()
    const links = page.getByRole('dialog', { name: /WorkItem links/ })
    await links.getByRole('button', { name: 'Add WorkItem link' }).click()
    await links.getByLabel('WorkItem 1', { exact: true }).selectOption(WORK_ID)
    await links.getByLabel('Allocation bps').fill('10000')
    await links.getByRole('button', { name: 'Save Work links', exact: true }).click()
    await links.getByRole('button', { name: 'Confirm save', exact: true }).click()
    await expect(links.getByTestId('feature-mutation-error')).toBeVisible()
    const allocation = links.getByLabel('Allocation bps')
    await expect(allocation).toHaveAttribute('aria-invalid', 'true')
    await expect(allocation).toHaveAttribute('aria-describedby', 'feature-field-error-links-0-allocationBps')
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('links.0.allocationBps')
  })

  test('offers only the monotonic RETIRED lifecycle transition', async ({ page }) => {
    await openOwnerFeaturePage(page, { featureOverrides: { lifecycle: 'RETIRED' } })
    await page.getByRole('button', { name: 'Open Feature FEAT-E2E-001', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Feature detail' })
    await drawer.getByRole('button', { name: 'Edit Feature', exact: true }).click()
    const edit = page.getByRole('dialog', { name: /Edit FEAT-E2E-001/ })
    await expect(edit.getByLabel('Lifecycle')).toHaveValue('RETIRED')
    await expect(edit.getByLabel('Lifecycle').locator('option')).toHaveCount(1)
  })

  test('keeps the relationship picker and form within a 390px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openOwnerFeaturePage(page)
    await page.getByRole('button', { name: 'Open Feature FEAT-E2E-001', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Feature detail' })
    await drawer.getByRole('button', { name: 'Edit Work links', exact: true }).click()
    const links = page.getByRole('dialog', { name: /WorkItem links/ })
    await links.getByRole('button', { name: 'Add WorkItem link' }).click()
    await expect(links.getByLabel('WorkItem 1', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})
