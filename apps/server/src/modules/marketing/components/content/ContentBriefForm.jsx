'use client'

// @req FR-157 — create and revise a Content brief with real Business-scoped
// FileAsset, Project, WorkItem and Campaign references.
// @spec ZAI:FR-157-NOTE — the authenticated creator is the read-only owner;
// client input never supplies resolved file fingerprints or actor authority.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import { useEffect, useMemo, useState } from 'react'
import { Card, Field, SectionTitle, TruncationNotice } from '@/components/ui'
import { useFetch } from '@/modules/project-manager/components/useApi'
import { growthCampaignsPath } from '../campaigns/campaign-contract'
import { PLAN_CHANNELS } from '../marketing-contract'
import { InlineNotice } from '../MarketingState'
import {
  CONTENT_FORMATS,
  contentChannelLabel,
  contentReferencesPath,
  currentContentVersion,
  emptyContentPayload,
  normalizeContentPayload,
  validateContentPayload,
} from './content-contract'

function parsePayload(brief) {
  const version = currentContentVersion(brief)
  return normalizeContentPayload(version?.payload || {})
}

function dateTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isoDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : value
}

function initialState(brief) {
  const payload = brief ? parsePayload(brief) : emptyContentPayload()
  return {
    title: brief?.title || '',
    payload: {
      ...payload,
      rights: payload.rights
        ? { ...payload.rights, validFrom: dateTimeInput(payload.rights.validFrom), validUntil: dateTimeInput(payload.rights.validUntil) }
        : null,
    },
  }
}

function unwrapCampaigns(data) {
  return Array.isArray(data?.campaigns) ? data.campaigns : []
}

function unwrapReferences(data, businessId, projectId) {
  if (!data || (data.businessId && data.businessId !== businessId)) return null
  if (Object.prototype.hasOwnProperty.call(data, 'projectId') && (data.projectId || null) !== (projectId || null)) return null
  return data
}

function optionLabel(row) {
  return row?.name || row?.title || row?.code || 'Unnamed reference'
}

function idFor(row, fallback = '') {
  return row?.id || row?.projectId || row?.workItemId || fallback
}

export default function ContentBriefForm({
  businessId,
  brief = null,
  busy = false,
  onSubmit,
  onCancel,
  submitLabel = 'Save draft & preview',
  titleLabel = 'New creative brief',
}) {
  const [form, setForm] = useState(() => initialState(brief))
  const [errors, setErrors] = useState([])
  const [submitError, setSubmitError] = useState(null)
  const projectId = form.payload.production?.projectId || ''
  const references = useFetch(businessId ? contentReferencesPath(businessId, projectId) : null, [businessId, projectId])
  const campaigns = useFetch(businessId ? growthCampaignsPath(businessId) : null, [businessId])
  const referenceData = references.loading ? null : unwrapReferences(references.data, businessId, projectId)
  const campaignRows = useMemo(() => unwrapCampaigns(campaigns.data), [campaigns.data])
  const projects = Array.isArray(referenceData?.projects) ? referenceData.projects : []
  const files = Array.isArray(referenceData?.files) ? referenceData.files : []
  const workItems = Array.isArray(referenceData?.workItems) ? referenceData.workItems : []
  const scopedWorkItems = workItems.filter((item) => {
    const itemProjectId = item?.projectId || item?.project?.id
    return !itemProjectId || itemProjectId === projectId
  })
  const currentOwner = brief?.createdBy?.displayName || brief?.createdBy || 'Authenticated creator'

  useEffect(() => {
    setForm(initialState(brief))
    setErrors([])
    setSubmitError(null)
  }, [brief?.id, brief?.version, brief?.currentRevision])

  const updatePayload = (patch) => {
    setForm((current) => ({ ...current, payload: { ...current.payload, ...patch } }))
  }

  const updateRights = (patch) => {
    setForm((current) => ({
      ...current,
      payload: {
        ...current.payload,
        rights: { holder: '', license: '', channels: [], validFrom: '', validUntil: '', proof: '', ...(current.payload.rights || {}), ...patch },
      },
    }))
  }

  const updateProduction = (patch) => {
    setForm((current) => {
      const next = { ...(current.payload.production || {}), ...patch }
      return { ...current, payload: { ...current.payload, production: next.projectId ? next : null } }
    })
  }

  const toggleChannel = (channel) => {
    const channels = form.payload.channels.includes(channel)
      ? form.payload.channels.filter((item) => item !== channel)
      : [...form.payload.channels, channel]
    updatePayload({ channels })
    if (form.payload.rights) {
      const rightsChannels = form.payload.rights.channels.filter((item) => item !== channel)
      updateRights({ channels: channels.includes(channel) ? [...rightsChannels, channel] : rightsChannels })
    }
  }

  const toggleRightsChannel = (channel) => {
    const channels = form.payload.rights?.channels || []
    updateRights({ channels: channels.includes(channel) ? channels.filter((item) => item !== channel) : [...channels, channel] })
  }

  const submit = async (event) => {
    event.preventDefault()
    setSubmitError(null)
    const payload = normalizeContentPayload({
      ...form.payload,
      rights: form.payload.rights
        ? { ...form.payload.rights, validFrom: isoDateTime(form.payload.rights.validFrom), validUntil: isoDateTime(form.payload.rights.validUntil) }
        : null,
    })
    const nextErrors = validateContentPayload(payload, form.title)
    if (nextErrors.length) {
      setErrors(nextErrors)
      return
    }
    setErrors([])
    try {
      await onSubmit?.({ title: form.title.trim(), payload })
    } catch (error) {
      setSubmitError(error.message)
    }
  }

  const chooseAsset = (fileId) => {
    const file = files.find((row) => idFor(row) === fileId)
    updatePayload({
      asset: fileId ? { fileId } : null,
      rights: fileId
        ? (form.payload.rights || { holder: '', license: '', channels: [...form.payload.channels], validFrom: '', validUntil: '', proof: '' })
        : null,
    })
  }

  return (
    <form className="space-y-4" data-testid="marketing-content-brief-form" onSubmit={submit}>
      <Card warm>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle caption="Capture intent and evidence before production work begins">{titleLabel}</SectionTitle>
          <p className="text-[10px] text-muted">Owner: {currentOwner}</p>
        </div>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Brief title"><input className="input" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength={200} required /></Field>
          <Field label="Format"><select className="input" value={form.payload.format} onChange={(event) => updatePayload({ format: event.target.value })}>{CONTENT_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}</select></Field>
          <Field label="Objective"><textarea className="input min-h-24" value={form.payload.objective} onChange={(event) => updatePayload({ objective: event.target.value })} maxLength={4000} required /></Field>
          <Field label="Audience"><textarea className="input min-h-24" value={form.payload.audience} onChange={(event) => updatePayload({ audience: event.target.value })} maxLength={4000} required /></Field>
          <Field label="Primary message"><textarea className="input min-h-24" value={form.payload.message} onChange={(event) => updatePayload({ message: event.target.value })} maxLength={4000} required /></Field>
          <Field label="Claims to verify"><textarea className="input min-h-24" value={form.payload.claims} onChange={(event) => updatePayload({ claims: event.target.value })} maxLength={4000} required /></Field>
          <Field label="Shot list or content outline"><textarea className="input min-h-24" value={form.payload.shotList} onChange={(event) => updatePayload({ shotList: event.target.value })} maxLength={4000} required /></Field>
          <Field label="Acceptance criteria"><textarea className="input min-h-24" value={form.payload.acceptanceCriteria} onChange={(event) => updatePayload({ acceptanceCriteria: event.target.value })} maxLength={4000} required /></Field>
          <Field label="Evidence reference"><textarea className="input min-h-24" value={form.payload.evidenceReference} onChange={(event) => updatePayload({ evidenceReference: event.target.value })} maxLength={4000} required /></Field>
        </div>
        <fieldset className="mt-2">
          <legend className="mb-1 text-[11px] font-bold text-muted">Channels</legend>
          <div className="flex flex-wrap gap-2">
            {PLAN_CHANNELS.map((channel) => <label key={channel.value} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs"><input type="checkbox" checked={form.payload.channels.includes(channel.value)} onChange={() => toggleChannel(channel.value)} />{channel.label}</label>)}
          </div>
        </fieldset>
      </Card>

      <Card data-testid="marketing-content-references">
        <SectionTitle caption="References are selected from the active Business scope and resolved by owner services">Owner references</SectionTitle>
        {(references.error || campaigns.error) && <InlineNotice tone="error">Reference choices are unavailable. Refresh before saving a linked brief.</InlineNotice>}
        {referenceData?.truncated && Object.values(referenceData.truncated).some(Boolean) && <TruncationNotice shown={100} limit={100} noun="reference choices" hint="Only the bounded owner-managed choices are shown." />}
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Campaign (optional)"><select className="input" value={form.payload.initiativeId || ''} onChange={(event) => updatePayload({ initiativeId: event.target.value || null })}><option value="">No Campaign reference</option>{campaignRows.map((campaign) => <option key={campaign.id} value={campaign.id}>{optionLabel(campaign)}</option>)}</select>{campaigns.loading && <span className="mt-1 block text-[10px] text-muted">Loading Campaign choices…</span>}</Field>
          <Field label="Source file (optional)"><select className="input" value={form.payload.asset?.fileId || ''} onChange={(event) => chooseAsset(event.target.value)}><option value="">No source file reference yet</option>{files.map((file) => <option key={idFor(file)} value={idFor(file)} disabled={file.state && file.state !== 'ACTIVE'}>{optionLabel(file)} · v{file.version || 1} · {file.state || 'state unavailable'} · {file.sha256 || file.fingerprint ? 'fingerprint ready' : 'fingerprint unavailable'}</option>)}</select><span className="mt-1 block text-[10px] text-muted">Files owns bytes, state and fingerprints; this brief stores only the reference.</span></Field>
          <Field label="Production Project (optional)"><select className="input" value={projectId} onChange={(event) => updateProduction({ projectId: event.target.value || null, workItemId: null })}><option value="">No PM Project reference yet</option>{projects.map((project) => <option key={idFor(project)} value={idFor(project)}>{optionLabel(project)}</option>)}</select>{references.loading && <span className="mt-1 block text-[10px] text-muted">Loading Project choices…</span>}</Field>
          <Field label="Production task (optional)"><select className="input" value={form.payload.production?.workItemId || ''} onChange={(event) => updateProduction({ workItemId: event.target.value || null })} disabled={!projectId}><option value="">No WorkItem reference yet</option>{scopedWorkItems.map((item) => <option key={idFor(item)} value={idFor(item)}>{optionLabel(item)} · {item.status || 'status unavailable'}</option>)}</select><span className="mt-1 block text-[10px] text-muted">A production reference requires both a Project and a task from that Project roadmap.</span></Field>
        </div>
      </Card>

      {form.payload.asset && <Card data-testid="marketing-content-rights">
        <SectionTitle caption="A linked output requires explicit rights covering every intended channel">Usage rights</SectionTitle>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Rights holder"><input className="input" value={form.payload.rights?.holder || ''} onChange={(event) => updateRights({ holder: event.target.value })} required /></Field>
          <Field label="License"><input className="input" value={form.payload.rights?.license || ''} onChange={(event) => updateRights({ license: event.target.value })} required /></Field>
          <Field label="Valid from"><input className="input" type="datetime-local" value={form.payload.rights?.validFrom || ''} onChange={(event) => updateRights({ validFrom: event.target.value })} required /></Field>
          <Field label="Valid until"><input className="input" type="datetime-local" value={form.payload.rights?.validUntil || ''} onChange={(event) => updateRights({ validUntil: event.target.value })} required /></Field>
          <Field label="Rights proof reference"><input className="input" value={form.payload.rights?.proof || ''} onChange={(event) => updateRights({ proof: event.target.value })} required /></Field>
        </div>
        <fieldset className="mt-2">
          <legend className="mb-1 text-[11px] font-bold text-muted">Rights cover</legend>
          <div className="flex flex-wrap gap-2">
            {PLAN_CHANNELS.map((channel) => <label key={channel.value} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs"><input type="checkbox" checked={form.payload.rights?.channels?.includes(channel.value) || false} onChange={() => toggleRightsChannel(channel.value)} />{contentChannelLabel(channel.value)}</label>)}
          </div>
        </fieldset>
      </Card>}

      {errors.length > 0 && <InlineNotice tone="error"><span className="font-bold">Check this brief:</span> {errors.join(' ')}</InlineNotice>}
      {submitError && <InlineNotice tone="error">{submitError}</InlineNotice>}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}
