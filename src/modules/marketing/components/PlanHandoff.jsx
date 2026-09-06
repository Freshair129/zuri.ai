'use client'

// @req FR-154 — approved Marketing revisions can be previewed and committed to
// a same-Business Workspace through the verified handoff contract.
// @spec SDD-086 — KPI_ATTAINMENT needs PM metric targets and observations;
// action completion alone does not indicate Marketing success.
// @tested tests/unit/marketing-strategy-ui.test.js, tests/e2e/marketing-strategy.spec.js

import { useEffect, useMemo, useState } from 'react'
import { Card, Field, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api } from '@/modules/project-manager/components/useApi'
import { handoffPath } from './marketing-contract'
import { InlineNotice } from './MarketingState'

function itemList(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => Array.isArray(item) ? item : item ? [item] : [])
  return []
}

function itemLabel(item) {
  if (typeof item === 'string') return item
  return item?.name || item?.title || item?.code || 'Unnamed PM item'
}

function handoffSummary(result, selectedWorkspace) {
  const preview = result?.preview || {}
  const scope = preview.scope || result?.scope || {}
  const target = preview.target || result?.target || {}
  const project = preview.project || target.project || result?.project || result?.envelope?.project || {}
  const diff = preview.diff || preview.changes || result?.diff || {}
  return {
    businessName: preview.business?.name || preview.businessName || scope.business?.name || scope.businessName || 'Selected Business',
    workspaceName: preview.workspace?.name || preview.workspaceName || target.workspace?.name || selectedWorkspace?.name || 'Selected Workspace',
    projectName: project.name || project.title || preview.projectName || 'PM Project preview',
    projectId: project.id || project.projectId || preview.projectId || result?.projectId || null,
    inserts: itemList(preview.inserts ?? diff.inserts ?? result?.inserts),
    updates: itemList(preview.updates ?? diff.updates ?? result?.updates),
    conflicts: itemList(preview.conflicts ?? diff.conflicts ?? result?.conflicts),
  }
}

function ChangeGroup({ label, items, tone }) {
  return (
    <section className="rounded-lg border border-[var(--border)] p-2">
      <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-bold">{label}</p><span className={`pill ${tone}`}>{items.length}</span></div>
      {items.length > 0 ? <ul className="mt-2 space-y-1 text-[10px] text-muted">{items.map((item, index) => <li key={index}>{itemLabel(item)}</li>)}</ul> : <p className="mt-2 text-[10px] text-muted">None</p>}
    </section>
  )
}

export function PlanHandoff({ businessId, plan }) {
  const scope = useScope()
  const [workspaceId, setWorkspaceId] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const workspaces = useMemo(() => (scope.workspaces || []).filter((workspace) => workspace.businessId === businessId), [scope.workspaces, businessId])
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId)
  const previewSummary = preview ? handoffSummary(preview, selectedWorkspace) : null
  const receiptSummary = receipt ? handoffSummary(receipt, selectedWorkspace) : null

  useEffect(() => {
    setPreview(null)
    setReceipt(null)
    setError(null)
    setWorkspaceId((current) => workspaces.some((workspace) => workspace.id === current) ? current : '')
  }, [businessId, plan?.id, plan?.version, workspaces])

  const requestPreview = async () => {
    if (!workspaceId) return
    setBusy(true)
    setError(null)
    setReceipt(null)
    try {
      const result = await api(handoffPath(plan.id), { method: 'POST', body: { businessId, workspaceId, expectedVersion: plan.version, action: 'preview' } })
      setPreview(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!workspaceId || !preview?.valid || !preview.previewHash) return
    setBusy(true)
    setError(null)
    try {
      const result = await api(handoffPath(plan.id), { method: 'POST', body: { businessId, workspaceId, expectedVersion: plan.version, action: 'commit', previewHash: preview.previewHash } })
      setReceipt(result.receipt || result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-4" data-testid="marketing-plan-handoff">
      <SectionTitle caption="Preview is read-only; commit returns a verified PM receipt">Project Manager handoff</SectionTitle>
      <InlineNotice>KPI progress needs PM metric targets and observations; action completion alone does not indicate Marketing success.</InlineNotice>
      {workspaces.length === 0 && <InlineNotice tone="error">No same-Business Workspace is available for this scope.</InlineNotice>}
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Target Workspace" hint="Only Workspaces belonging to this Business are shown.">
          <select className="input" value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setPreview(null); setReceipt(null) }} disabled={busy || workspaces.length === 0}>
            <option value="">Choose a Workspace</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name || workspace.code || workspace.id}</option>)}
          </select>
        </Field>
        <button type="button" className="btn btn-primary" onClick={requestPreview} disabled={busy || !workspaceId}>{busy ? 'Working…' : 'Preview PM handoff'}</button>
      </div>
      {error && <div className="mt-3"><InlineNotice tone="error">{error}</InlineNotice></div>}
      {preview && (
        <div className="mt-4 rounded-xl border border-[var(--border)] p-3" data-testid="marketing-handoff-preview">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold">PM preview</p><StatusPill status={preview.valid ? 'READY' : 'BLOCKED'} /></div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-3"><div><dt className="text-[10px] text-muted">Business</dt><dd className="text-xs font-semibold">{previewSummary.businessName}</dd></div><div><dt className="text-[10px] text-muted">Workspace</dt><dd className="text-xs font-semibold">{previewSummary.workspaceName}</dd></div><div><dt className="text-[10px] text-muted">Project</dt><dd className="text-xs font-semibold">{previewSummary.projectName}</dd></div></dl>
          {preview.errors?.length > 0 && <ul className="mt-2 list-disc pl-4 text-[11px] text-[var(--danger)]">{preview.errors.map((item, index) => <li key={index}>{item}</li>)}</ul>}
          <div className="mt-3 grid gap-2 md:grid-cols-3"><ChangeGroup label="Inserts" items={previewSummary.inserts} tone="pill-active" /><ChangeGroup label="Updates" items={previewSummary.updates} tone="pill-planned" /><ChangeGroup label="Conflicts" items={previewSummary.conflicts} tone="pill-blocked" /></div>
          {(preview.envelope || preview.previewHash) && <details className="mt-3 rounded-lg border border-[var(--border)] p-2"><summary className="cursor-pointer text-[10px] font-semibold">Technical preview details</summary>{preview.previewHash && <p className="mt-2 text-[10px] text-muted">Preview binding: <code>{preview.previewHash}</code></p>}{preview.envelope && <pre className="mt-2 max-h-48 overflow-auto bg-[var(--surface-muted)] p-2 text-[10px]">{JSON.stringify(preview.envelope, null, 2)}</pre>}</details>}
          <button type="button" className="btn btn-primary mt-3 text-[11px]" onClick={commit} disabled={busy || !preview.valid || !preview.previewHash}>Commit verified handoff</button>
        </div>
      )}
      {receipt && <div className="mt-4 rounded-xl border border-[var(--success)] bg-[var(--success-bg)] p-3" role="status" data-testid="marketing-handoff-receipt"><p className="text-xs font-bold">Handoff committed</p><p className="mt-1 text-xs">{receiptSummary.projectName}</p>{receiptSummary.projectId && <a className="btn mt-3 inline-flex text-[11px]" href={`/projects/${encodeURIComponent(receiptSummary.projectId)}`}>Open PM Project</a>}<details className="mt-3"><summary className="cursor-pointer text-[10px] font-semibold">Technical receipt details</summary><pre className="mt-2 max-h-48 overflow-auto text-[10px]">{JSON.stringify(receipt, null, 2)}</pre></details></div>}
    </Card>
  )
}
