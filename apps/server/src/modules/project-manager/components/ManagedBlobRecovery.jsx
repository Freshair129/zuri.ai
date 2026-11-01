'use client'

// @req FR-292, FR-293 — explicit original-byte recovery with truthful custody UX.
// @spec ADR-115, SEC-008
// @tested tests/browser/managed-blob-recovery-browser.test.js
import { useEffect, useRef, useState } from 'react'

async function send(url, { method = 'GET', body, signal } = {}) {
  const headers = {}
  if (method === 'POST') {
    let response
    try { response = await fetch('/api/auth/csrf', { cache: 'no-store', signal }) }
    catch { throw Object.assign(new Error('Could not validate your session. No recovery request was sent.'), { ambiguous: false }) }
    if (!response.ok) throw Object.assign(new Error('Could not validate your session. Sign in again before continuing.'), { ambiguous: false })
    headers['X-Zuri-API-Write-CSRF'] = (await response.json()).token
    if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  }
  let response
  try {
    response = await fetch(url, { method, headers, cache: 'no-store', signal,
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
  } catch { throw Object.assign(new Error('The recovery response was lost.'), { ambiguous: true }) }
  const data = await response.json().catch(() => null)
  if (!data) throw Object.assign(new Error('The recovery response could not be read.'), { ambiguous: true })
  if (!response.ok) throw Object.assign(new Error(data.message || 'Recovery request refused.'), {
    code: data.code, status: response.status, retryable: data.retryable,
    ambiguous: response.status >= 500 && data.code !== 'MANAGED_BLOB_RECOVERY_NOT_QUALIFIED',
  })
  return data
}

export function ManagedBlobRecovery({ file, onChanged = () => {} }) {
  const [open, setOpen] = useState(false), [operation, setOperation] = useState(null)
  const [original, setOriginal] = useState(null), [binding, setBinding] = useState(null)
  const [knownId, setKnownId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(null)
  const [needsStatus, setNeedsStatus] = useState(false), [prepareUncertain, setPrepareUncertain] = useState(false)
  const inFlight = useRef(false), controller = useRef(null)
  useEffect(() => () => { controller.current?.abort() }, [])
  const base = `/api/files/${encodeURIComponent(file.id)}/recovery-operations`
  async function run(action) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null)
    const abort = new AbortController(); controller.current = abort
    try {
      let next
      if (action === 'prepare') next = await send(base, { method: 'POST', body: { expectedVersion: file.version }, signal: abort.signal })
      else {
        const id = operation?.operationId || knownId.trim()
        if (!id) throw new Error('Enter the operation ID from this file’s earlier recovery.')
        const url = `${base}/${encodeURIComponent(id)}`
        if (action === 'status') next = await send(url, { signal: abort.signal })
        else {
          let body
          if (action === 'preview') {
            if (!original || !operation?.descriptor) throw new Error('Select the exact original file before previewing.')
            body = new FormData(); body.append('descriptor', JSON.stringify(operation.descriptor)); body.append('content', original)
          } else if (action === 'inspect') body = {}
          else if (action === 'abandon') body = { expectedOperationVersion: operation.version }
          else body = { confirmationBinding: binding, expectedOperationVersion: operation.version }
          next = await send(`${url}/${action}`, { method: 'POST', body, signal: abort.signal })
        }
      }
      if (abort.signal.aborted) return
      setNeedsStatus(false)
      if (next.confirmationBinding) setBinding(next.confirmationBinding)
      // Do not discard the descriptor on preview; it is matching evidence,
      // never a ref, permission or provider choice.
      setOperation(current => ({ ...current, ...next })); setKnownId(next.operationId)
      if (next.state === 'COMMITTED') onChanged()
    } catch (err) {
      if (!abort.signal.aborted) {
        const ambiguous = err.ambiguous === true
        if (ambiguous && operation?.operationId) setNeedsStatus(true)
        if (ambiguous && action === 'prepare') setPrepareUncertain(true)
        setError(err.message + (ambiguous ? operation?.operationId
          ? ' Check status before repeating a write.'
          : ' Do not blindly repeat preparation; an unresolved preparation may exist until expiry.' : ''))
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false)
      inFlight.current = false
    }
  }
  if (!open) return <button type="button" className="btn text-[11px]" onClick={() => setOpen(true)}>Recover original</button>
  return <section aria-label="Recover original file" className="mt-3 rounded border border-[var(--border)] p-3 text-xs">
    <p className="font-semibold">Recover original file</p>
    <p>Restore the exact original bytes for this file. Preview does not change its content. Recovery remains unavailable until backup transfer is qualified.</p>
    {error && <p role="alert" className="my-2 text-[var(--danger)]">{error}</p>}
    {!operation && <>
      <button className="btn" type="button" disabled={busy || prepareUncertain} onClick={() => run('prepare')}>Prepare recovery</button>
      <label className="block">Earlier operation ID<input className="input" value={knownId} onChange={e => setKnownId(e.target.value)} /></label>
      <button className="btn" type="button" disabled={busy || !knownId.trim()} onClick={() => run('status')}>Load operation</button>
    </>}
    {operation && <>
      <p>Operation ID: <span data-testid="recovery-operation-id">{operation.operationId}</span></p>
      <p role="status">State: {operation.state}</p>
      {operation.descriptor && <p>File version {operation.descriptor.fileVersion} · {operation.descriptor.byteLength} bytes · SHA-256 {operation.descriptor.sha256} · {operation.descriptor.purpose}</p>}
      {operation.state === 'PREPARED' && <>
        <label className="block">Exact original file<input type="file" onChange={e => setOriginal(e.target.files?.[0] || null)} /></label>
        <button className="btn" type="button" disabled={busy || needsStatus || !original} onClick={() => run('preview')}>Preview original</button>
      </>}
      {operation.state === 'PREVIEWED' && !binding && operation.descriptor && original && <button className="btn" type="button" disabled={busy || needsStatus} onClick={() => run('preview')}>Recover preview binding</button>}
      {operation.state === 'PREVIEWED' && binding && <button className="btn" type="button" disabled={busy || needsStatus} onClick={() => run('stage')}>Stage verified original</button>}
      {operation.state === 'STAGED' && binding && <button className="btn btn-primary" type="button" disabled={busy || needsStatus} onClick={() => run('confirm')}>Confirm recovery of this file</button>}
      {['STAGING', 'UNKNOWN'].includes(operation.state) && <p>The external write may still exist. Check or inspect this operation; do not upload or PUT again.</p>}
      {operation.state === 'COMMITTED' && <p>{operation.targetCurrent && operation.availability === 'VERIFIED'
        ? 'Metadata committed and exact bytes verified at confirmation.'
        : operation.targetCurrent ? 'Metadata committed. Current byte availability is not verified by this status read.'
          : 'Historical commit only; this is no longer the current file version.'}</p>}
      {operation.availability === 'RECOVERY_REQUIRED' && <p role="alert">Committed content is unavailable. Further recovery is required.</p>}
      {operation.custody?.unresolved && <p>Custody remains unresolved. Retained bytes: {operation.custody.spoolBytes}. Cleanup: {operation.custody.cleanup}.</p>}
      {!binding && ['PREVIEWED', 'STAGED'].includes(operation.state) && <p>The confirmation binding is no longer held in this page. Before staging, the same original can recover a new binding; otherwise inspect or abandon. Status does not renew authority.</p>}
      <button className="btn" type="button" disabled={busy} onClick={() => run('status')}>Check operation status</button>
      <button className="btn" type="button" disabled={busy} onClick={() => run('inspect')}>Inspect existing write</button>
      {!['COMMITTED', 'ABANDONED'].includes(operation.state) && <button className="btn" type="button" disabled={busy || needsStatus} onClick={() => run('abandon')}>Abandon without attaching</button>}
    </>}
    <button className="btn" type="button" disabled={busy} onClick={() => setOpen(false)}>Close</button>
  </section>
}
