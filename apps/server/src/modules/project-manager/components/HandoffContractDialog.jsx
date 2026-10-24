'use client'
// @req FR-083 — mandatory, keyboard reachable handoff with cancellation and focus return.
// @spec BR-017, ADR-035, NFR-008
// @tested tests/e2e/pipeline-edge-editing.spec.js
import { useEffect, useRef, useState } from 'react'
import { Field } from '@/components/ui'
import { DEPENDENCY_TYPES } from '@/lib/validation/enums'

export default function HandoffContractDialog({ attempt, onCancel, onSubmit }) {
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} aria-label="Handoff contract" style={{ width: 'min(32rem, calc(100% - 2rem))' }} className="modal-surface max-h-[90vh] overflow-y-auto p-5" onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 className="mb-3 text-sm font-bold">Handoff contract</h2>
    <p className="mb-3 text-xs">{attempt.sourceTitle} → {attempt.targetTitle}</p>
    <form onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      onSubmit({ dependencyType: data.get('relation'), contract: { version: 1,
        deliverable: data.get('deliverable'), acceptance: data.get('acceptance') === 'GATE'
          ? { kind: 'GATE', gateCode: data.get('gateCode') }
          : { kind: 'MANUAL', satisfied: data.get('satisfied') === 'on' } } })
    }}>
      <Field label="Relation"><select aria-label="Relation" name="relation" className="input" autoFocus defaultValue={attempt.dependencyType || 'BLOCKS'}>{DEPENDENCY_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}</select></Field>
      <Field label="Deliverable"><textarea aria-label="Deliverable" name="deliverable" className="input" required maxLength={2000} defaultValue={attempt.contract?.deliverable || ''} /></Field>
      <AcceptanceFields contract={attempt.contract} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Create handoff</button>
      </div>
    </form>
  </dialog>
}
function AcceptanceFields({ contract }) {
  const [kind, setKind] = useState(contract?.acceptance.kind || 'MANUAL')
  return <>
    <Field label="Acceptance"><select aria-label="Acceptance" className="input" name="acceptance" value={kind} onChange={e => setKind(e.target.value)}><option value="MANUAL">Explicit manual decision</option><option value="GATE">Existing Gate</option></select></Field>
    {kind === 'MANUAL' ? <label className="mb-3 flex gap-2 text-xs"><input name="satisfied" type="checkbox" defaultChecked={contract?.acceptance.satisfied === true} />Acceptance satisfied</label> : <Field label="Acceptance Gate code" hint="Must govern the predecessor in its Project or Workstream."><input aria-label="Acceptance Gate code" name="gateCode" className="input" defaultValue={contract?.acceptance.gateCode || ''} required /></Field>}
  </>
}
