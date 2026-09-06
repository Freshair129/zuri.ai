'use client'

import { useState } from 'react'
import { api } from './useApi'

/**
 * Inline status dropdown that PATCHes an entity endpoint on change.
 */
export default function StatusSelect({ entity, id, value, statuses, onChanged }) {
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
            onChanged?.()
          } catch (err) {
            setError(err.message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {statuses.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-[9px]" style={{ color: 'var(--danger)' }} role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
