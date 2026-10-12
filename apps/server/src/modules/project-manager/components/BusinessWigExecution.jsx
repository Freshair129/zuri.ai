'use client'

// @req FR-270 — OWNER controls and read-only Business WIG execution projection.
// @spec ADR-101 D1/D5/D6, BR-001, BR-043
// @tested tests/unit/fr270-business-wig-execution-ui.test.js, tests/e2e/fr270-business-wig-execution.spec.js

import { useState } from 'react'
import { Archive, Plus } from 'lucide-react'
import { Card, Field, SectionTitle } from '@/components/ui'
import { api } from './useApi'

const STEP_LABELS = [
  ['report', 'Report on last week'],
  ['scoreboard', 'Update the scoreboard'],
  ['plan', 'Plan this week'],
]

function weekLabel(value) {
  if (!value) return 'week'
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short', day: 'numeric',
  }).format(new Date(value))
}

function byName(a, b) {
  return (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export default function BusinessWigExecution({ businessId, execution, goals = [], canManage = false, onSaved }) {
  const [lagSelections, setLagSelections] = useState({})
  const [measureForms, setMeasureForms] = useState({})
  const [valueInputs, setValueInputs] = useState({})
  const [commitmentForm, setCommitmentForm] = useState({ ownerPersonId: '', week: 'current', leadMeasureId: '', title: '' })
  const [busyKeys, setBusyKeys] = useState(() => new Set())
  const [error, setError] = useState(null)
  const wigs = execution?.wigs || []
  const measures = wigs.flatMap((wig) => wig.leadMeasures.map((measure) => ({ ...measure, wigTitle: wig.title, wigCode: wig.code })))
    .sort(byName)
  const directMembers = execution?.commitmentPeople || []
  const allWigGoals = goals.filter((goal) => goal.status !== 'ARCHIVED')

  async function mutate(key, path, options) {
    setBusyKeys((current) => new Set(current).add(key))
    setError(null)
    try {
      await api(path, options)
      await onSaved?.()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  async function saveWig(goal) {
    const isWig = !goal.isWig
    const selected = lagSelections[goal.id] ?? goal.keyResults.find((keyResult) => keyResult.isLagMeasure)?.id ?? ''
    if (isWig && !selected) {
      setError(`Add a non-archived Key Result to “${goal.title}” before designating it as a WIG.`)
      return
    }
    await mutate(`wig:${goal.id}`, `/api/business/goals/${encodeURIComponent(goal.id)}/wig`, {
      method: 'PATCH', body: isWig ? { isWig: true, lagKeyResultId: selected } : { isWig: false },
    })
  }

  async function createMeasure(event, wig) {
    event.preventDefault()
    const form = measureForms[wig.goalId] || { name: '', unit: '', weeklyTarget: '', direction: 'UP' }
    const saved = await mutate(`measure:${wig.goalId}`, `/api/business/goals/${encodeURIComponent(wig.goalId)}/lead-measures`, {
      method: 'POST', body: { ...form, weeklyTarget: Number(form.weeklyTarget) },
    })
    if (saved) setMeasureForms((current) => ({ ...current, [wig.goalId]: { name: '', unit: '', weeklyTarget: '', direction: 'UP' } }))
  }

  async function recordValue(event, measure) {
    event.preventDefault()
    const input = valueInputs[measure.id] || ''
    const saved = await mutate(`value:${measure.id}`, `/api/business/lead-measures/${encodeURIComponent(measure.id)}/values`, {
      method: 'POST', body: { weekStartAt: execution.currentWeekStartAt, value: Number(input) },
    })
    if (saved) setValueInputs((current) => ({ ...current, [measure.id]: '' }))
  }

  async function createCommitment(event) {
    event.preventDefault()
    const weekStartAt = commitmentForm.week === 'next' ? execution.nextWeekStartAt : execution.currentWeekStartAt
    const saved = await mutate('commitment:create', '/api/business/weekly-commitments', {
      method: 'POST', body: {
        businessId,
        weekStartAt,
        ownerPersonId: commitmentForm.ownerPersonId,
        leadMeasureId: commitmentForm.leadMeasureId || null,
        title: commitmentForm.title,
      },
    })
    if (saved) setCommitmentForm((current) => ({ ...current, title: '', leadMeasureId: '' }))
  }

  if (!execution) return null

  return (
    <Card className="mb-4" data-testid="business-wig-execution">
      <div className="mb-3 flex items-start justify-between gap-3">
        <SectionTitle caption="Weekly execution, commitments, and the five-week lead-measure trend">4DX · WIG execution</SectionTitle>
        <span className="pill pill-planned">Week of {weekLabel(execution.currentWeekStartAt)}</span>
      </div>
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800" role="alert">{error}</p>}

      <section className="mb-4" aria-labelledby="wig-list-heading">
        <h3 id="wig-list-heading" className="mb-2 text-xs font-bold">Wildly Important Goals</h3>
        {allWigGoals.length === 0 && <p className="text-xs text-muted">Create a Goal and Key Result in the Business Roadmap to start a WIG.</p>}
        <div className="space-y-2">
          {allWigGoals.map((goal) => {
            const currentLagId = goal.keyResults.find((keyResult) => keyResult.isLagMeasure)?.id || ''
            const value = lagSelections[goal.id] ?? currentLagId
            return (
              <div key={goal.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-2" data-testid={`wig-goal-${goal.id}`}>
                <span className="min-w-36 flex-1 text-xs font-semibold">{goal.title}</span>
                {goal.isWig ? (
                  <>
                    <span className="pill pill-active">WIG</span>
                    {canManage && (
                      <>
                        <Field label={`Lag measure for ${goal.title}`}>
                          <select className="input min-w-48" value={value} onChange={(event) => setLagSelections((current) => ({ ...current, [goal.id]: event.target.value }))}>
                            {goal.keyResults.map((keyResult) => <option key={keyResult.id} value={keyResult.id}>{keyResult.code} · {keyResult.title}</option>)}
                          </select>
                        </Field>
                        <button type="button" className="btn px-2 py-1 text-[10px]" disabled={busyKeys.has(`wig:${goal.id}`) || !value} onClick={() => mutate(`wig:${goal.id}`, `/api/business/goals/${encodeURIComponent(goal.id)}/wig`, { method: 'PATCH', body: { isWig: true, lagKeyResultId: value } })}>Save lag</button>
                        <button type="button" className="btn px-2 py-1 text-[10px]" disabled={busyKeys.has(`wig:${goal.id}`)} onClick={() => saveWig(goal)}>Remove WIG</button>
                      </>
                    )}
                  </>
                ) : canManage ? (
                  <>
                    <Field label={`Select lag Key Result for ${goal.title}`}>
                      <select className="input min-w-48" value={value} onChange={(event) => setLagSelections((current) => ({ ...current, [goal.id]: event.target.value }))}>
                        <option value="">Choose a non-archived Key Result</option>
                        {goal.keyResults.map((keyResult) => <option key={keyResult.id} value={keyResult.id}>{keyResult.code} · {keyResult.title}</option>)}
                      </select>
                    </Field>
                    <button type="button" className="btn btn-primary px-2 py-1 text-[10px]" disabled={busyKeys.has(`wig:${goal.id}`) || !value} onClick={() => saveWig(goal)}>Set as WIG</button>
                  </>
                ) : <span className="text-[10px] text-muted">Not a WIG</span>}
              </div>
            )
          })}
        </div>
      </section>

      <section className="mb-4" aria-labelledby="lead-measure-heading">
        <h3 id="lead-measure-heading" className="mb-2 text-xs font-bold">Lead measures · last five weeks</h3>
        {wigs.length === 0 && <p className="text-xs text-muted">Designate up to two non-archived Goals as WIGs to add lead measures.</p>}
        <div className="space-y-3">
          {wigs.map((wig) => {
            const form = measureForms[wig.goalId] || { name: '', unit: '', weeklyTarget: '', direction: 'UP' }
            return (
              <div key={wig.goalId} className="rounded-lg border border-[var(--border)] p-3" data-testid={`wig-measures-${wig.goalId}`}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-xs font-bold">{wig.title}</p>
                  {wig.configurationError && <span className="pill pill-review">Choose one lag Key Result</span>}
                  {wig.lagKeyResult && <span className="text-[10px] text-muted">Lag: {wig.lagKeyResult.title}</span>}
                </div>
                {wig.leadMeasures.length === 0 && <p className="mb-2 text-[10px] text-muted">No active lead measures yet.</p>}
                <div className="space-y-2">
                  {wig.leadMeasures.map((measure) => (
                    <article key={measure.id} className="rounded-lg bg-[var(--surface-muted)] p-2" data-testid={`lead-measure-${measure.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><p className="text-[11px] font-bold">{measure.name}</p><p className="text-[10px] text-muted">Target {measure.direction === 'UP' ? 'at least' : 'at most'} {measure.weeklyTarget} {measure.unit} / week</p></div>
                        {canManage && <button type="button" className="btn px-2 py-1 text-[10px]" disabled={busyKeys.has(`archive:${measure.id}`)} onClick={() => mutate(`archive:${measure.id}`, `/api/business/lead-measures/${encodeURIComponent(measure.id)}`, { method: 'PATCH', body: { status: 'ARCHIVED' } })}><Archive size={11} className="mr-1 inline" aria-hidden /> Archive</button>}
                      </div>
                      <ol className="mt-2 grid grid-cols-5 gap-1" aria-label={`${measure.name} five-week trend`}>
                        {measure.weeklyBars.map((bar) => (
                          <li key={bar.weekStartAt} className="rounded bg-white p-1 text-center">
                            <span className="block text-[8px] text-muted">{weekLabel(bar.weekStartAt)}</span>
                            <span className="block text-[10px] font-bold">{bar.value === null ? '—' : `${bar.value} ${measure.unit}`}</span>
                          </li>
                        ))}
                      </ol>
                      {canManage && (
                        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => recordValue(event, measure)}>
                          <Field label={`This week's ${measure.name} value`}>
                            <input className="input w-36" aria-label={`This week's ${measure.name} value`} type="number" step="any" value={valueInputs[measure.id] ?? ''} onChange={(event) => setValueInputs((current) => ({ ...current, [measure.id]: event.target.value }))} required />
                          </Field>
                          <button className="btn btn-primary px-2 py-1 text-[10px]" disabled={busyKeys.has(`value:${measure.id}`)}>Record correction</button>
                        </form>
                      )}
                    </article>
                  ))}
                </div>
                {canManage && (
                  <form className="mt-3 grid gap-2 rounded-lg border border-dashed border-[var(--border)] p-2 sm:grid-cols-[1.5fr_0.7fr_0.7fr_0.7fr_auto]" onSubmit={(event) => createMeasure(event, wig)}>
                    <Field label={`New lead measure for ${wig.title}`}><input className="input" value={form.name} onChange={(event) => setMeasureForms((current) => ({ ...current, [wig.goalId]: { ...form, name: event.target.value } }))} maxLength={120} placeholder="Calls with qualified buyers" required /></Field>
                    <Field label="Unit"><input className="input" value={form.unit} onChange={(event) => setMeasureForms((current) => ({ ...current, [wig.goalId]: { ...form, unit: event.target.value } }))} maxLength={32} placeholder="calls" required /></Field>
                    <Field label="Weekly target"><input className="input" type="number" step="any" value={form.weeklyTarget} onChange={(event) => setMeasureForms((current) => ({ ...current, [wig.goalId]: { ...form, weeklyTarget: event.target.value } }))} required /></Field>
                    <Field label="Direction"><select className="input" value={form.direction} onChange={(event) => setMeasureForms((current) => ({ ...current, [wig.goalId]: { ...form, direction: event.target.value } }))}><option value="UP">Higher is better</option><option value="DOWN">Lower is better</option></select></Field>
                    <button type="submit" className="btn btn-primary self-end px-2 py-1 text-[10px]" disabled={busyKeys.has(`measure:${wig.goalId}`)}><Plus size={11} className="mr-1 inline" aria-hidden /> Add</button>
                  </form>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="mb-4" aria-labelledby="commitment-heading">
        <h3 id="commitment-heading" className="mb-2 text-xs font-bold">Weekly commitments</h3>
        {['current', 'next'].map((week) => {
          const rows = execution.commitments?.[week] || []
          return (
            <div key={week} className="mb-2 rounded-lg border border-[var(--border)] p-2">
              <p className="mb-1 text-[10px] font-bold">{week === 'current' ? 'This week' : 'Next week'} · {weekLabel(week === 'current' ? execution.currentWeekStartAt : execution.nextWeekStartAt)}</p>
              {rows.length === 0 && <p className="text-[10px] text-muted">No commitments.</p>}
              <ul className="space-y-1">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 rounded bg-[var(--surface-muted)] px-2 py-1.5">
                    {canManage && <input type="checkbox" aria-label={`Commitment completed: ${row.title}`} checked={row.done} disabled={busyKeys.has(`done:${row.id}`)} onChange={(event) => mutate(`done:${row.id}`, `/api/business/weekly-commitments/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { done: event.target.checked } })} />}
                    <span className={`min-w-0 flex-1 text-[10px] ${row.done ? 'line-through text-muted' : ''}`}>{row.title}<span className="text-muted"> · {row.owner?.displayName || 'Person unavailable'}{row.leadMeasure ? ` · ${row.leadMeasure.name}` : ''}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {canManage && (
          directMembers.length ? (
            <form data-testid="business-weekly-commitment-form" className="grid gap-2 rounded-lg border border-dashed border-[var(--border)] p-2 sm:grid-cols-[1.3fr_0.8fr_1fr_1.6fr_auto]" onSubmit={createCommitment}>
              <Field label="Person"><select className="input" value={commitmentForm.ownerPersonId} onChange={(event) => setCommitmentForm((current) => ({ ...current, ownerPersonId: event.target.value }))} required><option value="">Choose a Business member</option>{directMembers.map((person) => <option key={person.id} value={person.id}>{person.displayName || person.code}</option>)}</select></Field>
              <Field label="Week"><select className="input" value={commitmentForm.week} onChange={(event) => setCommitmentForm((current) => ({ ...current, week: event.target.value }))}><option value="current">This week</option><option value="next">Next week</option></select></Field>
              <Field label="Lead measure (optional)"><select className="input" value={commitmentForm.leadMeasureId} onChange={(event) => setCommitmentForm((current) => ({ ...current, leadMeasureId: event.target.value }))}><option value="">None</option>{measures.map((measure) => <option key={measure.id} value={measure.id}>{measure.name} · {measure.wigTitle}</option>)}</select></Field>
              <Field label="Commitment"><input className="input" value={commitmentForm.title} onChange={(event) => setCommitmentForm((current) => ({ ...current, title: event.target.value }))} maxLength={240} placeholder="Complete 10 customer interviews" required /></Field>
              <button type="submit" className="btn btn-primary self-end px-2 py-1 text-[10px]" disabled={busyKeys.has('commitment:create')}><Plus size={11} className="mr-1 inline" aria-hidden /> Add</button>
            </form>
          ) : <p className="text-[10px] text-muted">No active direct Business members are available for assignment.</p>
        )}
      </section>

      <section aria-labelledby="session-heading">
        <div className="mb-2 flex items-baseline justify-between gap-2"><h3 id="session-heading" className="text-xs font-bold">Weekly WIG session</h3><span className="text-[10px] text-muted">{execution.currentSession?.complete ? 'Complete' : 'In progress'} · {weekLabel(execution.currentSession?.weekStartAt)}</span></div>
        <div className="grid gap-2 sm:grid-cols-3">
          {STEP_LABELS.map(([step, label]) => {
            const field = `${step}CompletedAt`
            const completed = Boolean(execution.currentSession?.[field])
            return (
              <label key={step} className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-2 text-[10px]">
                <input type="checkbox" aria-label={label} checked={completed} disabled={!canManage || busyKeys.has(`step:${step}`)} onChange={(event) => mutate(`step:${step}`, '/api/business/wig-sessions/steps', { method: 'PUT', body: { businessId, weekStartAt: execution.currentWeekStartAt, step, completed: event.target.checked } })} />
                {label}
              </label>
            )
          })}
        </div>
        {!canManage && <p className="mt-1 text-[10px] text-muted">Only a Business owner can change session steps.</p>}
      </section>
    </Card>
  )
}
