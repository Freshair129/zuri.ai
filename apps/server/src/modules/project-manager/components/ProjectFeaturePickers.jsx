'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import {
  PROJECT_DOMAIN_CATALOG,
  resolveProjectDomain,
  UNKNOWN_PROJECT_DOMAIN_LABEL,
} from '@/modules/project-manager/project-domain-catalog'

// @req FR-252 — relationship editors select canonical Domains and active
// same-Project WorkItems before submitting a Project Feature mutation.
// @spec ADR-097, SDD-097 — Plan 24 §7.3 relationship editor contract.
// @tested tests/unit/project-feature-pickers.test.js

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asIdSet(value) {
  const values = value instanceof Set ? [...value] : Array.isArray(value) ? value : []
  return new Set(values.map(text).filter(Boolean))
}

/**
 * Build the options that a human may newly select. The catalog is the only
 * source of selectable Domain identities; imported values are never inferred
 * from a title, route key, or label.
 */
export function normalizeProjectDomainOptions({ value, excludeDomainIds = [] } = {}) {
  const selectedId = text(value)
  const excludedIds = asIdSet(excludeDomainIds)
  const catalogRows = PROJECT_DOMAIN_CATALOG
    .map(({ domainId }) => resolveProjectDomain(domainId))
    .filter((row) => row.mappingState === 'MAPPED')
  const options = catalogRows.filter((row) => !excludedIds.has(row.domainId))
  const selectedKnown = catalogRows.find((row) => row.domainId === selectedId) || null
  const selectedInOptions = options.some((row) => row.domainId === selectedId)
  const current = selectedId && !selectedInOptions
    ? (selectedKnown || resolveProjectDomain(selectedId))
    : null

  return {
    value: selectedId,
    options,
    current: current ? { ...current, disabled: true } : null,
  }
}

export function isProjectWorkItemId(value) {
  return UUID_PATTERN.test(text(value))
}

/**
 * The Work API already scopes and filters its query. This second check keeps a
 * malformed, stale, or cross-Project response out of the relationship editor
 * and deliberately does not manufacture a global fallback row.
 */
export function isActiveProjectWorkItem(row, projectId) {
  const expectedProjectId = text(projectId)
  if (!isProjectWorkItemId(expectedProjectId) || !isRecord(row) || !isProjectWorkItemId(row.id)) return false
  if (!isRecord(row.workstream) || text(row.workstream.projectId) !== expectedProjectId) return false
  if (row.deletedAt != null || row.workstream.deletedAt != null) return false
  if (String(row.workstream.status || '').toUpperCase() === 'ARCHIVED') return false
  if (isRecord(row.workstream.project) && text(row.workstream.project.id) !== expectedProjectId) return false
  return true
}

export function normalizeProjectWorkItems(items, projectId) {
  const seen = new Set()
  if (!Array.isArray(items)) return []
  return items.filter((row) => {
    if (!isActiveProjectWorkItem(row, projectId)) return false
    const id = text(row.id)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function projectWorkItemLabel(row) {
  if (!isRecord(row)) return 'WorkItem'
  const code = text(row.code)
  const title = text(row.title)
  if (code && title) return `${code} · ${title}`
  return code || title || 'WorkItem'
}

export function projectWorkItemsPath(projectId, query = '') {
  const parts = []
  const scopedProjectId = text(projectId)
  const search = text(query)
  if (scopedProjectId) parts.push(`projectId=${encodeURIComponent(scopedProjectId)}`)
  if (search) parts.push(`q=${encodeURIComponent(search)}`)
  return parts.length > 0 ? `/api/work?${parts.join('&')}` : '/api/work'
}

export function visibleProjectWorkItems(items, appliedProjectId, projectId) {
  const applied = text(appliedProjectId)
  const expected = text(projectId)
  if (applied !== expected) return []
  return normalizeProjectWorkItems(items, expected)
}

function describedBy(hintId, supplied) {
  return [...new Set([hintId, ...text(supplied).split(/\s+/).filter(Boolean)])].join(' ')
}

export function DomainPicker({ value = '', onChange = () => {}, label = 'Domain', disabled = false, required = false, excludeDomainIds = [], id: suppliedId = '', name = '', dataFieldPath = '', 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy = '' }) {
  const generatedId = useId()
  const id = text(suppliedId) || generatedId
  const hintId = `${id}-hint`
  const selection = normalizeProjectDomainOptions({ value, excludeDomainIds })
  const selectableIds = new Set(selection.options.map((row) => row.domainId))
  const handleChange = (event) => {
    const nextValue = text(event.currentTarget.value)
    if (!nextValue || selectableIds.has(nextValue)) onChange(nextValue)
  }
  const current = selection.current

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">{label}</label>
      <select
        id={id}
        name={text(name) || undefined}
        data-field-path={text(dataFieldPath) || text(name) || undefined}
        className="input"
        value={selection.value}
        onChange={handleChange}
        disabled={disabled}
        required={required}
        aria-invalid={ariaInvalid}
        aria-describedby={describedBy(hintId, ariaDescribedBy)}
      >
        <option value="">Choose a canonical Domain</option>
        {current && (
          <option value={current.domainId} disabled>
            {current.mappingState === 'UNMAPPED' ? UNKNOWN_PROJECT_DOMAIN_LABEL : `${current.label} (current)`}
          </option>
        )}
        {selection.options.map((row) => (
          <option key={row.domainId} value={row.domainId}>{row.label}</option>
        ))}
      </select>
      <p id={hintId} className="text-[11px] text-muted">
        {current?.mappingState === 'UNMAPPED'
          ? <>UNMAPPED existing Domain · ID: <code>{current.domainId}</code></>
          : selection.value
            ? <>ID: <code>{selection.value}</code></>
            : 'Choose a canonical execution Domain.'}
      </p>
    </div>
  )
}

function responseItems(body) {
  return isRecord(body) && Array.isArray(body.items) ? body.items : null
}

export function WorkItemPicker({ projectId, value = '', onChange = () => {}, label = 'WorkItem', disabled = false, required = false, id: suppliedId = '', name = '', dataFieldPath = '', 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy = '' }) {
  const generatedId = useId()
  const id = text(suppliedId) || generatedId
  const queryId = `${id}-query`
  const hintId = `${id}-hint`
  const scopedProjectId = text(projectId)
  const selectedValue = text(value)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [appliedProjectId, setAppliedProjectId] = useState('')
  const contextRef = useRef(0)
  const requestRef = useRef(0)
  const selectedItemRef = useRef(null)
  const valueRef = useRef(selectedValue)
  valueRef.current = selectedValue

  useEffect(() => {
    if (appliedProjectId !== scopedProjectId) {
      selectedItemRef.current = null
      return
    }
    const selected = items.find((row) => row.id === selectedValue) || null
    selectedItemRef.current = selected
  }, [appliedProjectId, items, scopedProjectId, selectedValue])

  useEffect(() => {
    const generation = contextRef.current + 1
    contextRef.current = generation
    requestRef.current += 1
    selectedItemRef.current = null
    setAppliedProjectId(scopedProjectId)
    setItems([])
    setQuery('')
    setTruncated(false)
    setError('')
    setLoading(false)

    if (!UUID_PATTERN.test(scopedProjectId)) {
      if (scopedProjectId) setError('Project context is unavailable.')
      return () => {
        if (contextRef.current === generation) contextRef.current += 1
      }
    }

    void loadWorkItems({ projectId: scopedProjectId, query: '', generation })
    return () => {
      if (contextRef.current === generation) contextRef.current += 1
    }
  }, [scopedProjectId])

  async function loadWorkItems({ projectId: requestedProjectId, query: requestedQuery, generation }) {
    if (generation !== contextRef.current) return
    const request = requestRef.current + 1
    requestRef.current = request
    setLoading(true)
    setError('')
    try {
      const response = await fetch(projectWorkItemsPath(requestedProjectId, requestedQuery), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !responseItems(body)) throw new Error('WorkItems unavailable')
      if (generation !== contextRef.current || request !== requestRef.current) return

      const normalized = normalizeProjectWorkItems(body.items, requestedProjectId)
      const selected = selectedItemRef.current
      const selectedId = valueRef.current
      const preserved = selected && selected.id === selectedId && isActiveProjectWorkItem(selected, requestedProjectId)
        ? selected
        : null
      const nextItems = preserved && !normalized.some((row) => row.id === preserved.id)
        ? [preserved, ...normalized]
        : normalized
      selectedItemRef.current = nextItems.find((row) => row.id === selectedId) || null
      setItems(nextItems)
      setTruncated(body.truncated === true)
    } catch {
      if (generation !== contextRef.current || request !== requestRef.current) return
      setItems((previous) => previous)
      setTruncated(false)
      setError('Active WorkItems could not be loaded for this Project.')
    } finally {
      if (generation === contextRef.current && request === requestRef.current) setLoading(false)
    }
  }

  const submitSearch = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!UUID_PATTERN.test(scopedProjectId)) {
      setError('Project context is unavailable.')
      return
    }
    void loadWorkItems({ projectId: scopedProjectId, query, generation: contextRef.current })
  }

  const visibleItems = visibleProjectWorkItems(items, appliedProjectId, scopedProjectId)
  const projectContextReady = appliedProjectId === scopedProjectId
  const selectedRow = visibleItems.find((row) => row.id === selectedValue) || null
  const selectedMissing = projectContextReady && Boolean(selectedValue && !selectedRow)

  return (
    <div className="space-y-2">
      <div role="search" className="space-y-1">
        <label htmlFor={queryId} className="block text-xs font-medium">Search WorkItems</label>
        <div className="flex gap-2">
          <input
            id={queryId}
            className="input min-w-0 flex-1"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitSearch(event)
            }}
            placeholder="Search by code or title"
            disabled={disabled || !projectContextReady || loading || !UUID_PATTERN.test(scopedProjectId)}
          />
          <button type="button" className="btn text-[11px]" onClick={submitSearch} disabled={disabled || loading || !UUID_PATTERN.test(scopedProjectId)}>Search</button>
        </div>
      </div>
      <div>
        <label htmlFor={id} className="block text-xs font-medium">{label}</label>
        <select
          id={id}
          name={text(name) || undefined}
          data-field-path={text(dataFieldPath) || text(name) || undefined}
          className="input"
          value={selectedValue}
          onChange={(event) => {
            const nextValue = text(event.currentTarget.value)
             if (visibleItems.some((row) => row.id === nextValue)) onChange(nextValue)
           }}
           disabled={disabled || !projectContextReady || loading || !UUID_PATTERN.test(scopedProjectId)}
           required={required}
           aria-invalid={ariaInvalid}
           aria-describedby={describedBy(hintId, ariaDescribedBy)}
         >
          <option value="">Choose an active WorkItem</option>
          {selectedMissing && <option value={selectedValue} disabled>Selected WorkItem unavailable</option>}
           {visibleItems.map((row) => (
            <option key={row.id} value={row.id}>{projectWorkItemLabel(row)}</option>
          ))}
        </select>
        <p id={hintId} className="text-[11px] text-muted">
          {selectedRow
            ? <>ID: <code>{selectedRow.id}</code> · active WorkItem in this Project.</>
          : selectedMissing
              ? <>Current selection is retained for server validation; no scoped label is available. ID: <code>{selectedValue}</code></>
              : 'Search active WorkItems in this Project.'}
        </p>
      </div>
      <p className="text-[11px] text-muted">Allocation is entered separately in basis points.</p>
      {loading && <p className="text-xs text-muted" role="status" aria-live="polite">Loading active WorkItems…</p>}
      {projectContextReady && error && <p className="text-xs text-muted" role="alert">{error}</p>}
      {projectContextReady && truncated && <p className="text-xs text-muted" role="status">More WorkItems match. Refine the search.</p>}
      {projectContextReady && !loading && !error && visibleItems.length === 0 && (
        <p className="text-xs text-muted" role="status">
          {query ? 'No matching active WorkItems in this Project.' : 'No active WorkItems in this Project.'}
        </p>
      )}
    </div>
  )
}
