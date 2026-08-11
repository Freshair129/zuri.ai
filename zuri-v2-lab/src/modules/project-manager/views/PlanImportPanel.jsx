'use client'

// Agent plan import: paste PlanEnvelope JSON → validate → dry-run preview
// (inserts/updates/conflicts) → confirm transactional commit. Plans are data,
// never executed.

import { useState } from 'react'
import { PageHeader, Card, SectionTitle, EmptyState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api } from '../components/useApi'

const SAMPLE_HINT = 'Paste a PlanEnvelope JSON (schemaVersion "1.0") — see contracts/sample-plan.json'

export default function PlanImportPanel() {
  const scope = useScope()
  const [text, setText] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [dryRun, setDryRun] = useState(null)
  const [errors, setErrors] = useState(null)
  const [committed, setCommitted] = useState(null)
  const [busy, setBusy] = useState(false)

  const parsePlan = () => {
    try {
      return JSON.parse(text)
    } catch {
      setErrors(['Input is not valid JSON'])
      return null
    }
  }

  const runDry = async () => {
    setErrors(null)
    setCommitted(null)
    setDryRun(null)
    const plan = parsePlan()
    if (!plan) return
    setBusy(true)
    try {
      const result = await api('/api/import/dry-run', {
        method: 'POST',
        body: { plan, workspaceId: workspaceId || undefined },
      })
      if (!result.valid && !result.preview) {
        setErrors(result.errors)
      } else {
        setDryRun(result)
        if (!result.valid) setErrors(result.errors)
      }
    } catch (err) {
      setErrors([err.message])
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    const plan = parsePlan()
    if (!plan) return
    setBusy(true)
    try {
      const result = await api('/api/import/commit', {
        method: 'POST',
        body: { plan, workspaceId: workspaceId || undefined },
      })
      if (result.committed) {
        setCommitted(result)
        setDryRun(null)
        scope.refresh()
      } else {
        setErrors(result.errors)
      }
    } catch (err) {
      setErrors([err.message])
    } finally {
      setBusy(false)
    }
  }

  const PreviewList = ({ title, rows, tone }) => (
    <div>
      <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-muted">{title} ({rows.length})</p>
      {rows.length === 0 ? (
        <p className="text-[10px] text-muted">none</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="rounded-lg px-2 py-1 text-[10px]" style={{ background: tone.bg, color: tone.fg }}>
              <b>{r.kind}</b> {r.code} — {r.title || r.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div>
      <PageHeader
        eyebrow="Agent plan import"
        title="Import Plan Envelope"
        subtitle="Structured plans generated outside the app: validate → dry-run → confirm. Nothing in a plan is ever executed as code."
      />
      <div className="grid grid-cols-[1.2fr_1fr] gap-4 max-md:grid-cols-1">
        <Card>
          <SectionTitle caption={SAMPLE_HINT}>Plan JSON</SectionTitle>
          <textarea
            className="input h-72 font-mono text-[10px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{ "schemaVersion": "1.0", "project": { ... }, "workstreams": [ ... ] }'
            aria-label="Plan envelope JSON"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label="Target workspace override">
              <option value="">Workspace from plan scope</option>
              {scope.workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
            <button type="button" className="btn" onClick={runDry} disabled={busy || !text.trim()}>
              {busy ? 'Working…' : 'Validate + dry run'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={commit}
              disabled={busy || !dryRun || !dryRun.valid}
              title={!dryRun ? 'Run a dry run first' : !dryRun.valid ? 'Resolve conflicts first' : 'Commit transactionally'}
            >
              Confirm import
            </button>
          </div>
        </Card>
        <div>
          {errors && (
            <Card className="mb-3" role="alert">
              <SectionTitle>Validation errors</SectionTitle>
              <ul className="space-y-1">
                {errors.map((e, i) => (
                  <li key={i} className="rounded-lg px-2 py-1 text-[10px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {e}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {dryRun?.preview && (
            <Card className="mb-3">
              <SectionTitle caption={`Target workspace: ${dryRun.workspace?.code || '?'} — no writes performed yet`}>
                Dry-run preview
              </SectionTitle>
              <div className="space-y-3">
                <PreviewList title="Inserts" rows={dryRun.preview.inserts} tone={{ bg: 'var(--success-bg)', fg: 'var(--success)' }} />
                <PreviewList title="Updates" rows={dryRun.preview.updates} tone={{ bg: 'var(--rest-blue)', fg: 'var(--rest-blue-text)' }} />
                <PreviewList title="Conflicts" rows={dryRun.preview.conflicts} tone={{ bg: 'var(--danger-bg)', fg: 'var(--danger)' }} />
                <p className="text-[10px] text-muted">{dryRun.preview.dependencyCount} dependency edge(s) in plan.</p>
              </div>
            </Card>
          )}
          {committed && (
            <Card>
              <SectionTitle>Imported ✓</SectionTitle>
              <p className="text-xs">
                Project <b>{committed.projectCode}</b> committed transactionally. Audit event recorded.
              </p>
              <a className="btn btn-primary mt-3 inline-block" href={`/projects/${committed.projectId}`}>
                Open project
              </a>
            </Card>
          )}
          {!errors && !dryRun && !committed && (
            <EmptyState title="No plan analyzed yet" hint="Paste plan JSON and run the dry run to preview inserts, updates and conflicts." />
          )}
        </div>
      </div>
    </div>
  )
}
