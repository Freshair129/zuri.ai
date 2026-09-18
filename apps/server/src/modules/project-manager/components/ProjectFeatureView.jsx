'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Card, EmptyState, ErrorState, Kpi, PageHeader, SectionTitle } from '@/components/ui'
import { LoadingCard } from './useApi'
import ProjectFeatureForms, {
  FeatureOwnerActions,
  FEATURE_FORM_ACTIONS,
  isGraphEtag,
  requestFeatureJson,
} from './ProjectFeatureForms'

// @req FR-252 — authorized Project readers can inspect explicit ProjectFeature
// authority, its Domain/WorkItem relationships and pinned evidence without
// turning a read surface into a mutation grant or an inferred Domain projection.
// @spec ADR-097, SDD-019, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/e2e/project-feature-view.spec.js

const UNAVAILABLE = 'UNAVAILABLE'
const LIFECYCLES = new Set(['DRAFT', 'ACTIVE', 'RETIRED'])
const EVIDENCE_STATES = new Set(['AVAILABLE', 'UNKNOWN', UNAVAILABLE])
const MAPPING_STATES = new Set(['MAPPED', 'UNMAPPED'])
const ALLOCATION_STATES = new Set(['UNALLOCATED', 'PARTIAL', 'COMPLETE_SPLIT'])
const BINDING_STATES = new Set(['PINNED', UNAVAILABLE])
const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isNullableString(value) {
  return value == null || typeof value === 'string'
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isDomainReference(value) {
  return isRecord(value)
    && isNonEmptyString(value.domainId)
    && isNonEmptyString(value.label)
    && MAPPING_STATES.has(value.mappingState)
}

function isContribution(value) {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && Number.isInteger(value.version) && value.version >= 1
    && isNonEmptyString(value.domainId)
    && isRequiredNullableString(value.label, value, 'label')
    && MAPPING_STATES.has(value.mappingState)
    && isNonEmptyString(value.responsibility)
}

function isWorkLink(value) {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && Number.isInteger(value.version) && value.version >= 1
    && isNonEmptyString(value.workItemId)
    && isRequiredNullableAllocation(value.allocationBps, value)
    && ALLOCATION_STATES.has(value.allocationState)
    && isRecord(value.workItem)
    && isNonEmptyString(value.workItem.code)
    && isNonEmptyString(value.workItem.title)
}

function isRequirementBinding(value) {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && Number.isInteger(value.version) && value.version >= 1
    && isNonEmptyString(value.governanceSnapshotId)
    && isNonEmptyString(value.sourceNamespace)
    && isNonEmptyString(value.requirementKey)
    && typeof value.revisionHash === 'string' && /^[0-9a-f]{64}$/.test(value.revisionHash)
    && isNonEmptyString(value.acceptanceRef)
    && isNullableString(value.canonicalSubject)
    && BINDING_STATES.has(value.bindingState)
}

function isEvidence(value) {
  return isRecord(value)
    && EVIDENCE_STATES.has(value.state)
    && (value.ref == null || typeof value.ref === 'string')
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isRequiredNullableString(value, record, key) {
  return hasOwn(record, key) && (value === null || typeof value === 'string')
}

function isRequiredNullableAllocation(value, record) {
  return hasOwn(record, 'allocationBps')
    && (value === null || (Number.isInteger(value) && value >= 0 && value <= 10000))
}

function isCanonicalFeatureReference(value) {
  if (!hasOwn(value, 'canonicalFeatureKey') || !hasOwn(value, 'governanceSnapshotId')) return false
  const { canonicalFeatureKey, governanceSnapshotId } = value
  return (canonicalFeatureKey === null && governanceSnapshotId === null)
    || (isNonEmptyString(canonicalFeatureKey) && isNonEmptyString(governanceSnapshotId))
}

function isFeatureRecord(value, projectId) {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && Number.isInteger(value.version) && value.version >= 1
    && String(value.projectId) === String(projectId)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.problem)
    && isNonEmptyString(value.outcome)
    && isDomainReference(value.primaryDomain)
    && Array.isArray(value.contributions) && value.contributions.length <= 200 && value.contributions.every(isContribution)
    && Array.isArray(value.workLinks) && value.workLinks.length <= 200 && value.workLinks.every(isWorkLink)
    && Array.isArray(value.requirementBindings) && value.requirementBindings.length <= 200 && value.requirementBindings.every(isRequirementBinding)
    && isCanonicalFeatureReference(value)
    && LIFECYCLES.has(value.lifecycle)
    && isNonNegativeInteger(value.uniqueWorkCount)
    && Array.isArray(value.evidence) && value.evidence.length <= 200 && value.evidence.every(isEvidence)
    && EVIDENCE_STATES.has(value.evidenceState)
}

function isFeatureView(value, projectId) {
  return isRecord(value)
    && value.schemaVersion === '1.0'
    && String(value.projectId) === String(projectId)
    && hasOwn(value, 'snapshotId') && value.snapshotId === null
    && value.snapshotState === UNAVAILABLE
    && isNonEmptyString(value.observedAt)
    && isNonNegativeInteger(value.uniqueWorkCount)
    && Array.isArray(value.features)
    && value.features.length <= 200
    && value.features.every((feature) => isFeatureRecord(feature, projectId))
}

function invalidResponse(message) {
  const error = new Error(message)
  error.incompleteResponse = true
  return error
}

function featureViewPath(projectId) {
  return `/api/projects/${encodeURIComponent(projectId)}/feature-view`
}

function featureDetailPath(projectId, featureId) {
  return `/api/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}`
}

function useFeatureView(projectId) {
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState({ data: null, loading: Boolean(projectId), error: null, projectId, etag: null })

  useEffect(() => {
    let current = true
    if (!projectId) {
      setState({ data: null, loading: false, error: null, projectId: null, etag: null })
      return () => {
        current = false
      }
    }

    setState({ data: null, loading: true, error: null, projectId, etag: null })
    requestFeatureJson(featureViewPath(projectId))
      .then(({ data, etag }) => {
        if (!current) return
        if (!isFeatureView(data, projectId)) {
          setState({ data: null, loading: false, error: invalidResponse('The Project Feature view response is incomplete.'), projectId, etag: null })
          return
        }
        setState({ data, loading: false, error: null, projectId, etag: isGraphEtag(etag) ? etag : null })
      })
      .catch((error) => {
        if (current) setState({ data: null, loading: false, error, projectId, etag: null })
      })

    return () => {
      current = false
    }
  }, [projectId, reloadToken])

  return { ...state, reload: () => setReloadToken((value) => value + 1) }
}

function useFeatureDetail(projectId, featureId) {
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState({ data: null, loading: Boolean(projectId && featureId), error: null, projectId, featureId, etag: null })

  useEffect(() => {
    let current = true
    if (!projectId || !featureId) {
      setState({ data: null, loading: false, error: null, projectId: projectId || null, featureId: featureId || null, etag: null })
      return () => {
        current = false
      }
    }

    setState({ data: null, loading: true, error: null, projectId, featureId, etag: null })
    requestFeatureJson(featureDetailPath(projectId, featureId))
      .then(({ data, etag }) => {
        if (!current) return
        if (!isFeatureRecord(data, projectId) || String(data.id) !== String(featureId)) {
          setState({ data: null, loading: false, error: invalidResponse('The selected Project Feature response is incomplete.'), projectId, featureId, etag: null })
          return
        }
        setState({ data, loading: false, error: null, projectId, featureId, etag })
      })
      .catch((error) => {
        if (current) setState({ data: null, loading: false, error, projectId, featureId, etag: null })
      })

    return () => {
      current = false
    }
  }, [projectId, featureId, reloadToken])

  return { ...state, reload: () => setReloadToken((value) => value + 1) }
}

function stateLabel(value) {
  if (value === UNAVAILABLE || value == null) return 'Unavailable'
  return String(value).replaceAll('_', ' ')
}

function countLabel(value) {
  return isNonNegativeInteger(value) ? String(value) : 'Unknown'
}

function StatePill({ label, tone = 'planned' }) {
  return <span className={`pill pill-${tone}`}>{label}</span>
}

function failureFor(error, target = 'view') {
  if (error?.status === 401) {
    return {
      state: 'forbidden',
      title: 'Authentication required',
      detail: 'Sign in again to view this Project Feature authority.',
    }
  }
  if (error?.status === 403) {
    return {
      state: 'forbidden',
      title: 'Feature authority unavailable',
      detail: 'This Project Feature information is unavailable to the current viewer.',
    }
  }
  if (error?.status === 404) {
    return {
      state: 'not-found',
      title: target === 'detail' ? 'Feature not found' : 'Project not found',
      detail: target === 'detail'
        ? 'The selected Feature is unavailable in the current authorized Project.'
        : 'This Project is unavailable in the current authorized scope.',
    }
  }
  if (error?.status === 413) {
    return {
      state: 'bounded-unavailable',
      title: 'Feature view is too large',
      detail: 'The complete Feature view exceeds its safe bound. Reload the view or use the bounded Feature list.',
    }
  }
  if (error?.incompleteResponse) {
    return {
      state: 'request-failed',
      title: target === 'detail' ? 'Feature detail unavailable' : 'Feature view unavailable',
      detail: 'The Project Feature response was incomplete or belonged to another Project.',
    }
  }
  return {
    state: 'request-failed',
    title: target === 'detail' ? 'Feature detail unavailable' : 'Feature view unavailable',
    detail: 'The Project Feature authority could not be loaded. Please try again.',
  }
}

function formatObservedAt(value) {
  if (!isNonEmptyString(value)) return 'Unavailable'
  return value
}

function domainText(domain) {
  if (domain.mappingState === 'UNMAPPED') return 'Unknown domain'
  return domain.label
}

function FeatureRow({ feature, onOpen }) {
  const primaryDomain = feature.primaryDomain
  const contributionCount = feature.contributions.length
  const requirementCount = feature.requirementBindings.length
  return (
    <li
      className="min-w-0"
      data-feature-id={feature.id}
      data-feature-lifecycle={feature.lifecycle}
      data-feature-mapping-state={primaryDomain.mappingState}
    >
      <button
        type="button"
        className="card block w-full min-w-0 overflow-hidden p-4 text-left transition hover:border-[var(--action-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--action-primary)]"
        onClick={(event) => onOpen(feature, event)}
        aria-label={`Open Feature ${feature.code}`}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <code className="block break-all text-[11px] text-muted">{feature.code}</code>
            <h3 className="mt-1 break-words text-base font-bold">{feature.title}</h3>
          </div>
          <StatePill label={stateLabel(feature.lifecycle)} tone={feature.lifecycle === 'ACTIVE' ? 'active' : feature.lifecycle === 'RETIRED' ? 'done' : 'planned'} />
        </div>
        <p className="mt-2 break-words text-xs text-muted">{feature.outcome}</p>
        <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2">
            <dt className="text-[10px] font-semibold text-muted">Primary Domain</dt>
            <dd className="mt-1 break-words text-xs font-semibold">{domainText(primaryDomain)}</dd>
            <dd className="break-all text-[10px] text-muted">{primaryDomain.domainId}</dd>
          </div>
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2">
            <dt className="text-[10px] font-semibold text-muted">Unique Work</dt>
            <dd className="mt-1 break-words text-xs font-semibold">{countLabel(feature.uniqueWorkCount)}</dd>
            <dd className="break-words text-[10px] text-muted">{contributionCount} contributing Domain{contributionCount === 1 ? '' : 's'}</dd>
          </div>
        </dl>
        <div className="mt-3 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
          <span>{requirementCount} requirement binding{requirementCount === 1 ? '' : 's'}</span>
          <span>Evidence: {stateLabel(feature.evidenceState)}</span>
          <span>Version {feature.version}</span>
        </div>
      </button>
    </li>
  )
}

function FeatureDetail({ feature }) {
  const primaryDomain = feature.primaryDomain
  return (
    <div className="space-y-5" data-testid="feature-detail-content" data-feature-detail-id={feature.id}>
      <section aria-label="Feature summary">
        <SectionTitle caption="Project-local authority record">Feature summary</SectionTitle>
        <dl className="grid min-w-0 gap-2 text-xs sm:grid-cols-2">
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2 sm:col-span-2"><dt className="text-[10px] text-muted">Title</dt><dd className="mt-1 break-words font-semibold">{feature.title}</dd></div>
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2"><dt className="text-[10px] text-muted">Code</dt><dd className="mt-1 break-all font-semibold">{feature.code}</dd></div>
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2"><dt className="text-[10px] text-muted">Lifecycle</dt><dd className="mt-1 font-semibold">{stateLabel(feature.lifecycle)}</dd></div>
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2"><dt className="text-[10px] text-muted">Version</dt><dd className="mt-1 font-semibold">{feature.version}</dd></div>
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2"><dt className="text-[10px] text-muted">Evidence state</dt><dd className="mt-1 break-words font-semibold">{stateLabel(feature.evidenceState)}</dd></div>
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2"><dt className="text-[10px] text-muted">Canonical Feature reference</dt><dd className="mt-1 break-all font-semibold">{feature.canonicalFeatureKey ?? 'Not linked'}</dd></div>
          <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2"><dt className="text-[10px] text-muted">Snapshot reference</dt><dd className="mt-1 break-all font-semibold">{feature.governanceSnapshotId ?? 'Unavailable'}</dd></div>
        </dl>
      </section>

      <section aria-label="Feature problem and outcome" className="space-y-3">
        <div><h3 className="text-xs font-bold">Problem</h3><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted">{feature.problem}</p></div>
        <div><h3 className="text-xs font-bold">Outcome</h3><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted">{feature.outcome}</p></div>
      </section>

      <section aria-label="Feature Domains">
        <SectionTitle caption="Primary and supporting responsibilities">Domains</SectionTitle>
        <div className="space-y-2">
          <div className="min-w-0 rounded-lg border border-[var(--border)] p-3">
            <p className="text-[10px] font-semibold text-muted">Primary Domain</p>
            <p className="mt-1 break-words text-xs font-semibold">{domainText(primaryDomain)}</p>
            <code className="mt-1 block break-all text-[10px] text-muted">{primaryDomain.domainId}</code>
          </div>
          {feature.contributions.length === 0 ? <p className="text-xs text-muted">No supporting Domain responsibilities recorded.</p> : (
            <ul className="space-y-2" aria-label="Supporting Domain responsibilities">
              {feature.contributions.map((contribution) => (
                <li key={contribution.id} className="min-w-0 rounded-lg border border-[var(--border)] p-3">
                  <p className="break-words text-xs font-semibold">{contribution.label || 'Unknown domain'}</p>
                  <code className="mt-1 block break-all text-[10px] text-muted">{contribution.domainId} · {stateLabel(contribution.mappingState)}</code>
                  <p className="mt-2 whitespace-pre-wrap break-words text-[11px] text-muted">{contribution.responsibility}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Feature WorkItem links">
        <SectionTitle caption="Explicit WorkItem relationships and derived allocation state">WorkItem links</SectionTitle>
        {feature.workLinks.length === 0 ? <p className="text-xs text-muted">No WorkItem links recorded.</p> : (
          <ul className="space-y-2">
            {feature.workLinks.map((link) => (
              <li key={link.id} className="min-w-0 rounded-lg border border-[var(--border)] p-3">
                <p className="break-words text-xs font-semibold">{link.workItem.code} · {link.workItem.title}</p>
                <p className="mt-1 break-all text-[10px] text-muted">{link.workItemId}</p>
                <p className="mt-2 break-words text-[11px] text-muted">Allocation: {stateLabel(link.allocationState)}{link.allocationBps == null ? '' : ` · ${link.allocationBps} bps`}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Feature requirement evidence">
        <SectionTitle caption="Pinned requirement revisions and explicit evidence state">Requirement evidence</SectionTitle>
        {feature.requirementBindings.length === 0 ? <p className="text-xs text-muted">No requirement bindings recorded.</p> : (
          <ul className="space-y-2">
            {feature.requirementBindings.map((binding) => (
              <li key={binding.id} className="min-w-0 rounded-lg border border-[var(--border)] p-3">
                <p className="break-words text-xs font-semibold">{binding.sourceNamespace} · {binding.requirementKey}</p>
                <p className="mt-1 break-all text-[10px] text-muted">Snapshot {binding.governanceSnapshotId}</p>
                <p className="mt-1 break-words text-[11px] text-muted">{binding.acceptanceRef}</p>
                <p className="mt-1 break-words text-[11px] text-muted">Binding: {stateLabel(binding.bindingState)} · revision {binding.revisionHash}</p>
                {binding.canonicalSubject && <p className="mt-1 break-words text-[11px] text-muted">{binding.canonicalSubject}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Feature evidence records">
        <SectionTitle caption="Evidence references are supplied by the authority">Evidence</SectionTitle>
        {feature.evidence.length === 0 ? <p className="text-xs text-muted">No evidence references recorded.</p> : (
          <ul className="space-y-2">
            {feature.evidence.map((evidence, index) => (
              <li key={`${evidence.ref || 'evidence'}-${index}`} className="min-w-0 rounded-lg border border-[var(--border)] p-3 text-[11px]">
                <span className="font-semibold">{stateLabel(evidence.state)}</span>
                {evidence.ref && <span className="ml-2 break-all text-muted">{evidence.ref}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function FeatureDrawer({ projectId, featureId, detail, onClose, canMutate, onAction, suspended = false }) {
  const panelRef = useRef(null)
  const closeButtonRef = useRef(null)
  const actionOpenerRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!featureId) return undefined
    const previouslyFocused = document.activeElement
    return () => {
      actionOpenerRef.current = null
      if (previouslyFocused instanceof HTMLElement && previouslyFocused !== document.body && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [projectId, featureId])

  useEffect(() => {
    if (!featureId || suspended) return undefined
    let active = true
    let focusTimeout = null
    const frame = requestAnimationFrame(() => {
      const opener = actionOpenerRef.current
      actionOpenerRef.current = null
      if (opener?.projectId === projectId && opener?.featureId === featureId && opener.element?.isConnected && panelRef.current?.contains(opener.element) && !opener.element.disabled) {
        opener.element.focus()
      } else if (!panelRef.current?.contains(document.activeElement)) closeButtonRef.current?.focus()
    })

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    function reclaimFocusIfEscapedToBody() {
      clearTimeout(focusTimeout)
      focusTimeout = setTimeout(() => {
        if (!active || document.activeElement !== document.body) return
        panelRef.current?.querySelector(FOCUSABLE_SELECTOR)?.focus()
      }, 0)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusout', reclaimFocusIfEscapedToBody, true)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      clearTimeout(focusTimeout)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusout', reclaimFocusIfEscapedToBody, true)
    }
  }, [projectId, featureId, suspended])

  if (!featureId) return null
  const detailRequestIsCurrent = detail.projectId != null
    && projectId != null
    && String(detail.projectId) === String(projectId)
    && detail.featureId != null
    && String(detail.featureId) === String(featureId)
  const detailDataIsCurrent = detailRequestIsCurrent
    && isRecord(detail.data)
    && String(detail.data.projectId) === String(projectId)
    && String(detail.data.id) === String(featureId)
  const failure = detailRequestIsCurrent && detail.error ? failureFor(detail.error, 'detail') : null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(17,24,39,0.58)] backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      data-testid="feature-detail-drawer-backdrop"
      inert={suspended ? '' : undefined}
      aria-hidden={suspended ? 'true' : undefined}
    >
      <aside
        ref={panelRef}
        className="min-h-full w-full max-w-lg overflow-y-auto bg-[var(--surface-card)] p-5 shadow-xl max-md:p-4"
        role="dialog"
        aria-modal={suspended ? undefined : 'true'}
        aria-labelledby="feature-detail-title"
        data-testid="feature-detail-drawer"
      >
        <div className="mb-5 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold" style={{ color: 'var(--action-primary)' }}>Project · Features</p>
            <h2 id="feature-detail-title" className="mt-1 break-words text-lg font-bold">Feature detail</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="btn shrink-0 px-2 py-1" onClick={onClose} aria-label="Close feature detail">
            <X size={16} aria-hidden />
          </button>
        </div>
        <button type="button" className="btn mb-4 flex items-center gap-1 text-[11px]" onClick={onClose}>
          <ArrowLeft size={13} aria-hidden /> Back to Features
        </button>
        {!detailRequestIsCurrent || detail.loading ? (
          <div data-detail-view-state="loading" aria-label="Feature detail loading"><LoadingCard /></div>
        ) : failure ? (
          <div data-detail-view-state={failure.state}>
            <ErrorState title={failure.title} detail={failure.detail} retry={detail.reload} />
          </div>
        ) : !detailDataIsCurrent ? (
          <div data-detail-view-state="request-failed"><ErrorState title="Feature detail unavailable" detail="The selected Project Feature response is unavailable." retry={detail.reload} /></div>
        ) : (
          <>
            <FeatureDetail feature={detail.data} />
            <FeatureOwnerActions
              canMutate={canMutate}
              feature={detail.data}
              featureEtag={detail.etag}
              onAction={(action, element) => {
                actionOpenerRef.current = { projectId, featureId, element }
                onAction?.(action)
              }}
            />
          </>
        )}
      </aside>
    </div>
  )
}

export default function ProjectFeatureView({ projectId }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedFeatureId = searchParams.get('featureId') || null
  const openerRef = useRef(null)
  const openedFromListRef = useRef(false)
  const [lifecycle, setLifecycle] = useState('ALL')
  const [formAction, setFormAction] = useState(null)
  const formContextRef = useRef(null)
  formContextRef.current = { projectId, featureId: selectedFeatureId, action: formAction }
  const view = useFeatureView(projectId)
  const detail = useFeatureDetail(projectId, selectedFeatureId)

  useEffect(() => {
    setLifecycle('ALL')
  }, [projectId])

  useEffect(() => {
    setFormAction(null)
  }, [projectId, selectedFeatureId])

  const featureUrl = useCallback((featureId) => {
    const params = new URLSearchParams(searchParams.toString())
    if (featureId) params.set('featureId', featureId)
    else params.delete('featureId')
    const query = params.toString()
    return query ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])

  const openFeature = useCallback((feature, event) => {
    openerRef.current = event.currentTarget
    openedFromListRef.current = true
    router.push(featureUrl(feature.id))
  }, [featureUrl, router])

  const closeFeature = useCallback(() => {
    if (!selectedFeatureId) return
    if (openedFromListRef.current) {
      openedFromListRef.current = false
      router.back()
      return
    }
    router.replace(featureUrl(null))
  }, [featureUrl, router, selectedFeatureId])

  const dataIsCurrent = view.projectId === projectId && (!view.data || String(view.data.projectId) === String(projectId))
  const detailDataIsCurrent = detail.projectId != null
    && projectId != null
    && String(detail.projectId) === String(projectId)
    && detail.featureId != null
    && String(detail.featureId) === String(selectedFeatureId)
    && isRecord(detail.data)
    && String(detail.data.projectId) === String(projectId)
    && String(detail.data.id) === String(selectedFeatureId)
  const requestFailure = view.error ? failureFor(view.error) : null
  const features = view.data?.features || []
  const filteredFeatures = useMemo(
    () => lifecycle === 'ALL' ? features : features.filter((feature) => feature.lifecycle === lifecycle),
    [features, lifecycle]
  )
  const ownerCapability = dataIsCurrent && !view.loading && !requestFailure && isGraphEtag(view.etag)
  const openForm = useCallback((action) => {
    setFormAction(action)
  }, [])
  const closeForm = useCallback((nextAction = null) => {
    const currentContext = formContextRef.current
    if (currentContext.projectId !== projectId || currentContext.featureId !== selectedFeatureId || currentContext.action !== formAction) return
    setFormAction(nextAction)
  }, [formAction, projectId, selectedFeatureId])
  const refreshAfterMutation = useCallback(async () => {
    const currentContext = formContextRef.current
    if (currentContext.projectId !== projectId) return
    if (currentContext.action === formAction && currentContext.featureId === selectedFeatureId) setFormAction(null)
    view.reload()
    if (selectedFeatureId) detail.reload()
  }, [detail, formAction, projectId, selectedFeatureId, view])

  const formRequiresFeature = [FEATURE_FORM_ACTIONS.EDIT, FEATURE_FORM_ACTIONS.CONTRIBUTIONS, FEATURE_FORM_ACTIONS.WORK_LINKS, FEATURE_FORM_ACTIONS.REQUIREMENTS, FEATURE_FORM_ACTIONS.DELETE].includes(formAction)
  const formVisible = Boolean(ownerCapability && formAction && (!formRequiresFeature || detailDataIsCurrent))
  // The Project-keyed owner retains unresolved attempts even while its dialog
  // is hidden by a reload/refusal. A new Project always gets a new owner.
  const forms = (
    <ProjectFeatureForms
      key={projectId}
      projectId={projectId}
      action={formVisible ? formAction : null}
      feature={detailDataIsCurrent ? detail.data : null}
      featureEtag={detailDataIsCurrent ? detail.etag : null}
      graphEtag={ownerCapability ? view.etag : null}
      features={dataIsCurrent ? features : []}
      onActionChange={closeForm}
      onSaved={refreshAfterMutation}
    />
  )

  if (view.loading || view.projectId !== projectId) {
    return (
      <div data-testid="project-feature-view" data-view-state="loading" aria-label="Features loading">
        <LoadingCard />
        <FeatureDrawer projectId={projectId} featureId={selectedFeatureId} detail={{ ...detail, data: null, loading: true, error: null }} onClose={closeFeature} suspended={formVisible} />
        {forms}
      </div>
    )
  }

  if (requestFailure) {
    return (
      <div data-testid="project-feature-view" data-view-state={requestFailure.state}>
        <ErrorState title={requestFailure.title} detail={requestFailure.detail} retry={view.reload} />
        <FeatureDrawer projectId={projectId} featureId={selectedFeatureId} detail={{ ...detail, data: null, loading: false, error: view.error, reload: view.reload }} onClose={closeFeature} suspended={formVisible} />
        {forms}
      </div>
    )
  }

  if (!view.data || !dataIsCurrent || !Array.isArray(view.data.features)) {
    return (
      <div data-testid="project-feature-view" data-view-state="request-failed">
        <ErrorState title="Feature view unavailable" detail="The Project Feature response was incomplete or belonged to another Project." retry={view.reload} />
        <FeatureDrawer projectId={projectId} featureId={selectedFeatureId} detail={{ ...detail, data: null, loading: false, error: invalidResponse('The Project Feature response is unavailable.'), reload: view.reload }} onClose={closeFeature} suspended={formVisible} />
        {forms}
      </div>
    )
  }

  const empty = features.length === 0
  const filteredEmpty = !empty && filteredFeatures.length === 0
  return (
    <div className="min-w-0 space-y-5" data-testid="project-feature-view" data-view-state={empty ? 'empty' : filteredEmpty ? 'filtered-empty' : 'ready'}>
      <PageHeader
        eyebrow="Project · Delivery Design"
        title="Features"
        subtitle="Explicit Project Feature authority and its read-only evidence"
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            {ownerCapability && <button type="button" className="btn btn-primary text-[11px]" onClick={() => openForm(FEATURE_FORM_ACTIONS.CREATE)}>Create Feature</button>}
            {ownerCapability && <button type="button" className="btn text-[11px]" onClick={() => openForm(FEATURE_FORM_ACTIONS.SNAPSHOTS)}>Snapshot evidence</button>}
            {ownerCapability && <button type="button" className="btn text-[11px]" onClick={() => openForm(FEATURE_FORM_ACTIONS.RESTORE)}>Restore deleted Feature</button>}
            <StatePill label="Snapshot unavailable" tone="planned" />
          </div>
        )}
      />

      <section className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Project Feature summary">
        <Kpi label="Feature rows" value={String(features.length)} meta="Current Project records" />
        <Kpi label="Project work" value={countLabel(view.data.uniqueWorkCount)} meta="Each active item counted once, including unlinked work" />
        <Kpi label="Observed" value={formatObservedAt(view.data.observedAt)} meta="Server response timestamp" />
      </section>

      <Card warm>
        <p className="text-xs leading-5 text-muted" role="note">
          Feature rows come from ProjectFeature authority. Snapshot evidence is unavailable in this Phase B aggregate; each Feature keeps its supplied evidence and requirement binding state.
        </p>
      </Card>

      <section aria-label="Feature filters" className="card min-w-0 p-4">
        <label className="block max-w-xs text-[11px] font-bold text-muted" htmlFor="feature-lifecycle-filter">
          Lifecycle filter
          <select
            id="feature-lifecycle-filter"
            className="input mt-1 w-full text-xs"
            value={lifecycle}
            onChange={(event) => setLifecycle(event.target.value)}
          >
            <option value="ALL">All lifecycle</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="RETIRED">Retired</option>
          </select>
        </label>
      </section>

      {empty ? (
        <section data-view-state="empty" aria-label="Project Features empty">
          <EmptyState title="No Features in this Project" hint="The authorized Project Feature authority returned no active, non-deleted Features." />
        </section>
      ) : filteredEmpty ? (
        <section data-view-state="filtered-empty" aria-label="Project Features filtered empty">
          <EmptyState title="No Features match this lifecycle" hint="Clear the lifecycle filter to view the available Project Features." action={<button type="button" className="btn text-[11px]" onClick={() => setLifecycle('ALL')}>Clear lifecycle filter</button>} />
        </section>
      ) : (
        <section aria-label="Project Features" data-view-state="feature-list">
          <SectionTitle caption="Select a Feature to inspect its complete read-only record">Project Features</SectionTitle>
          <ul className="grid min-w-0 gap-3 lg:grid-cols-2" aria-label="Project Features list">
            {filteredFeatures.map((feature) => <FeatureRow key={feature.id} feature={feature} onOpen={openFeature} />)}
          </ul>
        </section>
      )}

      <FeatureDrawer
        projectId={projectId}
        featureId={selectedFeatureId}
        detail={detail}
        onClose={closeFeature}
        canMutate={ownerCapability}
        onAction={openForm}
        suspended={formVisible}
      />
      {forms}
    </div>
  )
}
