'use client'

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Field } from '@/components/ui'
import { DomainPicker, WorkItemPicker } from './ProjectFeaturePickers'

// @req FR-252 — an owner can submit the bounded Project Feature mutation
// commands through the existing Project scope without manufacturing authority,
// evidence, version, or audit fields in the browser.
// @spec ADR-097, SDD-019, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/unit/project-feature-forms.test.js, tests/e2e/project-feature-mutations.spec.js

const FORM_FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
const FEATURE_LIFECYCLES = ['DRAFT', 'ACTIVE', 'RETIRED']
const ALLOCATION_MODES = ['UNALLOCATED', 'COMPLETE_SPLIT']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX_SHA_RE = /^[0-9a-f]{64}$/
const COMMIT_RE = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const PendingMutationContext = createContext(null)

export const FEATURE_FORM_ACTIONS = Object.freeze({
  CREATE: 'create',
  EDIT: 'edit',
  CONTRIBUTIONS: 'contributions',
  WORK_LINKS: 'work-links',
  GRAPH: 'graph',
  REQUIREMENTS: 'requirements',
  SNAPSHOTS: 'snapshots',
  CAPTURE: 'capture',
  DELETE: 'delete',
  RESTORE: 'restore',
})

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function encoded(value) {
  return encodeURIComponent(String(value))
}

export function featurePath(projectId, featureId) {
  return '/api/projects/' + encoded(projectId) + '/features/' + encoded(featureId)
}

export function featureViewPath(projectId) {
  return '/api/projects/' + encoded(projectId) + '/feature-view'
}

export function featureCollectionPath(projectId) {
  return '/api/projects/' + encoded(projectId) + '/features'
}

export function contributionsPath(projectId, featureId) {
  return featurePath(projectId, featureId) + '/contributions'
}

export function workLinksPath(projectId, featureId) {
  return featurePath(projectId, featureId) + '/work-links'
}

export function requirementsPath(projectId, featureId) {
  return featurePath(projectId, featureId) + '/requirement-bindings'
}

export function graphPath(projectId) {
  return '/api/projects/' + encoded(projectId) + '/feature-work-links'
}

export function snapshotPath(projectId, cursor = null) {
  const path = '/api/projects/' + encoded(projectId) + '/governance-snapshots'
  return cursor ? path + '?cursor=' + encoded(cursor) : path
}

export function deletedFeaturesPath(projectId, cursor = null) {
  const path = featureCollectionPath(projectId) + '?visibility=DELETED&limit=50'
  return cursor ? path + '&cursor=' + encoded(cursor) : path
}

export function isGraphEtag(value) {
  return typeof value === 'string' && /^"PROJECT_FEATURE_GRAPH\/[^/]+\/[0-9a-f]{64}"$/.test(value)
}

export function isFeatureEtag(value, featureId = null) {
  if (typeof value !== 'string') return false
  const match = value.match(/^"PROJECT_FEATURE\/([^/]+)\/v([1-9][0-9]*)"$/)
  return Boolean(match && (!featureId || match[1] === String(featureId)))
}

export function makeIdempotencyKey(randomUuid = null) {
  const generated = typeof randomUuid === 'function'
    ? randomUuid()
    : typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : 'fallback-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  return 'pm-feature-' + String(generated)
}

function mutationKey(projectId, operation, featureId = '') {
  return [String(projectId || ''), operation, String(featureId || '')].join(':')
}

export class FeatureMutationError extends Error {
  constructor(message, {
    status = null,
    payload = null,
    uncertain = false,
    attempt = null,
    requestId = null,
  } = {}) {
    super(message)
    this.name = 'FeatureMutationError'
    this.status = status
    this.payload = payload
    this.uncertain = uncertain
    this.attempt = attempt
    this.requestId = requestId
  }
}

export class FeatureInputError extends Error {
  constructor(message, fields = []) {
    super(message)
    this.name = 'FeatureInputError'
    this.status = 422
    this.payload = { code: 'INVALID_FIELD', message, fields }
    this.uncertain = false
  }
}

function headerValue(headers, name) {
  if (!headers || typeof headers.get !== 'function') return null
  return headers.get(name)
}

function isTypedRefusal(payload) {
  if (!isRecord(payload)
    || typeof payload.code !== 'string' || payload.code.length === 0
    || typeof payload.message !== 'string' || payload.message.length === 0
    || !UUID_RE.test(payload.requestId)
    || typeof payload.retryable !== 'boolean') return false
  const allowed = new Set(['code', 'message', 'requestId', 'retryable', 'currentVersion', 'currentEtag', 'fields'])
  return Object.keys(payload).every((key) => allowed.has(key))
}

async function readResponseJson(response) {
  return response?.json ? response.json().catch(() => null) : null
}

export async function requestFeatureJson(path, {
  method = 'GET',
  body,
  headers = {},
} = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new FeatureMutationError('The browser request service is unavailable.', { status: 503, uncertain: false })
  }
  const requestHeaders = { Accept: 'application/json', ...headers }
  if (body !== undefined && body !== null) requestHeaders['Content-Type'] = 'application/json'
  let response
  try {
    response = await fetchImpl(path, {
      method,
      headers: requestHeaders,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch (error) {
    throw new FeatureMutationError('The request did not receive a response.', {
      uncertain: true,
      payload: null,
    })
  }
  const payload = await readResponseJson(response)
  const requestId = headerValue(response.headers, 'x-request-id') || payload?.requestId || null
  if (!response.ok) {
    throw new FeatureMutationError(payload?.message || payload?.error || 'The request was refused.', {
      status: response.status,
      payload,
      requestId,
      uncertain: !isTypedRefusal(payload),
    })
  }
  return {
    data: payload,
    status: response.status,
    etag: headerValue(response.headers, 'etag'),
    requestId,
  }
}

export async function readCsrfToken(fetchImpl = globalThis.fetch) {
  const result = await requestFeatureJson('/api/auth/csrf', {}, fetchImpl)
  if (!isRecord(result.data) || typeof result.data.token !== 'string' || result.data.token.length === 0) {
    throw new FeatureMutationError('The CSRF token response was incomplete.', {
      status: 503,
      payload: result.data,
      uncertain: false,
    })
  }
  return result.data.token
}

function withAttempt(error, attempt) {
  if (error instanceof FeatureMutationError) {
    if (!error.attempt) error.attempt = attempt
    return error
  }
  return new FeatureMutationError('The mutation request did not complete.', {
    uncertain: true,
    attempt,
  })
}

export function isMutationReceipt(value, expectedOperation = null) {
  if (!isRecord(value)) return false
  const required = ['receiptId', 'targetId', 'targetType', 'operation', 'httpMethod', 'resourceId', 'resourceType', 'status', 'version', 'etag', 'recordedAt', 'auditRef', 'requestId']
  if (!required.every((key) => hasOwn(value, key))) return false
  if (!UUID_RE.test(value.receiptId) || !UUID_RE.test(value.targetId) || !UUID_RE.test(value.resourceId) || !UUID_RE.test(value.requestId)) return false
  if (value.status !== 'COMMITTED' || typeof value.etag !== 'string' || value.etag.length === 0 || typeof value.recordedAt !== 'string' || typeof value.auditRef !== 'string' || value.auditRef.length === 0) return false
  if (!['PROJECT', 'FEATURE'].includes(value.targetType) || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(value.httpMethod)) return false
  if (!['PROJECT_FEATURE', 'PROJECT_FEATURE_GRAPH', 'GOVERNANCE_SNAPSHOT'].includes(value.resourceType)) return false
  if (expectedOperation && value.operation !== expectedOperation) return false
  const expected = {
    CREATE_FEATURE: ['PROJECT', 'POST', 'PROJECT_FEATURE'],
    UPDATE_FEATURE: ['FEATURE', 'PATCH', 'PROJECT_FEATURE'],
    REPLACE_CONTRIBUTIONS: ['FEATURE', 'PUT', 'PROJECT_FEATURE'],
    REPLACE_WORK_LINKS: ['FEATURE', 'PUT', 'PROJECT_FEATURE'],
    REPLACE_FEATURE_WORK_GRAPH: ['PROJECT', 'PUT', 'PROJECT_FEATURE_GRAPH'],
    REPLACE_REQUIREMENT_BINDINGS: ['FEATURE', 'PUT', 'PROJECT_FEATURE'],
    DELETE_FEATURE: ['FEATURE', 'DELETE', 'PROJECT_FEATURE'],
    RESTORE_FEATURE: ['FEATURE', 'POST', 'PROJECT_FEATURE'],
    CAPTURE_GOVERNANCE_SNAPSHOT: ['PROJECT', 'POST', 'GOVERNANCE_SNAPSHOT'],
  }[value.operation]
  if (!expected || value.targetType !== expected[0] || value.httpMethod !== expected[1] || value.resourceType !== expected[2]) return false
  const graphLike = value.operation === 'REPLACE_FEATURE_WORK_GRAPH' || value.operation === 'CAPTURE_GOVERNANCE_SNAPSHOT'
  if (graphLike ? value.version !== null : !(Number.isInteger(value.version) && value.version >= 1)) return false
  const allowed = new Set(required)
  return Object.keys(value).every((key) => allowed.has(key))
}

export function isSnapshotCaptureResult(value) {
  if (!isRecord(value) || !hasOwn(value, 'snapshot') || !hasOwn(value, 'receipt')) return false
  const snapshot = value.snapshot
  return isRecord(snapshot)
    && typeof snapshot.id === 'string'
    && UUID_RE.test(snapshot.id)
    && typeof snapshot.repositoryId === 'string'
    && UUID_RE.test(snapshot.repositoryId)
    && typeof snapshot.commitSha === 'string'
    && COMMIT_RE.test(snapshot.commitSha)
    && typeof snapshot.manifestHash === 'string'
    && HEX_SHA_RE.test(snapshot.manifestHash)
    && snapshot.validationStatus === 'VALID'
    && isRecord(snapshot.sourceManifest)
    && typeof snapshot.sourceManifest.schemaVersion === 'string'
    && Array.isArray(snapshot.sourceManifest.entries)
    && isMutationReceipt(value.receipt, 'CAPTURE_GOVERNANCE_SNAPSHOT')
    && snapshot.id === value.receipt.resourceId
}

export async function sendFeatureMutation({
  path,
  method,
  body = null,
  ifMatch = null,
  idempotencyKey = makeIdempotencyKey(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const attempt = { path, method, body, ifMatch, idempotencyKey }
  try {
    const csrfToken = await readCsrfToken(fetchImpl)
    const headers = {
      'X-CSRF-Token': csrfToken,
      'Idempotency-Key': idempotencyKey,
    }
    if (ifMatch) headers['If-Match'] = ifMatch
    let result
    try {
      result = await requestFeatureJson(path, { method, body, headers }, fetchImpl)
    } catch (error) {
      throw withAttempt(error, attempt)
    }
    return { ...result, attempt }
  } catch (error) {
    throw withAttempt(error, attempt)
  }
}

export function buildFeatureCreateInput(values) {
  const body = {
    code: text(values?.code),
    title: text(values?.title),
    problem: text(values?.problem),
    outcome: text(values?.outcome),
    primaryDomainId: text(values?.primaryDomainId),
    lifecycle: 'DRAFT',
  }
  const canonicalFeatureKey = text(values?.canonicalFeatureKey)
  const governanceSnapshotId = text(values?.governanceSnapshotId)
  if (canonicalFeatureKey || governanceSnapshotId) {
    body.canonicalFeatureKey = canonicalFeatureKey || null
    body.governanceSnapshotId = governanceSnapshotId || null
  }
  return body
}

export function buildFeaturePatchInput(values) {
  return {
    title: text(values?.title),
    problem: text(values?.problem),
    outcome: text(values?.outcome),
    primaryDomainId: text(values?.primaryDomainId),
    lifecycle: text(values?.lifecycle),
  }
}

function nonEmptyRows(rows, keys) {
  return (Array.isArray(rows) ? rows : []).filter((row) => keys.some((key) => text(row?.[key]) !== ''))
}

export function buildContributionsInput(rows) {
  return {
    contributions: nonEmptyRows(rows, ['domainId', 'responsibility']).map((row) => ({
      domainId: text(row.domainId),
      responsibility: text(row.responsibility),
    })),
  }
}

export function buildWorkLinksInput({ allocationMode, rows }) {
  return {
    allocationMode: ALLOCATION_MODES.includes(allocationMode) ? allocationMode : 'UNALLOCATED',
    links: nonEmptyRows(rows, ['workItemId', 'allocationBps']).map((row) => ({
      workItemId: text(row.workItemId),
      allocationBps: text(row.allocationBps) === '' ? null : Number(row.allocationBps),
    })),
  }
}

export function buildGraphInput({ allocationMode, sets }) {
  const selectedSets = (Array.isArray(sets) ? sets : []).filter((set) => text(set?.featureId) !== '')
  const featureSets = selectedSets.map((set) => ({
    featureId: text(set.featureId),
    links: (Array.isArray(set.links) ? set.links : []).filter((row) => text(row?.workItemId) !== '' || text(row?.allocationBps) !== '').map((row) => ({
      workItemId: text(row.workItemId),
      allocationBps: text(row.allocationBps) === '' ? null : Number(row.allocationBps),
    })),
  }))
  const affectedWorkItemIds = [...new Set(selectedSets.flatMap((set, index) => [
    ...(Array.isArray(set?.originalWorkItemIds) ? set.originalWorkItemIds : []),
    ...(featureSets[index]?.links || []).map((link) => link.workItemId),
  ]).filter(Boolean))]
  return {
    allocationMode: ALLOCATION_MODES.includes(allocationMode) ? allocationMode : 'UNALLOCATED',
    affectedWorkItemIds,
    featureSets,
  }
}

export function buildRequirementBindingsInput(rows) {
  return {
    bindings: nonEmptyRows(rows, ['governanceSnapshotId', 'sourceNamespace', 'requirementKey', 'revisionHash', 'acceptanceRef']).map((row) => ({
      governanceSnapshotId: text(row.governanceSnapshotId),
      sourceNamespace: text(row.sourceNamespace),
      requirementKey: text(row.requirementKey),
      revisionHash: text(row.revisionHash),
      acceptanceRef: text(row.acceptanceRef),
    })),
  }
}

export function parseSourceManifest(value) {
  let parsed
  try {
    parsed = JSON.parse(String(value || ''))
  } catch {
    throw new FeatureInputError('Source manifest must be valid JSON.', [
      { path: 'sourceManifest', code: 'INVALID_JSON', message: 'Enter valid JSON.' },
    ])
  }
  if (!isRecord(parsed) || typeof parsed.schemaVersion !== 'string' || !Array.isArray(parsed.entries)) {
    throw new FeatureInputError('Source manifest must contain schemaVersion and entries.', [
      { path: 'sourceManifest', code: 'INVALID_MANIFEST', message: 'Include schemaVersion and entries.' },
    ])
  }
  return parsed
}

export function buildSnapshotCaptureInput(values) {
  const sourceManifest = parseSourceManifest(values?.sourceManifest)
  return {
    repositoryId: text(values?.repositoryId),
    commitSha: text(values?.commitSha),
    manifestHash: text(values?.manifestHash),
    sourceManifest,
  }
}

export function describeMutationError(error) {
  const payload = isRecord(error?.payload) ? error.payload : {}
  const status = error?.status
  const code = payload.code || null
  const fields = Array.isArray(payload.fields) ? payload.fields.slice(0, 50) : []
  if (error?.uncertain) {
    return {
      state: 'uncertain',
      title: 'Response uncertain',
      detail: 'The server may have received this intent. Keep the same key and values while reconciling; do not start a new intent.',
      fields,
      code,
      retryable: true,
    }
  }
  if (status === 401) return { state: 'forbidden', title: 'Authentication required', detail: 'Sign in again before submitting this Project Feature change.', fields, code, retryable: false }
  if (status === 403) return { state: 'forbidden', title: 'Mutation capability unavailable', detail: payload.message || 'This owner action is unavailable to the current viewer.', fields, code, retryable: false }
  if (status === 404) return { state: 'not-found', title: 'Feature target unavailable', detail: payload.message || 'The Feature is missing or outside the current authorized Project.', fields, code, retryable: false }
  if (status === 409) return { state: 'conflict', title: 'Change conflicts with current data', detail: payload.message || 'Reload the current Feature or graph before making a new change.', fields, code, retryable: false }
  if (status === 412) return { state: 'stale', title: 'Feature changed elsewhere', detail: 'Reload the current version or keep these values and review them before submitting again.', fields, code, retryable: false }
  if (status === 422) return { state: 'invalid', title: 'Review the highlighted fields', detail: payload.message || 'The server rejected one or more Project Feature invariants.', fields, code, retryable: false }
  if (status === 428) return { state: 'precondition', title: 'Current version required', detail: 'Reload the Feature to obtain a fresh compare-and-set token.', fields, code, retryable: false }
  if (status === 413) return { state: 'bounded-unavailable', title: 'Evidence input is too large', detail: 'Reduce the submitted manifest or relationship set and try again deliberately.', fields, code, retryable: false }
  if (status === 410) return { state: 'gone', title: 'This Feature is no longer available', detail: 'Reload the Project before choosing another available target.', fields, code, retryable: false }
  if (status === 429) return { state: 'rate-limited', title: 'Please wait before trying again', detail: 'No mutation was retried automatically. Submit the same values as a new deliberate intent when ready.', fields, code, retryable: true }
  if (status === 503) return { state: 'unavailable', title: 'Feature service unavailable', detail: payload.message || 'The server could not complete this change. Preserve the values and try again deliberately.', fields, code, retryable: true }
  return { state: 'request-failed', title: 'Feature change failed', detail: payload.message || error?.message || 'The server could not complete this change.', fields, code, retryable: false }
}

export function normalizeFieldPath(path) {
  return String(path || '').replace(/\[([0-9]+)\]/g, '.$1').replace(/^\./, '')
}

export function fieldErrorFor(errorOrMutation, path) {
  const fields = Array.isArray(errorOrMutation?.fields)
    ? errorOrMutation.fields
    : Array.isArray(errorOrMutation?.error?.fields) ? errorOrMutation.error.fields : []
  const expected = normalizeFieldPath(path)
  return fields.find((field) => normalizeFieldPath(field?.path) === expected)
    || fields.find((field) => normalizeFieldPath(field?.path).startsWith(expected + '.'))
    || null
}

function fieldErrorId(path) {
  return 'feature-field-error-' + normalizeFieldPath(path).replace(/[^a-zA-Z0-9_-]+/g, '-')
}

export function fieldControlProps(errorOrMutation, path) {
  const error = fieldErrorFor(errorOrMutation, path)
  return {
    name: path,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error ? fieldErrorId(path) : undefined,
  }
}

function FieldError({ mutation, path }) {
  const error = fieldErrorFor(mutation, path)
  if (!error) return null
  return <p id={fieldErrorId(path)} className="mt-1 text-[10px]" data-testid="feature-field-error">{error.message || 'Review this field.'}</p>
}

export function editableLifecycles(lifecycle) {
  if (lifecycle === 'RETIRED') return ['RETIRED']
  if (lifecycle === 'ACTIVE') return ['ACTIVE', 'RETIRED']
  return FEATURE_LIFECYCLES
}

export function allocationSummary(features, overrides = []) {
  const replacementIds = new Set((Array.isArray(overrides) ? overrides : []).map((set) => String(set?.featureId)))
  const links = []
  for (const feature of Array.isArray(features) ? features : []) {
    if (replacementIds.has(String(feature?.id))) continue
    for (const link of Array.isArray(feature?.workLinks) ? feature.workLinks : []) links.push(link)
  }
  for (const set of Array.isArray(overrides) ? overrides : []) {
    for (const link of Array.isArray(set?.links) ? set.links : []) links.push(link)
  }
  const totals = new Map()
  for (const link of links) {
    const workItemId = text(link?.workItemId)
    if (!workItemId) continue
    const current = totals.get(workItemId) || { workItemId, total: 0, hasUnallocated: false }
    const value = link?.allocationBps === '' || link?.allocationBps === undefined ? null : link?.allocationBps
    if (value === null || value === undefined) current.hasUnallocated = true
    else if (Number.isFinite(Number(value))) current.total += Number(value)
    totals.set(workItemId, current)
  }
  return [...totals.values()]
    .sort((a, b) => a.workItemId < b.workItemId ? -1 : a.workItemId > b.workItemId ? 1 : 0)
    .map((row) => ({ ...row, remainder: 10000 - row.total }))
}

export function updateRequirementBindingRow(row, key, value) {
  const next = { ...(row || {}), [key]: value }
  if (['governanceSnapshotId', 'sourceNamespace', 'requirementKey', 'revisionHash'].includes(key)) {
    next.canonicalSubject = null
    next.bindingState = 'UNAVAILABLE'
  }
  return next
}

function storedAttempt(entry) {
  return entry?.attempt || entry || null
}

function pendingIntentSummary(attempt) {
  const body = attempt?.body
  if (!isRecord(body)) return []
  if (hasOwn(body, 'code')) return ['Feature: ' + text(body.code), 'Title: ' + text(body.title), 'Primary Domain: ' + text(body.primaryDomainId)]
  if (Array.isArray(body.contributions)) return ['Supporting Domain responsibilities: ' + body.contributions.length]
  if (Array.isArray(body.links)) return ['WorkItem links: ' + body.links.length, 'Allocation mode: ' + text(body.allocationMode).replace(/_/g, ' ')]
  if (Array.isArray(body.featureSets)) return ['Features in graph: ' + body.featureSets.length, 'WorkItem links: ' + body.featureSets.reduce((total, set) => total + (Array.isArray(set?.links) ? set.links.length : 0), 0)]
  if (Array.isArray(body.bindings)) return ['Requirement bindings: ' + body.bindings.length]
  if (hasOwn(body, 'repositoryId')) return ['Repository: ' + text(body.repositoryId), 'Commit: ' + text(body.commitSha), 'Manifest hash: ' + text(body.manifestHash)]
  return []
}

function ReviewSummary({ items, onEdit }) {
  return (
    <section className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2" role="status" data-testid="feature-review-summary">
      <p className="text-xs font-bold">Review before saving</p>
      <ul className="mt-1 list-disc pl-4 text-[11px] text-muted">
        {(Array.isArray(items) ? items : []).map((item, index) => <li key={index}>{item}</li>)}
      </ul>
      <button type="button" className="btn mt-2 text-[11px]" onClick={onEdit}>Edit values</button>
    </section>
  )
}

export async function rereadAfterReceipt(projectId, operation, receipt, fetchImpl) {
  if (operation === 'CAPTURE_GOVERNANCE_SNAPSHOT') {
    return requestFeatureJson(snapshotPath(projectId), {}, fetchImpl)
  }
  if (operation === 'REPLACE_FEATURE_WORK_GRAPH') {
    return requestFeatureJson(featureViewPath(projectId), {}, fetchImpl)
  }
  if (!receipt?.resourceId) return null
  try {
    return await requestFeatureJson(featurePath(projectId, receipt.resourceId), {}, fetchImpl)
  } catch (error) {
    if (operation === 'DELETE_FEATURE' && error?.status === 404) return { data: null, status: 404, etag: null, requestId: error.requestId }
    throw new FeatureMutationError('The committed change could not be reread.', {
      status: error?.status || null,
      payload: error?.payload || null,
      uncertain: true,
      attempt: error?.attempt || null,
      requestId: error?.requestId || null,
    })
  }
}

export function pendingMutationAttempt(error, attempt) {
  return error?.uncertain ? attempt : null
}

function receiptForResult(operation, data) {
  if (operation === 'CAPTURE_GOVERNANCE_SNAPSHOT') {
    if (!isSnapshotCaptureResult(data)) throw new FeatureMutationError('The snapshot capture response was incomplete.', { uncertain: true })
    return data.receipt
  }
  if (!isMutationReceipt(data, operation)) throw new FeatureMutationError('The mutation receipt response was incomplete.', { uncertain: true })
  return data
}

function useFeatureMutation({ projectId, intentKey, onSaved }) {
  const pendingStore = useContext(PendingMutationContext)
  const [state, setState] = useState(() => ({ busy: false, error: null, pendingAttempt: storedAttempt(pendingStore?.get(intentKey)), outcome: null }))

  const runAttempt = useCallback(async (attempt) => {
    const existing = pendingStore?.get(intentKey)
    if (existing?.promise) return existing.promise
    const execution = Promise.resolve().then(async () => {
      setState((current) => ({ ...current, busy: true, error: null, outcome: null, pendingAttempt: attempt }))
      try {
        const result = await sendFeatureMutation({ ...attempt })
        const receipt = receiptForResult(attempt.operation, result.data)
        const current = await rereadAfterReceipt(projectId, attempt.operation, receipt, attempt.fetchImpl)
        await onSaved?.({ operation: attempt.operation, receipt, current, raw: result.data })
        pendingStore?.delete(intentKey)
        setState({ busy: false, error: null, pendingAttempt: null, outcome: { operation: attempt.operation, receipt } })
        return { ...result, receipt, current }
      } catch (error) {
        const normalized = withAttempt(error, attempt)
        const retainedAttempt = pendingMutationAttempt(normalized, attempt)
        const currentEntry = pendingStore?.get(intentKey)
        if (retainedAttempt) pendingStore?.set(intentKey, { attempt: retainedAttempt })
        else if (!currentEntry || currentEntry.attempt === attempt) pendingStore?.delete(intentKey)
        setState((current) => ({
          ...current,
          busy: false,
          error: describeMutationError(normalized),
          pendingAttempt: retainedAttempt,
        }))
        throw normalized
      }
    })
    pendingStore?.set(intentKey, { attempt, promise: execution })
    return execution
  }, [intentKey, onSaved, pendingStore, projectId])

  useEffect(() => {
    const entry = pendingStore?.get(intentKey)
    if (!entry?.promise) return undefined
    let active = true
    entry.promise.then((result) => {
      if (!active) return
      setState({ busy: false, error: null, pendingAttempt: null, outcome: result?.receipt ? { operation: entry.attempt.operation, receipt: result.receipt } : null })
    }).catch((error) => {
      if (!active) return
      setState((current) => ({
        ...current,
        busy: false,
        error: describeMutationError(error),
        pendingAttempt: storedAttempt(pendingStore?.get(intentKey)),
      }))
    })
    return () => { active = false }
  }, [intentKey, pendingStore])

  const submit = useCallback((input) => {
    if (state.pendingAttempt) return Promise.resolve(null)
    const attempt = {
      path: input.path,
      method: input.method,
      body: input.body ?? null,
      ifMatch: input.ifMatch || null,
      idempotencyKey: input.idempotencyKey || makeIdempotencyKey(),
      fetchImpl: input.fetchImpl || globalThis.fetch,
      operation: input.operation,
    }
    return runAttempt(attempt)
  }, [runAttempt, state.pendingAttempt])

  const reconcile = useCallback(async () => {
    if (!state.pendingAttempt) return null
    try {
      return await runAttempt(state.pendingAttempt)
    } catch {
      return null
    }
  }, [runAttempt, state.pendingAttempt])

  return { ...state, submit, reconcile }
}

function FormDialog({ title, onClose, children, wide = true }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  const titleId = 'feature-form-title-' + useId().replace(/:/g, '')

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const frame = requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector('input:not([type="hidden"]), select, textarea, button:not([aria-label="Close dialog"])')
      ;(first || dialogRef.current?.querySelector(FORM_FOCUSABLE_SELECTOR))?.focus()
    })
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(dialogRef.current?.querySelectorAll(FORM_FOCUSABLE_SELECTOR) || [])
      if (items.length < 2) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div className="modal-backdrop flex items-start justify-center overflow-y-auto p-4 pt-[6vh] backdrop-blur-sm" data-testid="feature-form-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className={'modal-surface w-full ' + (wide ? 'max-w-3xl' : 'max-w-lg') + ' p-5'} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()} data-testid="feature-form-dialog">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-sm font-bold">{title}</h2>
          <button type="button" className="btn shrink-0 px-2 py-1" onClick={onClose} aria-label="Close dialog">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormActions({ onClose, busy, submitLabel = 'Save', danger = false, disabled = false, pendingAttempt = false }) {
  const submitDisabled = busy || disabled || pendingAttempt
  return (
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="submit" className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')} disabled={submitDisabled}>{busy ? 'Saving…' : submitLabel}</button>
    </div>
  )
}

function MutationNotice({ mutation }) {
  return (
    <>
      {mutation.error && (
        <div className="mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert" data-testid="feature-mutation-error">
          <p className="font-bold">{mutation.error.title}</p>
          <p className="mt-1">{mutation.error.detail}</p>
          {mutation.error.fields?.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {mutation.error.fields.map((field, index) => <li key={field.path + '-' + index}>{field.path}: {field.message}</li>)}
            </ul>
          )}
        </div>
      )}
      {mutation.pendingAttempt && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2 text-[11px]" role="status" data-testid="feature-mutation-reconciliation">
          <p className="font-bold">Response uncertain</p>
          <p className="mt-1 text-muted">Keep these values while checking whether the save was applied.</p>
          {pendingIntentSummary(mutation.pendingAttempt).length > 0 && <ul className="mt-1 list-disc pl-4 text-muted" data-testid="feature-pending-intent-summary">{pendingIntentSummary(mutation.pendingAttempt).map((item, index) => <li key={index}>{item}</li>)}</ul>}
          <button type="button" className="btn mt-2 text-[11px]" onClick={() => mutation.reconcile()} disabled={mutation.busy}>Check save result</button>
        </div>
      )}
      {mutation.outcome && (
        <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2 text-[11px]" role="status" data-testid="feature-mutation-saved">
          Saved successfully. The latest Feature details are loaded.
        </p>
      )}
    </>
  )
}

function FormFrame({ title, onClose, onSubmit, mutation, children, submitLabel, danger, disabled = false, wide = true, review = null, onEditReview }) {
  const formRef = useRef(null)

  useEffect(() => {
    const path = mutation.error?.fields?.[0]?.path
    if (!path) return undefined
    if (review) {
      onEditReview?.()
      return undefined
    }
    const frame = requestAnimationFrame(() => {
      const expected = normalizeFieldPath(path)
      const control = Array.from(formRef.current?.querySelectorAll('[name]') || [])
        .find((element) => normalizeFieldPath(element.getAttribute('name')) === expected)
        || Array.from(formRef.current?.querySelectorAll('[data-feature-field-path]') || [])
          .find((element) => normalizeFieldPath(element.getAttribute('data-feature-field-path')) === expected)
          ?.querySelector('input, select, textarea, button')
      control?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [mutation.error, onEditReview, review])

  const submit = (event) => onSubmit(event, Boolean(review))
  return (
    <FormDialog title={title} onClose={onClose} wide={wide}>
      <form ref={formRef} onSubmit={submit}>
        {review ? <ReviewSummary items={review} onEdit={onEditReview} /> : children}
        <MutationNotice mutation={mutation} />
        <FormActions onClose={onClose} busy={mutation.busy} submitLabel={review ? 'Confirm save' : submitLabel} danger={danger} disabled={disabled} pendingAttempt={Boolean(mutation.pendingAttempt)} />
      </form>
    </FormDialog>
  )
}

function addRow(rows, empty) {
  return [...rows, { ...empty }]
}

function removeRow(rows, index) {
  return rows.filter((_, rowIndex) => rowIndex !== index)
}

function featureLinks(feature) {
  return (feature?.workLinks || []).map((link) => ({
    workItemId: link.workItemId || '',
    allocationBps: link.allocationBps == null ? '' : String(link.allocationBps),
  }))
}

function featureContributions(feature) {
  return (feature?.contributions || []).map((row) => ({
    domainId: row.domainId || '',
    responsibility: row.responsibility || '',
  }))
}

function supportingDomainExclusions(feature, rows, index) {
  return [
    feature?.primaryDomain?.domainId,
    ...(Array.isArray(rows) ? rows : []).filter((_, rowIndex) => rowIndex !== index).map((row) => row.domainId),
  ].filter(Boolean)
}

function featureBindings(feature) {
  return (feature?.requirementBindings || []).map((row) => ({
    governanceSnapshotId: row.governanceSnapshotId || '',
    sourceNamespace: row.sourceNamespace || '',
    requirementKey: row.requirementKey || '',
    revisionHash: row.revisionHash || '',
    acceptanceRef: row.acceptanceRef || '',
    canonicalSubject: row.canonicalSubject || null,
    bindingState: row.bindingState || 'UNAVAILABLE',
  }))
}

function CreateFeatureForm({ projectId, snapshotsState, onClose, onSaved }) {
  const [values, setValues] = useState({ code: '', title: '', problem: '', outcome: '', primaryDomainId: '', canonicalFeatureKey: '', governanceSnapshotId: '' })
  const [review, setReview] = useState(null)
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'CREATE_FEATURE'), onSaved })
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }))
  const submit = async (event, confirming = false) => {
    event.preventDefault()
    const body = buildFeatureCreateInput(values)
    if (Object.entries(body).some(([key, value]) => key !== 'lifecycle' && value === '')) return
    if (!confirming) {
      setReview([
        'Feature ' + body.code + ' will be created in this Project.',
        'Title: ' + body.title,
        'Primary Domain: ' + body.primaryDomainId,
        'Lifecycle: DRAFT',
      ])
      return
    }
    try {
      await mutation.submit({ operation: 'CREATE_FEATURE', path: featureCollectionPath(projectId), method: 'POST', body })
      onClose()
    } catch {}
  }
  return (
    <FormFrame title="Create Project Feature" onClose={onClose} onSubmit={submit} mutation={mutation} submitLabel="Create Feature" review={review} onEditReview={() => setReview(null)}>
      <p className="mb-3 text-xs text-muted">Creates one Project-local DRAFT. Scope, actor, version, audit and evidence are supplied by the server.</p>
      <div className="grid gap-1 sm:grid-cols-2">
        <Field label="Feature code"><input className="input" data-testid="feature-create-code" {...fieldControlProps(mutation, 'code')} value={values.code} onChange={(event) => update('code', event.target.value)} required maxLength={128} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="code" /></Field>
        <Field label="Title"><input className="input" data-testid="feature-create-title" {...fieldControlProps(mutation, 'title')} value={values.title} onChange={(event) => update('title', event.target.value)} required maxLength={500} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="title" /></Field>
      </div>
      <Field label="Problem"><textarea className="input" data-testid="feature-create-problem" {...fieldControlProps(mutation, 'problem')} rows={3} value={values.problem} onChange={(event) => update('problem', event.target.value)} required maxLength={5000} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="problem" /></Field>
      <Field label="Outcome"><textarea className="input" data-testid="feature-create-outcome" {...fieldControlProps(mutation, 'outcome')} rows={3} value={values.outcome} onChange={(event) => update('outcome', event.target.value)} required maxLength={5000} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="outcome" /></Field>
      <div data-feature-field-path="primaryDomainId"><DomainPicker {...fieldControlProps(mutation, 'primaryDomainId')} value={values.primaryDomainId} onChange={(value) => update('primaryDomainId', typeof value === 'string' ? value : value?.target?.value || '')} label="Primary Domain" disabled={Boolean(mutation.pendingAttempt)} required excludeDomainIds={[]} name="primaryDomainId" dataFieldPath="primaryDomainId" /><FieldError mutation={mutation} path="primaryDomainId" /></div>
      <div className="grid gap-1 sm:grid-cols-2">
        <Field label="Canonical Feature key" hint="Optional. Supply it with a valid Governance Snapshot ID, or leave both blank.">
          <input className="input" data-testid="feature-create-canonical-key" {...fieldControlProps(mutation, 'canonicalFeatureKey')} value={values.canonicalFeatureKey} onChange={(event) => update('canonicalFeatureKey', event.target.value)} maxLength={200} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="canonicalFeatureKey" />
        </Field>
        <Field label="Governance Snapshot ID" hint="Optional server-provided evidence reference.">
          <input className="input" data-testid="feature-create-snapshot-id" {...fieldControlProps(mutation, 'governanceSnapshotId')} value={values.governanceSnapshotId} onChange={(event) => update('governanceSnapshotId', event.target.value)} list="feature-create-snapshot-options" disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="governanceSnapshotId" />
        </Field>
      </div>
      <datalist id="feature-create-snapshot-options">
        {(snapshotsState?.items || []).map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.commitSha}</option>)}
      </datalist>
      {snapshotsState?.nextCursor && <button type="button" className="btn mt-2 text-[11px]" onClick={snapshotsState.loadMore} disabled={snapshotsState.loadingMore}>{snapshotsState.loadingMore ? 'Loading snapshots…' : 'Load more snapshot options'}</button>}
      {snapshotsState?.error && snapshotsState.items.length > 0 && <p className="mt-2 text-xs text-muted" role="status">More snapshot options are unavailable. Loaded options remain visible.</p>}
    </FormFrame>
  )
}

function EditFeatureForm({ projectId, feature, featureEtag, onClose, onSaved }) {
  const [values, setValues] = useState(() => ({
    title: feature?.title || '',
    problem: feature?.problem || '',
    outcome: feature?.outcome || '',
    primaryDomainId: feature?.primaryDomain?.domainId || '',
    lifecycle: feature?.lifecycle || 'DRAFT',
  }))
  const [review, setReview] = useState(null)
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'UPDATE_FEATURE', feature?.id), onSaved })
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }))
  const submit = async (event, confirming = false) => {
    event.preventDefault()
    const body = buildFeaturePatchInput(values)
    if (!confirming) {
      setReview([
        'Feature ' + (feature?.code || 'Project Feature') + ' will be updated in this Project.',
        'Title: ' + body.title,
        'Primary Domain: ' + body.primaryDomainId,
        'Lifecycle: ' + body.lifecycle,
      ])
      return
    }
    try {
      await mutation.submit({ operation: 'UPDATE_FEATURE', path: featurePath(projectId, feature.id), method: 'PATCH', body, ifMatch: featureEtag })
      onClose()
    } catch {}
  }
  const disabled = !feature || !isFeatureEtag(featureEtag, feature?.id)
  return (
    <FormFrame title={'Edit ' + (feature?.code || 'Project Feature')} onClose={onClose} onSubmit={submit} mutation={mutation} submitLabel="Save Feature" disabled={disabled} review={review} onEditReview={() => setReview(null)}>
      {disabled && <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2 text-xs text-muted" role="status">The current Feature version is unavailable. Reload the detail before editing.</p>}
       <Field label="Title"><input className="input" data-testid="feature-edit-title" {...fieldControlProps(mutation, 'title')} value={values.title} onChange={(event) => update('title', event.target.value)} required maxLength={500} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="title" /></Field>
       <Field label="Problem"><textarea className="input" data-testid="feature-edit-problem" {...fieldControlProps(mutation, 'problem')} rows={3} value={values.problem} onChange={(event) => update('problem', event.target.value)} required maxLength={5000} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="problem" /></Field>
       <Field label="Outcome"><textarea className="input" data-testid="feature-edit-outcome" {...fieldControlProps(mutation, 'outcome')} rows={3} value={values.outcome} onChange={(event) => update('outcome', event.target.value)} required maxLength={5000} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path="outcome" /></Field>
      <div data-feature-field-path="primaryDomainId"><DomainPicker {...fieldControlProps(mutation, 'primaryDomainId')} value={values.primaryDomainId} onChange={(value) => update('primaryDomainId', typeof value === 'string' ? value : value?.target?.value || '')} label="Primary Domain" disabled={disabled || Boolean(mutation.pendingAttempt)} excludeDomainIds={[]} name="primaryDomainId" dataFieldPath="primaryDomainId" /><FieldError mutation={mutation} path="primaryDomainId" /></div>
      <Field label="Lifecycle">
        <select className="input" data-testid="feature-edit-lifecycle" {...fieldControlProps(mutation, 'lifecycle')} value={values.lifecycle} onChange={(event) => update('lifecycle', event.target.value)} disabled={disabled || Boolean(mutation.pendingAttempt)}>
          {editableLifecycles(feature?.lifecycle).map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </select>
        <FieldError mutation={mutation} path="lifecycle" />
      </Field>
    </FormFrame>
  )
}

function ContributionsForm({ projectId, feature, featureEtag, onClose, onSaved }) {
  const [rows, setRows] = useState(() => featureContributions(feature))
  const [review, setReview] = useState(null)
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'REPLACE_CONTRIBUTIONS', feature?.id), onSaved })
  const updateRow = (index, key, value) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  const submit = async (event, confirming = false) => {
    event.preventDefault()
    const body = buildContributionsInput(rows)
    if (!confirming) {
      setReview([
        'Supporting Domain responsibilities to save: ' + body.contributions.length,
        ...body.contributions.map((row) => row.domainId + ' · ' + row.responsibility),
      ])
      return
    }
    try {
      await mutation.submit({ operation: 'REPLACE_CONTRIBUTIONS', path: contributionsPath(projectId, feature.id), method: 'PUT', body, ifMatch: featureEtag })
      onClose()
    } catch {}
  }
  const disabled = !isFeatureEtag(featureEtag, feature?.id)
  return (
    <FormFrame title={'Supporting Domains · ' + (feature?.code || '')} onClose={onClose} onSubmit={submit} mutation={mutation} submitLabel="Save Domains" disabled={disabled} wide review={review} onEditReview={() => setReview(null)}>
      <p className="mb-3 text-xs text-muted">Replace the complete supporting-Domain set. Blank rows are ignored; partially filled rows are sent for server validation.</p>
      {rows.length === 0 && <p className="mb-3 text-xs text-muted">No supporting Domain responsibilities are recorded.</p>}
      {rows.map((row, index) => (
        <div className="mb-3 grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]" key={'contribution-' + index}>
          <div data-feature-field-path={'contributions.' + index + '.domainId'}><DomainPicker {...fieldControlProps(mutation, 'contributions.' + index + '.domainId')} value={row.domainId} onChange={(value) => updateRow(index, 'domainId', typeof value === 'string' ? value : value?.target?.value || '')} label={'Supporting Domain ' + (index + 1)} disabled={disabled || Boolean(mutation.pendingAttempt)} excludeDomainIds={supportingDomainExclusions(feature, rows, index)} name={'contributions.' + index + '.domainId'} dataFieldPath={'contributions.' + index + '.domainId'} /><FieldError mutation={mutation} path={'contributions.' + index + '.domainId'} /></div>
           <Field label="Responsibility"><textarea className="input" {...fieldControlProps(mutation, 'contributions.' + index + '.responsibility')} rows={2} value={row.responsibility} onChange={(event) => updateRow(index, 'responsibility', event.target.value)} maxLength={2000} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path={'contributions.' + index + '.responsibility'} /></Field>
          <button type="button" className="btn self-start text-[11px]" onClick={() => setRows((current) => removeRow(current, index))} disabled={Boolean(mutation.pendingAttempt)}>Remove</button>
        </div>
      ))}
       <button type="button" className="btn text-[11px]" onClick={() => setRows((current) => addRow(current, { domainId: '', responsibility: '' }))} disabled={Boolean(mutation.pendingAttempt)}>Add supporting Domain</button>
    </FormFrame>
  )
}

function WorkLinksForm({ projectId, feature, featureEtag, features, onClose, onSaved }) {
  const [allocationMode, setAllocationMode] = useState(() => feature?.workLinks?.some((link) => link.allocationBps == null) ? 'UNALLOCATED' : 'COMPLETE_SPLIT')
  const [rows, setRows] = useState(() => featureLinks(feature))
  const [review, setReview] = useState(null)
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'REPLACE_WORK_LINKS', feature?.id), onSaved })
  const updateRow = (index, key, value) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  const summary = allocationSummary(features, [{ featureId: feature?.id, links: rows }])
  const submit = async (event, confirming = false) => {
    event.preventDefault()
    const body = buildWorkLinksInput({ allocationMode, rows })
    if (!confirming) {
      setReview([
        'WorkItem links to save: ' + body.links.length + ' (' + allocationMode.replace(/_/g, ' ') + ').',
        ...summary.map((row) => row.workItemId + ' · total ' + row.total + ' bps · remainder ' + row.remainder + ' bps' + (row.hasUnallocated ? ' · some share is unallocated' : '')),
      ])
      return
    }
    try {
      await mutation.submit({ operation: 'REPLACE_WORK_LINKS', path: workLinksPath(projectId, feature.id), method: 'PUT', body, ifMatch: featureEtag })
      onClose()
    } catch {}
  }
  const disabled = !isFeatureEtag(featureEtag, feature?.id)
  return (
    <FormFrame title={'WorkItem links · ' + (feature?.code || '')} onClose={onClose} onSubmit={submit} mutation={mutation} submitLabel="Save Work links" disabled={disabled} wide review={review} onEditReview={() => setReview(null)}>
      <p className="mb-3 text-xs text-muted">Replace the complete active WorkItem link set. Allocation state is derived by the server for each WorkItem.</p>
      <Field label="Allocation mode">
        <select className="input" data-testid="feature-work-links-mode" {...fieldControlProps(mutation, 'allocationMode')} value={allocationMode} onChange={(event) => setAllocationMode(event.target.value)} disabled={Boolean(mutation.pendingAttempt)}>
          {ALLOCATION_MODES.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </select>
      </Field>
      {rows.map((row, index) => (
        <div className="mb-3 grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_auto]" key={'work-link-' + index}>
          <div data-feature-field-path={'links.' + index + '.workItemId'}><WorkItemPicker {...fieldControlProps(mutation, 'links.' + index + '.workItemId')} projectId={projectId} value={row.workItemId} onChange={(value) => updateRow(index, 'workItemId', typeof value === 'string' ? value : value?.target?.value || '')} label={'WorkItem ' + (index + 1)} disabled={Boolean(mutation.pendingAttempt)} name={'links.' + index + '.workItemId'} dataFieldPath={'links.' + index + '.workItemId'} /><FieldError mutation={mutation} path={'links.' + index + '.workItemId'} /></div>
          <Field label="Allocation bps" hint="0–10000; leave blank for unallocated"><input className="input" {...fieldControlProps(mutation, 'links.' + index + '.allocationBps')} type="number" min="0" max="10000" step="1" value={row.allocationBps} onChange={(event) => updateRow(index, 'allocationBps', event.target.value)} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path={'links.' + index + '.allocationBps'} /></Field>
          <button type="button" className="btn self-start text-[11px]" onClick={() => setRows((current) => removeRow(current, index))} disabled={Boolean(mutation.pendingAttempt)}>Remove</button>
        </div>
      ))}
      {rows.length === 0 && <p className="mb-3 text-xs text-muted">No WorkItem links are recorded.</p>}
      {summary.length > 0 && <section className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2" aria-label="WorkItem allocation summary" data-testid="work-item-allocation-summary"><p className="text-[10px] font-bold">Current Project allocation</p>{summary.map((row) => <p key={row.workItemId} className="mt-1 break-all text-[11px] text-muted">{row.workItemId}: total {row.total} bps · remainder {row.remainder} bps{row.hasUnallocated ? ' · unallocated share present' : ''}</p>)}</section>}
      <button type="button" className="btn text-[11px]" onClick={() => setRows((current) => addRow(current, { workItemId: '', allocationBps: '' }))} disabled={Boolean(mutation.pendingAttempt)}>Add WorkItem link</button>
    </FormFrame>
  )
}

function GraphForm({ projectId, feature, featureEtag, graphEtag, features, onClose, onSaved }) {
  const knownFeatures = useMemo(() => {
    const rows = Array.isArray(features) ? features : []
    return feature && !rows.some((row) => String(row.id) === String(feature.id)) ? [feature, ...rows] : rows
  }, [feature, features])
  const [allocationMode, setAllocationMode] = useState('UNALLOCATED')
  const [sets, setSets] = useState(() => {
    if (!feature) return []
    const links = featureLinks(feature)
    return [{ featureId: feature.id, links, originalWorkItemIds: links.map((link) => link.workItemId).filter(Boolean) }]
  })
  const [review, setReview] = useState(null)
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'REPLACE_FEATURE_WORK_GRAPH'), onSaved })
  const addFeature = (featureId) => {
    if (!featureId || sets.some((set) => String(set.featureId) === String(featureId))) return
    const selected = knownFeatures.find((row) => String(row.id) === String(featureId))
    const links = featureLinks(selected)
    setSets((current) => [...current, { featureId, links, originalWorkItemIds: links.map((link) => link.workItemId).filter(Boolean) }])
  }
  const removeFeature = (featureId) => setSets((current) => current.filter((set) => String(set.featureId) !== String(featureId)))
  const updateLink = (setIndex, rowIndex, key, value) => setSets((current) => current.map((set, currentSetIndex) => currentSetIndex !== setIndex ? set : {
    ...set,
    links: set.links.map((row, currentRowIndex) => currentRowIndex === rowIndex ? { ...row, [key]: value } : row),
  }))
  const addLink = (setIndex) => setSets((current) => current.map((set, currentSetIndex) => currentSetIndex === setIndex ? { ...set, links: addRow(set.links, { workItemId: '', allocationBps: '' }) } : set))
  const removeLink = (setIndex, rowIndex) => setSets((current) => current.map((set, currentSetIndex) => currentSetIndex === setIndex ? { ...set, links: removeRow(set.links, rowIndex) } : set))
  const summary = allocationSummary(knownFeatures, sets)
  const submit = async (event, confirming = false) => {
    event.preventDefault()
    const body = buildGraphInput({ allocationMode, sets })
    if (!confirming) {
      setReview([
        'Features in the complete graph set: ' + body.featureSets.length + ' (' + allocationMode.replace(/_/g, ' ') + ').',
        'WorkItem links to save: ' + body.featureSets.reduce((total, set) => total + set.links.length, 0),
        ...summary.map((row) => row.workItemId + ' · total ' + row.total + ' bps · remainder ' + row.remainder + ' bps' + (row.hasUnallocated ? ' · some share is unallocated' : '')),
      ])
      return
    }
    try {
      await mutation.submit({ operation: 'REPLACE_FEATURE_WORK_GRAPH', path: graphPath(projectId), method: 'PUT', body, ifMatch: graphEtag })
      onClose()
    } catch {}
  }
  const disabled = !isGraphEtag(graphEtag) || sets.length === 0
  const available = knownFeatures.filter((row) => !sets.some((set) => String(set.featureId) === String(row.id)))
  return (
    <FormFrame title="Cross-Feature Work graph" onClose={onClose} onSubmit={submit} mutation={mutation} submitLabel="Save Work graph" disabled={disabled} wide review={review} onEditReview={() => setReview(null)}>
      <p className="mb-3 text-xs text-muted">Reconcile complete link sets for selected Features. The graph version includes every Feature, including items in history.</p>
      {!isGraphEtag(graphEtag) && <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2 text-xs text-muted" role="status">Owner graph evidence is unavailable. Reload the Project Feature view.</p>}
      <Field label="Allocation mode">
        <select className="input" {...fieldControlProps(mutation, 'allocationMode')} value={allocationMode} onChange={(event) => setAllocationMode(event.target.value)} disabled={Boolean(mutation.pendingAttempt)}>
          {ALLOCATION_MODES.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </select>
      </Field>
      {sets.map((set, setIndex) => {
        const selected = knownFeatures.find((row) => String(row.id) === String(set.featureId))
        return (
          <section key={set.featureId} className="mb-4 rounded-lg border border-[var(--border)] p-3" aria-label={'Feature graph set ' + (selected?.code || set.featureId)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-xs font-bold">{selected?.code || 'Selected Feature'}</p><code className="break-all text-[10px] text-muted">{set.featureId}</code></div>
              {sets.length > 1 && <button type="button" className="btn text-[11px]" onClick={() => removeFeature(set.featureId)} disabled={Boolean(mutation.pendingAttempt)}>Remove Feature</button>}
            </div>
            {set.links.map((row, rowIndex) => (
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_auto]" key={set.featureId + '-link-' + rowIndex}>
                <div data-feature-field-path={'featureSets.' + setIndex + '.links.' + rowIndex + '.workItemId'}><WorkItemPicker {...fieldControlProps(mutation, 'featureSets.' + setIndex + '.links.' + rowIndex + '.workItemId')} projectId={projectId} value={row.workItemId} onChange={(value) => updateLink(setIndex, rowIndex, 'workItemId', typeof value === 'string' ? value : value?.target?.value || '')} label="WorkItem" disabled={Boolean(mutation.pendingAttempt)} name={'featureSets.' + setIndex + '.links.' + rowIndex + '.workItemId'} dataFieldPath={'featureSets.' + setIndex + '.links.' + rowIndex + '.workItemId'} /><FieldError mutation={mutation} path={'featureSets.' + setIndex + '.links.' + rowIndex + '.workItemId'} /></div>
                <Field label="Allocation bps"><input className="input" {...fieldControlProps(mutation, 'featureSets.' + setIndex + '.links.' + rowIndex + '.allocationBps')} type="number" min="0" max="10000" step="1" value={row.allocationBps} onChange={(event) => updateLink(setIndex, rowIndex, 'allocationBps', event.target.value)} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path={'featureSets.' + setIndex + '.links.' + rowIndex + '.allocationBps'} /></Field>
                <button type="button" className="btn self-start text-[11px]" onClick={() => removeLink(setIndex, rowIndex)} disabled={Boolean(mutation.pendingAttempt)}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn mt-2 text-[11px]" onClick={() => addLink(setIndex)} disabled={Boolean(mutation.pendingAttempt)}>Add WorkItem link</button>
          </section>
        )
      })}
      {available.length > 0 && (
        <Field label="Add authorized Feature to graph">
           <select className="input" value="" onChange={(event) => addFeature(event.target.value)} disabled={Boolean(mutation.pendingAttempt)}>
            <option value="">Choose an existing Feature</option>
            {available.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.title}</option>)}
          </select>
        </Field>
      )}
      {summary.length > 0 && <section className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2" aria-label="WorkItem allocation summary" data-testid="work-item-allocation-summary"><p className="text-[10px] font-bold">Current Project allocation</p>{summary.map((row) => <p key={row.workItemId} className="mt-1 break-all text-[11px] text-muted">{row.workItemId}: total {row.total} bps · remainder {row.remainder} bps{row.hasUnallocated ? ' · unallocated share present' : ''}</p>)}</section>}
    </FormFrame>
  )
}

function RequirementsForm({ projectId, feature, featureEtag, snapshotsState, onClose, onSaved }) {
  const [rows, setRows] = useState(() => featureBindings(feature))
  const [review, setReview] = useState(null)
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'REPLACE_REQUIREMENT_BINDINGS', feature?.id), onSaved })
  const updateRow = (index, key, value) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? updateRequirementBindingRow(row, key, value) : row))
  const submit = async (event, confirming = false) => {
    event.preventDefault()
    const body = buildRequirementBindingsInput(rows)
    if (!confirming) {
      setReview([
        'Requirement bindings to save: ' + body.bindings.length,
        ...body.bindings.map((row) => row.governanceSnapshotId + ' · ' + row.sourceNamespace + ':' + row.requirementKey),
      ])
      return
    }
    try {
      await mutation.submit({ operation: 'REPLACE_REQUIREMENT_BINDINGS', path: requirementsPath(projectId, feature.id), method: 'PUT', body, ifMatch: featureEtag })
      onClose()
    } catch {}
  }
  const disabled = !isFeatureEtag(featureEtag, feature?.id)
  return (
    <FormFrame title={'Requirement evidence · ' + (feature?.code || '')} onClose={onClose} onSubmit={submit} mutation={mutation} submitLabel="Save requirements" disabled={disabled} wide review={review} onEditReview={() => setReview(null)}>
      <p className="mb-3 text-xs text-muted">Requirement subjects are server-owned. Select a VALID snapshot when available; unknown or unavailable evidence stays explicit.</p>
      {snapshotsState.loading && <p className="mb-3 text-xs text-muted" role="status">Loading authorized snapshot metadata…</p>}
      {snapshotsState.error && snapshotsState.items.length === 0 && <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2 text-xs text-muted" role="status">Snapshot evidence is unavailable. Existing values remain visible and the server will decide whether a binding can be saved.</p>}
      {snapshotsState.error && snapshotsState.items.length > 0 && <p className="mb-3 text-xs text-muted" role="status">More snapshot evidence is unavailable. Loaded values remain visible.</p>}
      {rows.map((row, index) => (
        <div className="mb-3 grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-2" key={'binding-' + index}>
          <Field label="Governance Snapshot ID">
            <input className="input" {...fieldControlProps(mutation, 'bindings.' + index + '.governanceSnapshotId')} value={row.governanceSnapshotId} onChange={(event) => updateRow(index, 'governanceSnapshotId', event.target.value)} list="feature-snapshot-options" disabled={Boolean(mutation.pendingAttempt)} />
            <FieldError mutation={mutation} path={'bindings.' + index + '.governanceSnapshotId'} />
          </Field>
          <Field label="Source namespace"><input className="input" {...fieldControlProps(mutation, 'bindings.' + index + '.sourceNamespace')} value={row.sourceNamespace} onChange={(event) => updateRow(index, 'sourceNamespace', event.target.value)} maxLength={128} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path={'bindings.' + index + '.sourceNamespace'} /></Field>
          <Field label="Requirement key"><input className="input" {...fieldControlProps(mutation, 'bindings.' + index + '.requirementKey')} value={row.requirementKey} onChange={(event) => updateRow(index, 'requirementKey', event.target.value)} maxLength={128} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path={'bindings.' + index + '.requirementKey'} /></Field>
          <Field label="Revision hash"><input className="input font-mono text-[11px]" {...fieldControlProps(mutation, 'bindings.' + index + '.revisionHash')} value={row.revisionHash} onChange={(event) => updateRow(index, 'revisionHash', event.target.value)} maxLength={64} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path={'bindings.' + index + '.revisionHash'} /></Field>
          <Field label="Acceptance reference"><input className="input" {...fieldControlProps(mutation, 'bindings.' + index + '.acceptanceRef')} value={row.acceptanceRef} onChange={(event) => updateRow(index, 'acceptanceRef', event.target.value)} maxLength={1000} disabled={Boolean(mutation.pendingAttempt)} /><FieldError mutation={mutation} path={'bindings.' + index + '.acceptanceRef'} /></Field>
          <div className="sm:col-span-2 rounded-lg bg-[var(--surface-mid)] px-2 py-1 text-[11px] text-muted">Canonical subject: {row.canonicalSubject || (row.governanceSnapshotId ? 'UNAVAILABLE until this evidence is verified.' : 'UNAVAILABLE pending evidence.')}</div>
          <button type="button" className="btn self-start text-[11px]" onClick={() => setRows((current) => removeRow(current, index))} disabled={Boolean(mutation.pendingAttempt)}>Remove</button>
        </div>
      ))}
      {rows.length === 0 && <p className="mb-3 text-xs text-muted">No requirement bindings are recorded.</p>}
      <datalist id="feature-snapshot-options">
        {(snapshotsState.items || []).map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.commitSha}</option>)}
      </datalist>
      {snapshotsState.nextCursor && <button type="button" className="btn mt-2 text-[11px]" onClick={snapshotsState.loadMore} disabled={snapshotsState.loadingMore}>{snapshotsState.loadingMore ? 'Loading snapshots…' : 'Load more snapshot options'}</button>}
       <button type="button" className="btn text-[11px]" onClick={() => setRows((current) => addRow(current, { governanceSnapshotId: '', sourceNamespace: '', requirementKey: '', revisionHash: '', acceptanceRef: '' }))} disabled={Boolean(mutation.pendingAttempt)}>Add requirement binding</button>
    </FormFrame>
  )
}

function CaptureSnapshotForm({ projectId, onClose, onSaved }) {
  const [values, setValues] = useState({
    repositoryId: '',
    commitSha: '',
    manifestHash: '',
    sourceManifest: JSON.stringify({ schemaVersion: '1.0.0', entries: [] }, null, 2),
  })
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'CAPTURE_GOVERNANCE_SNAPSHOT'), onSaved })
  const [inputError, setInputError] = useState(null)
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }))
  const submit = async (event) => {
    event.preventDefault()
    let body
    try {
      body = buildSnapshotCaptureInput(values)
    } catch (error) {
      setInputError(describeMutationError(error))
      return
    }
    setInputError(null)
    try {
      await mutation.submit({ operation: 'CAPTURE_GOVERNANCE_SNAPSHOT', path: snapshotPath(projectId), method: 'POST', body })
      onClose()
    } catch {}
  }
  return (
    <FormFrame title="Capture governance snapshot" onClose={onClose} onSubmit={submit} mutation={{ ...mutation, error: inputError || mutation.error }} submitLabel="Capture snapshot" wide>
      <p className="mb-3 text-xs text-muted">The server-local verifier decides whether this intent is VALID. Checkout paths and proof flags are never accepted from this form.</p>
      <Field label="Repository ID"><input className="input" data-testid="snapshot-repository-id" value={values.repositoryId} onChange={(event) => update('repositoryId', event.target.value)} required disabled={Boolean(mutation.pendingAttempt)} /></Field>
      <div className="grid gap-1 sm:grid-cols-2">
        <Field label="Commit SHA"><input className="input font-mono text-[11px]" data-testid="snapshot-commit-sha" value={values.commitSha} onChange={(event) => update('commitSha', event.target.value)} required disabled={Boolean(mutation.pendingAttempt)} /></Field>
        <Field label="Manifest hash"><input className="input font-mono text-[11px]" data-testid="snapshot-manifest-hash" value={values.manifestHash} onChange={(event) => update('manifestHash', event.target.value)} required disabled={Boolean(mutation.pendingAttempt)} /></Field>
      </div>
      <Field label="Source manifest JSON" hint="Required keys: schemaVersion and entries. The server verifies all provenance.">
        <textarea className="input min-h-40 font-mono text-[11px]" data-testid="snapshot-source-manifest" value={values.sourceManifest} onChange={(event) => update('sourceManifest', event.target.value)} required disabled={Boolean(mutation.pendingAttempt)} />
      </Field>
    </FormFrame>
  )
}

function SnapshotList({ projectId, onClose, onAction }) {
  const snapshots = useOwnerSnapshots(projectId, true)
  return (
    <FormDialog title="Governance snapshot evidence" onClose={onClose}>
      <p className="mb-3 text-xs text-muted">Only owner-safe immutable metadata is shown. Source manifests and verifier proof remain server-side.</p>
      {snapshots.loading ? <p className="text-xs text-muted" role="status">Loading snapshot metadata…</p> : snapshots.error && snapshots.items.length === 0 ? <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2 text-xs text-muted" role="status">Snapshot evidence is unavailable.</p> : snapshots.items.length === 0 ? <p className="text-xs text-muted">No VALID governance snapshots are available.</p> : (
        <ul className="space-y-2" aria-label="Governance snapshots">
          {snapshots.items.map((snapshot) => (
            <li key={snapshot.id} className="min-w-0 rounded-lg border border-[var(--border)] p-3 text-[11px]">
              <p className="break-all font-semibold">{snapshot.id}</p>
              <p className="mt-1 break-all text-muted">Repository {snapshot.repositoryId}</p>
              <p className="mt-1 break-all text-muted">Commit {snapshot.commitSha}</p>
              <p className="mt-1 break-all text-muted">Manifest {snapshot.manifestHash}</p>
              <p className="mt-1 text-muted">Captured {snapshot.capturedAt} · {snapshot.validationStatus}</p>
            </li>
          ))}
        </ul>
      )}
      {snapshots.error && snapshots.items.length > 0 && <p className="mt-2 text-xs text-muted" role="status">More snapshot evidence is unavailable. The loaded entries remain visible.</p>}
      {snapshots.nextCursor && <button type="button" className="btn mt-3 text-[11px]" onClick={snapshots.loadMore} disabled={snapshots.loadingMore}>{snapshots.loadingMore ? 'Loading snapshots…' : 'Load more snapshots'}</button>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" onClick={() => onAction(FEATURE_FORM_ACTIONS.CAPTURE)}>Capture snapshot</button>
      </div>
    </FormDialog>
  )
}

function cursorFrom(data) {
  return typeof data?.nextCursor === 'string' && data.nextCursor.length > 0 ? data.nextCursor : null
}

function useCursorPage(projectId, enabled, pathForCursor) {
  const [state, setState] = useState({ items: [], nextCursor: null, loading: false, loadingMore: false, error: null })
  const generation = useRef(0)

  useEffect(() => {
    const requestGeneration = ++generation.current
    let current = true
    if (!enabled || !projectId) {
      setState({ items: [], nextCursor: null, loading: false, loadingMore: false, error: null })
      return () => { current = false }
    }
    setState({ items: [], nextCursor: null, loading: true, loadingMore: false, error: null })
    requestFeatureJson(pathForCursor(projectId))
      .then((result) => {
        if (!current || generation.current !== requestGeneration) return
        const items = Array.isArray(result.data?.items) ? result.data.items : []
        setState({ items, nextCursor: cursorFrom(result.data), loading: false, loadingMore: false, error: null })
      })
      .catch((error) => {
        if (current && generation.current === requestGeneration) setState({ items: [], nextCursor: null, loading: false, loadingMore: false, error })
      })
    return () => { current = false }
  }, [enabled, pathForCursor, projectId])

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor
    if (!enabled || !projectId || !cursor || state.loadingMore) return
    const requestGeneration = generation.current
    setState((current) => ({ ...current, loadingMore: true, error: null }))
    try {
      const result = await requestFeatureJson(pathForCursor(projectId, cursor))
      if (generation.current !== requestGeneration) return
      const items = Array.isArray(result.data?.items) ? result.data.items : []
      setState((current) => ({
        ...current,
        items: [...current.items, ...items],
        nextCursor: cursorFrom(result.data),
        loadingMore: false,
        error: null,
      }))
    } catch (error) {
      if (generation.current === requestGeneration) setState((current) => ({ ...current, loadingMore: false, error }))
    }
  }, [enabled, pathForCursor, projectId, state.loadingMore, state.nextCursor])

  return { ...state, loadMore }
}

function useOwnerSnapshots(projectId, enabled) {
  return useCursorPage(projectId, enabled, snapshotPath)
}

function DeleteFeatureForm({ projectId, feature, featureEtag, onClose, onSaved }) {
  const [confirmed, setConfirmed] = useState(false)
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'DELETE_FEATURE', feature?.id), onSaved })
  const submit = async (event) => {
    event.preventDefault()
    if (!confirmed) return
    try {
      await mutation.submit({ operation: 'DELETE_FEATURE', path: featurePath(projectId, feature.id), method: 'DELETE', body: null, ifMatch: featureEtag })
      onClose()
    } catch {}
  }
  const disabled = !confirmed || !isFeatureEtag(featureEtag, feature?.id)
  return (
    <FormFrame title={'Delete ' + (feature?.code || 'Feature')} onClose={onClose} onSubmit={submit} mutation={mutation} submitLabel="Delete Feature" danger disabled={disabled}>
      <p className="text-xs text-muted">This moves the Feature and its active relationships into history. The saved record and its deletion history remain available for restoration.</p>
      <label className="mt-4 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> <span>I understand this changes the Feature lifecycle and preserves a server tombstone.</span></label>
      {!isFeatureEtag(featureEtag, feature?.id) && <p className="mt-3 text-xs text-muted" role="status">The current Feature version is unavailable. Reload the detail before deleting.</p>}
    </FormFrame>
  )
}

function RestoreFeatureForm({ projectId, onClose, onSaved }) {
  const deleted = useDeletedFeatures(projectId)
  const [featureId, setFeatureId] = useState('')
  const selected = deleted.items.find((row) => String(row.id) === String(featureId)) || null
  const mutation = useFeatureMutation({ projectId, intentKey: mutationKey(projectId, 'RESTORE_FEATURE'), onSaved })
  const submit = async (event) => {
    event.preventDefault()
    if (!selected) return
    try {
      await mutation.submit({
        operation: 'RESTORE_FEATURE',
        path: featurePath(projectId, selected.id) + '/restore',
        method: 'POST',
        body: null,
        ifMatch: '"PROJECT_FEATURE/' + selected.id + '/v' + selected.version + '"',
      })
      onClose()
    } catch {}
  }
  return (
    <FormFrame title="Restore deleted Feature" onClose={onClose} onSubmit={submit} mutation={mutation} submitLabel="Restore Feature" disabled={!selected} wide={false}>
      <p className="mb-3 text-xs text-muted">Choose a Feature from history. Restore uses its latest saved version.</p>
      {deleted.loading ? <p className="text-xs text-muted" role="status">Loading deleted Features…</p> : deleted.error && deleted.items.length === 0 ? <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2 text-xs text-muted" role="status">Deleted Feature evidence is unavailable.</p> : deleted.items.length === 0 ? <p className="text-xs text-muted">No deleted Features are available to restore.</p> : (
        <>
          <Field label="Deleted Feature">
            <select className="input" data-testid="feature-restore-select" value={featureId} onChange={(event) => setFeatureId(event.target.value)}>
              <option value="">Choose a deleted Feature</option>
              {deleted.items.map((row) => <option key={row.id} value={row.id}>{row.code} · version {row.version}</option>)}
            </select>
          </Field>
          {deleted.error && <p className="mt-2 text-xs text-muted" role="status">More deleted Features are unavailable. Loaded history remains visible.</p>}
          {deleted.nextCursor && <button type="button" className="btn mt-2 text-[11px]" onClick={deleted.loadMore} disabled={deleted.loadingMore}>{deleted.loadingMore ? 'Loading history…' : 'Load more deleted Features'}</button>}
        </>
      )}
      {selected && <p className="mt-2 break-all text-[10px] text-muted">Deleted {selected.deletedAt}</p>}
    </FormFrame>
  )
}

function useDeletedFeatures(projectId) {
  return useCursorPage(projectId, Boolean(projectId), deletedFeaturesPath)
}

export function FeatureOwnerActions({ canMutate, feature, featureEtag, onAction }) {
  if (!canMutate || !feature) return null
  const hasEtag = isFeatureEtag(featureEtag, feature.id)
  return (
    <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] p-3" aria-label="Feature owner actions" data-testid="feature-owner-actions">
      <p className="text-[10px] font-bold text-muted">Owner actions</p>
      <p className="mt-1 text-[11px] text-muted">Changes are checked against the latest saved Feature before they are saved.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn text-[11px]" onClick={(event) => onAction(FEATURE_FORM_ACTIONS.EDIT, event.currentTarget)} disabled={!hasEtag}>Edit Feature</button>
        <button type="button" className="btn text-[11px]" onClick={(event) => onAction(FEATURE_FORM_ACTIONS.CONTRIBUTIONS, event.currentTarget)} disabled={!hasEtag}>Edit Domain contributions</button>
        <button type="button" className="btn text-[11px]" onClick={(event) => onAction(FEATURE_FORM_ACTIONS.WORK_LINKS, event.currentTarget)} disabled={!hasEtag}>Edit Work links</button>
        <button type="button" className="btn text-[11px]" onClick={(event) => onAction(FEATURE_FORM_ACTIONS.GRAPH, event.currentTarget)}>Edit Work graph</button>
        <button type="button" className="btn text-[11px]" onClick={(event) => onAction(FEATURE_FORM_ACTIONS.REQUIREMENTS, event.currentTarget)} disabled={!hasEtag}>Edit Requirement bindings</button>
        <button type="button" className="btn text-[11px]" onClick={(event) => onAction(FEATURE_FORM_ACTIONS.DELETE, event.currentTarget)} disabled={!hasEtag}>Delete Feature</button>
      </div>
    </section>
  )
}

export default function ProjectFeatureForms({
  projectId,
  action,
  feature = null,
  featureEtag = null,
  graphEtag = null,
  features = [],
  onActionChange,
  onSaved,
}) {
  const owner = isGraphEtag(graphEtag)
  const pendingStore = useRef(new Map())
  const snapshotsState = useOwnerSnapshots(projectId, owner && (action === FEATURE_FORM_ACTIONS.REQUIREMENTS || action === FEATURE_FORM_ACTIONS.CREATE))
  if (!owner || !action) return null
  const close = () => onActionChange?.(null)
  const saved = async (result) => {
    await onSaved?.(result)
  }
  let content = null
  if (action === FEATURE_FORM_ACTIONS.CREATE) content = <CreateFeatureForm key="create" projectId={projectId} snapshotsState={snapshotsState} onClose={close} onSaved={saved} />
  if (action === FEATURE_FORM_ACTIONS.EDIT && feature) content = <EditFeatureForm key={feature.id + '-edit'} projectId={projectId} feature={feature} featureEtag={featureEtag} onClose={close} onSaved={saved} />
  if (action === FEATURE_FORM_ACTIONS.CONTRIBUTIONS && feature) content = <ContributionsForm key={feature.id + '-contributions'} projectId={projectId} feature={feature} featureEtag={featureEtag} onClose={close} onSaved={saved} />
  if (action === FEATURE_FORM_ACTIONS.WORK_LINKS && feature) content = <WorkLinksForm key={feature.id + '-work-links'} projectId={projectId} feature={feature} featureEtag={featureEtag} features={features} onClose={close} onSaved={saved} />
  if (action === FEATURE_FORM_ACTIONS.GRAPH) content = <GraphForm key="graph" projectId={projectId} feature={feature} featureEtag={featureEtag} graphEtag={graphEtag} features={features} onClose={close} onSaved={saved} />
  if (action === FEATURE_FORM_ACTIONS.REQUIREMENTS && feature) content = <RequirementsForm key={feature.id + '-requirements'} projectId={projectId} feature={feature} featureEtag={featureEtag} snapshotsState={snapshotsState} onClose={close} onSaved={saved} />
  if (action === FEATURE_FORM_ACTIONS.SNAPSHOTS) content = <SnapshotList key="snapshots" projectId={projectId} onClose={close} onAction={onActionChange} />
  if (action === FEATURE_FORM_ACTIONS.CAPTURE) content = <CaptureSnapshotForm key="capture" projectId={projectId} onClose={close} onSaved={saved} />
  if (action === FEATURE_FORM_ACTIONS.DELETE && feature) content = <DeleteFeatureForm key={feature.id + '-delete'} projectId={projectId} feature={feature} featureEtag={featureEtag} onClose={close} onSaved={saved} />
  if (action === FEATURE_FORM_ACTIONS.RESTORE) content = <RestoreFeatureForm key="restore" projectId={projectId} onClose={close} onSaved={saved} />
  return <PendingMutationContext.Provider value={pendingStore.current}>{content}</PendingMutationContext.Provider>
}
