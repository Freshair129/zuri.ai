// @req FR-085 — shared release holds and pre-attempt explanation on existing work surfaces.
// @tested tests/integration/work-release-gates.test.js, tests/e2e/pipeline-release-holds.spec.js
'use client'

import { useState } from 'react'
import { api } from './useApi'
import {PIPELINE_PROTECTED_WORK_STATUSES} from '@/lib/validation/enums'
import WorkReleaseNotice, {useWorkRelease,workReleaseError} from './WorkReleaseNotice'

/**
 * Inline status dropdown that PATCHes an entity endpoint on change.
 */
export default function StatusSelect({ entity, id, value, statuses, onChanged, initialRelease }) {
  const [refreshRelease,setRefreshRelease] = useState(false)
  const releaseState = useWorkRelease(entity === 'work' && (initialRelease === undefined || refreshRelease) ? id : null)
  const noticeState = initialRelease === undefined || refreshRelease ? releaseState : {release:initialRelease}
  const reloadRelease = () => {setRefreshRelease(true);releaseState.reload()}
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const endpoint = {
    work: `/api/work/${id}`,
    workstream: `/api/workstreams/${id}`,
    project: `/api/projects/${id}`,
    milestone: `/api/milestones/${id}`,
    gate: `/api/gates/${id}`,
    container: `/api/containers/${id}`,
  }[entity]

  return (
    <span className="inline-flex items-center gap-1">
      <select
        className="input w-auto px-1.5 py-1 text-[10px]"
        value={value}
        disabled={busy}
        aria-label={`${entity} status`}
        onChange={async (e) => {
          setBusy(true)
          setError(null)
          try {
            await api(endpoint, { method: 'PATCH', body: { status: e.target.value } })
            reloadRelease()
            onChanged?.()
          } catch (err) {
            setError(workReleaseError(err))
            reloadRelease()
          } finally {
            setBusy(false)
          }
        }}
      >
        {statuses.map((s) => (
          <option key={s} value={s} disabled={entity === 'work' && s !== value && PIPELINE_PROTECTED_WORK_STATUSES.includes(s) && !!(noticeState.loading || noticeState.error)}>
            {s.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {entity === 'work' && <WorkReleaseNotice {...noticeState} onReload={reloadRelease} />}
      {error && (
        <span className="text-[9px]" style={{ color: 'var(--danger)' }} role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
