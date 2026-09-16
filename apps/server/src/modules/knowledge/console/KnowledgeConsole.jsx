'use client'

// @req FR-253 — paged, scoped knowledge sources, processing history and exact cited evidence.
// @spec ADR-072, ADR-085, SEC-001, SEC-008
// @tested tests/e2e/fr253-knowledge-console.spec.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FileText, RefreshCw, Search, UploadCloud } from 'lucide-react'
import { Card, EmptyState, ErrorState, Field, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard } from '@/modules/project-manager/components/useApi'

const SOURCE_STATUSES = ['QUEUED', 'RUNNING', 'PUBLISHED', 'FAILED', 'SUPERSEDED', 'WITHDRAWN']
const TABS = [['sources', 'Sources'], ['runs', 'Processing runs'], ['corpora', 'Corpus generations'], ['query', 'Search knowledge']]
const enc = encodeURIComponent
const date = (value) => value ? new Date(value).toLocaleString() : 'Not reported'
const scopeQuery = (businessId, projectId) => `businessId=${enc(businessId)}${projectId ? `&projectId=${enc(projectId)}` : ''}`

// A response belongs to its exact path. Cleanup and request sequencing reject
// late reads; the render guard removes old data even before the next effect.
function useRead(path) {
  const sequence = useRef(0)
  const [state, setState] = useState({ path: null, data: null, loading: true, error: null, cursor: null })
  const read = useCallback(async (cursor = null) => {
    const request = ++sequence.current
    setState((current) => ({ path, data: cursor && current.path === path ? current.data : null, loading: Boolean(path), error: null, cursor }))
    if (!path) return
    try {
      const result = await api(`${path}${cursor ? `${path.includes('?') ? '&' : '?'}cursor=${enc(cursor)}` : ''}`)
      if (request !== sequence.current) return
      setState((current) => ({ path, data: cursor ? { ...result, items: [...(current.data?.items || []), ...(result.items || [])] } : result, loading: false, error: null, cursor: null }))
    } catch (error) {
      if (request === sequence.current) setState((current) => ({
        ...current,
        // An authorization failure invalidates even previously visible pages.
        // Retry must restart at page one after the current grant is resolved.
        ...([401, 403, 404].includes(error.status) ? { data: null, cursor: null } : {}),
        loading: false, error,
      }))
    }
  }, [path])
  useEffect(() => {
    read()
    return () => { sequence.current += 1 }
  }, [read])
  const current = state.path === path ? state : { data: null, loading: Boolean(path), error: null, cursor: null }
  return { ...current, reload: () => read(), retry: () => read(current.cursor), more: () => read(current.data?.nextCursor) }
}

function ReadError({ error, retry }) {
  if (!error) return null
  const title = error.status === 403 ? 'Access denied' : error.status === 503 ? 'Runtime unavailable' : 'Could not load knowledge'
  return <ErrorState title={title} detail={error.message} retry={retry} />
}

function Pages({ resource, empty, children }) {
  const items = resource.data?.items || []
  return <div className="space-y-3">
    {children}
    {resource.loading && <LoadingCard />}
    <ReadError error={resource.error} retry={resource.retry} />
    {!resource.loading && !resource.error && resource.data && !items.length && <EmptyState title={empty} hint="No matching records were returned for this authorized scope." />}
    {resource.data && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span>{items.length} loaded{!resource.data.hasMore && !resource.error && !resource.loading ? ' · All matching records loaded' : ''}</span>
      {resource.data.hasMore && <button type="button" className="btn" disabled={resource.loading} onClick={resource.more}>Load more</button>}
    </div>}
  </div>
}

function Refresh({ onClick, disabled }) {
  return <button type="button" className="btn inline-flex items-center gap-1" onClick={onClick} disabled={disabled}><RefreshCw size={14} /> Refresh</button>
}

function Metadata({ values }) {
  return <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[auto_1fr]">
    {Object.entries(values).map(([label, value]) => <div className="contents" key={label}><dt className="text-muted">{label}</dt><dd className="min-w-0 break-all">{value ?? 'Not reported'}</dd></div>)}
  </dl>
}

function RunDetail({ executionRunId, onClose }) {
  const resource = useRead(`/api/knowledge/console/runs/${enc(executionRunId)}`)
  const data = resource.data
  return <Card className="space-y-4" data-testid="console-run-detail">
    <div className="flex flex-wrap items-center justify-between gap-2"><SectionTitle>Run evidence</SectionTitle><div className="flex gap-2"><Refresh onClick={resource.reload} disabled={resource.loading} /><button className="btn" type="button" onClick={onClose}>Close run</button></div></div>
    {resource.loading && <LoadingCard />}
    <ReadError error={resource.error} retry={resource.retry} />
    {data && <>
      <Metadata values={{ 'Execution run': data.run.executionRunId, Pipeline: data.run.dataPipelineDefinitionId, Status: data.run.status, 'Created at': date(data.run.createdAt), 'Last heartbeat': date(data.freshness?.lastHeartbeatAt) }} />
      {data.freshness?.stale && <p role="status" className="text-xs text-[var(--warning)]">Evidence is stale. {data.freshness.reason}</p>}
      <SectionTitle caption="Every reported attempt is shown. Missing evidence does not prove completion.">Stages and attempts</SectionTitle>
      {!data.steps?.length && <p className="text-xs text-muted">Stage evidence unavailable.</p>}
      {data.steps?.map((step) => <div key={`${step.executionStepId}:${step.attemptId}`} className="rounded-lg border border-[var(--border)] p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2"><strong className="text-xs">{step.label || step.pipelineStageId}</strong><StatusPill status={step.status} /></div>
        <Metadata values={{ Stage: step.pipelineStageId, Attempt: step.attemptId, 'Started at': date(step.startedAt), 'Finished at': date(step.finishedAt), 'Input hash': step.inputHash, 'Output hash': step.outputHash, 'Failure code': step.failureCode }} />
      </div>)}
      <SectionTitle>Gate and publication evidence</SectionTitle>
      {data.gates?.length ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(data.gates, null, 2)}</pre> : <p className="text-xs text-muted">No gate evidence reported.</p>}
      {data.publication ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(data.publication, null, 2)}</pre> : <p className="text-xs text-muted">Verified publication not reported.</p>}
    </>}
  </Card>
}

function SourceDetail({ sourceId, onClose, onRun }) {
  const resource = useRead(`/api/knowledge/sources/${enc(sourceId)}?limit=25`)
  return <Card data-testid="console-source-detail">
    <div className="flex items-start justify-between gap-2"><SectionTitle caption={sourceId}>{resource.data?.source?.title || 'Source history'}</SectionTitle><button type="button" className="btn" onClick={onClose}>Close source</button></div>
    <Pages resource={resource} empty="No retained source versions">
      {resource.data?.items?.map((version) => <div key={version.id} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-center gap-2"><strong className="text-xs">Source version {version.sourceVersion}</strong><StatusPill status={version.status} /></div>
        <Metadata values={{ 'Admission ID': version.id, Revision: version.revision, Snapshot: version.snapshotId, 'Raw artifact': version.rawArtifactId, 'Parsed artifact': version.parsedArtifactId, 'Created at': date(version.createdAt) }} />
        {version.executionRunId ? <button className="btn text-xs" type="button" onClick={() => onRun(version.executionRunId)}>Open run {version.executionRunId}</button> : <p className="text-xs text-muted">Execution run not bound yet.</p>}
      </div>)}
    </Pages>
  </Card>
}

function supportedFile(asset) {
  if (asset.state !== 'ACTIVE' || !['LOCAL_FILE', 'MANAGED_BLOB'].includes(asset.storageKind)) return false
  const mime = String(asset.mime || '').split(';', 1)[0].trim().toLowerCase()
  return ['text/plain', 'text/markdown', 'text/x-markdown', 'application/markdown', 'application/x-markdown'].includes(mime)
    || (['text/*', 'application/octet-stream'].includes(mime) && /\.(txt|md|markdown|mdown|mkdn|mkd)$/i.test(asset.name || ''))
}

function Admission({ businessId, projectId, kind, onClose, onSaved }) {
  const files = useRead(kind === 'FILE' ? (projectId ? `/api/files?projectId=${enc(projectId)}` : `/api/business/files?businessId=${enc(businessId)}`) : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [fileId, setFileId] = useState('')
  const [sourceKey, setSourceKey] = useState('')
  const [version, setVersion] = useState('1')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const assets = (files.data?.assets || []).filter(supportedFile)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const asset = assets.find((item) => item.id === fileId)
    try {
      if (kind === 'FILE' && !asset) throw new Error('Choose a supported registered file')
      const source = kind === 'FILE' ? { kind, fileAssetId: asset.id } : { kind, sourceKey: sourceKey.trim(), version: version.trim(), title: title.trim() || undefined, content }
      const result = await api('/api/knowledge/ingestions', { method: 'POST', body: {
        businessId, projectId: projectId || null,
        idempotencyKey: kind === 'FILE' ? `files:file:${asset.id}:${asset.sha256 || asset.version}` : `files:text:${sourceKey.trim()}:${version.trim()}`,
        source,
      } })
      if (alive.current) onSaved(result)
    } catch (failure) { if (alive.current) setError(failure) } finally { if (alive.current) setBusy(false) }
  }
  return <Card data-testid="console-admission">
    <SectionTitle caption={projectId ? `Project ${projectId}` : 'Business corpus'}>{kind === 'TEXT' ? 'Admit text or Markdown' : 'Admit a registered file'}</SectionTitle>
    <form onSubmit={submit} className="space-y-3">
      {kind === 'TEXT' ? <>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Source key" hint="Reuse this key to add another version."><input className="input" maxLength={150} required value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} /></Field><Field label="Source version"><input className="input" maxLength={30} required value={version} onChange={(e) => setVersion(e.target.value)} /></Field></div>
        <Field label="Title"><input className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Text or Markdown"><textarea className="input min-h-40" required value={content} onChange={(e) => setContent(e.target.value)} /></Field>
      </> : <>
        {files.loading && <LoadingCard />}
        <ReadError error={files.error} retry={files.retry} />
        {files.data && <Field label="Registered file" hint="Plain text and Markdown only. Content must be readable on the server; local Windows files require their original mount. An unavailable read is reported when admitted."><select className="input" required value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">Choose a file</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.storageKind}</option>)}</select></Field>}
        {files.data && !assets.length && <p className="text-xs text-muted">No supported registered files in this scope. Register a text or Markdown file in Files first.</p>}
      </>}
      <ReadError error={error} />
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || (kind === 'FILE' && !fileId)}>{busy ? 'Queueing…' : 'Queue admission'}</button></div>
    </form>
  </Card>
}

function Sources({ businessId, projectId, projectName, onRun }) {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ q: '', status: '' })
  const [selected, setSelected] = useState(null)
  const [admitting, setAdmitting] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const resource = useRead(`/api/knowledge/sources?${scopeQuery(businessId, projectId)}&limit=25${filters.q ? `&q=${enc(filters.q)}` : ''}${filters.status ? `&status=${enc(filters.status)}` : ''}`)
  const capabilities = resource.data?.capabilities
  return <section className="space-y-4" data-testid="console-sources">
    <div className="flex flex-wrap gap-2"><button className="btn btn-primary inline-flex items-center gap-1" type="button" disabled={!capabilities?.admit} onClick={() => setAdmitting('TEXT')}><UploadCloud size={14} /> Add text</button><button className="btn inline-flex items-center gap-1" type="button" disabled={!capabilities?.admit} onClick={() => setAdmitting('FILE')}><FileText size={14} /> Select registered file</button><Refresh onClick={resource.reload} disabled={resource.loading} /></div>
    {capabilities && !capabilities.admit && <p role="status" className="text-xs text-muted">Admission unavailable. {capabilities.reason}</p>}
    {admitting && <Admission key={admitting} businessId={businessId} projectId={projectId} kind={admitting} onClose={() => setAdmitting(null)} onSaved={(result) => { setAdmitting(null); setReceipt(result); resource.reload() }} />}
    {receipt && <Card role="status" aria-label="Admission receipt"><p className="text-xs">Admission accepted. Processing and publication are tracked separately.</p><Metadata values={{ 'Admission ID': receipt.ingestion?.id || receipt.id, Status: receipt.ingestion?.status || receipt.status }} /></Card>}
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setSelected(null); setFilters((current) => ({ ...current, q: search.trim() })) }}>
      <Field label="Find source title"><input className="input" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
      <Field label="Admission status"><select className="input" value={filters.status} onChange={(e) => { setSelected(null); setFilters((current) => ({ ...current, status: e.target.value })) }}><option value="">All statuses</option>{SOURCE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
      <button type="submit" className="btn mb-3">Filter sources</button>
    </form>
    {selected && <SourceDetail key={selected} sourceId={selected} onClose={() => setSelected(null)} onRun={onRun} />}
    <Pages resource={resource} empty="No knowledge sources">
      {resource.data?.items?.map((source) => <Card key={source.id} data-testid={`console-source-${source.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><button className="text-left text-sm font-bold text-[var(--brand-dark)] break-words" type="button" onClick={() => setSelected(source.id)}>{source.title || source.id}</button><StatusPill status={source.status} /></div>
        <p className="mt-2 text-xs text-muted">{source.kind} · {projectName(source.projectId)} · Source version {source.sourceVersion || 'Not reported'} · {date(source.updatedAt || source.createdAt)}</p>
      </Card>)}
    </Pages>
  </section>
}

function Runs({ businessId, projectId, onRun }) {
  const [status, setStatus] = useState('')
  const resource = useRead(`/api/knowledge/console/runs?${scopeQuery(businessId, projectId)}&limit=25${status ? `&status=${enc(status)}` : ''}`)
  return <section className="space-y-3" data-testid="console-runs">
    <div className="flex flex-wrap items-end justify-between gap-2"><Field label="Run status"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'ROLLED_BACK', 'CANCELLED'].map((value) => <option key={value}>{value}</option>)}</select></Field><Refresh onClick={resource.reload} disabled={resource.loading} /></div>
    <Pages resource={resource} empty="No processing runs">
      {resource.data?.items?.map((run) => <Card key={run.executionRunId}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong className="text-xs">{run.dataPipelineDefinitionId}</strong><StatusPill status={run.status} /></div>
        <button className="text-left text-xs text-[var(--brand-dark)] break-all" type="button" onClick={() => onRun(run.executionRunId)}>Open run {run.executionRunId}</button>
        <p className="mt-2 text-xs text-muted">{date(run.createdAt)} · {run.admissionId ? `Admission ${run.admissionId}` : 'No linked knowledge admission'}</p>
      </Card>)}
    </Pages>
  </section>
}

function Generations({ corpusId, onClose }) {
  const resource = useRead(`/api/knowledge/corpora/${enc(corpusId)}/generations?limit=25`)
  return <Card data-testid="console-generation-detail">
    <div className="flex flex-wrap justify-between gap-2"><SectionTitle caption={corpusId}>Generation history</SectionTitle><button className="btn" type="button" onClick={onClose}>Close history</button></div>
    <Pages resource={resource} empty="No published generations">
      {resource.data?.items?.map((generation) => <div key={generation.id} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
        <div className="flex flex-wrap gap-2 text-xs"><strong>Corpus generation {generation.number}</strong><StatusPill status={generation.published ? 'PUBLISHED' : 'HISTORICAL'} /><span>{date(generation.createdAt)}</span></div>
        {generation.entries?.map((entry) => <p key={`${entry.sourceId}:${entry.snapshotId}`} className="break-all text-xs">{entry.title || entry.sourceId} · Source version {entry.sourceVersion} · Snapshot {entry.snapshotId}</p>)}
        {!generation.entries?.length && <p className="text-xs text-muted">No visible source entries in this generation.</p>}
      </div>)}
    </Pages>
  </Card>
}

function Corpora({ businessId, projectId, projectName }) {
  const resource = useRead(`/api/knowledge/corpora?${scopeQuery(businessId, projectId)}&limit=25`)
  const [selected, setSelected] = useState(null)
  return <section className="space-y-3" data-testid="console-corpora">
    <Refresh onClick={resource.reload} disabled={resource.loading} />
    {selected && <Generations key={selected} corpusId={selected} onClose={() => setSelected(null)} />}
    <Pages resource={resource} empty="No knowledge corpora">
      {resource.data?.items?.map((corpus) => <Card key={corpus.id}>
        <button type="button" className="text-left text-sm font-bold text-[var(--brand-dark)]" onClick={() => setSelected(corpus.id)}>{projectName(corpus.projectId)}</button>
        <p className="mt-2 break-all text-xs text-muted">{corpus.id} · {corpus.generation > 0 ? `Published generation ${corpus.generation}` : 'No published generation'}</p>
        <StatusPill status={corpus.status} />
      </Card>)}
    </Pages>
  </section>
}

function Artifact({ citationId, onClose }) {
  const [kind, setKind] = useState('chunk')
  const path = `/api/knowledge/citations/${enc(citationId)}/artifact?kind=${kind}`
  const resource = useRead(path)
  const data = resource.data
  return <Card className="space-y-3" data-testid="console-artifact">
    <div className="flex flex-wrap items-center justify-between gap-2"><SectionTitle>Exact cited evidence</SectionTitle><button type="button" className="btn" onClick={onClose}>Close evidence</button></div>
    <nav className="flex flex-wrap gap-2" aria-label="Evidence layers">{[['chunk', 'Cited chunk'], ['parsed', 'Parsed document'], ['raw', 'Original source']].map(([value, label]) => <button type="button" key={value} className={`btn ${kind === value ? 'btn-primary' : ''}`} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}</nav>
    {resource.loading && <LoadingCard />}
    <ReadError error={resource.error} retry={resource.retry} />
    {data && <>
      <Metadata values={{ Title: data.title, 'Content hash': data.contentHash, 'Raw artifact': data.rawArtifactId, 'Parsed artifact': data.parsedArtifactId, Chunk: data.chunkId }} />
      {data.truncated && <p role="status" className="text-xs text-[var(--warning)]">Preview truncated. Download the retained artifact to read all {data.bytes} bytes.</p>}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface)] p-3 text-xs" data-testid="console-artifact-content">{data.content}</pre>
      <a className="btn inline-flex" href={`${path}&download=true`}>Download {kind}</a>
    </>}
  </Card>
}

function Query({ businessId, projectId, projectName }) {
  const corpora = useRead(`/api/knowledge/corpora?${scopeQuery(businessId, projectId)}&limit=25`)
  const [corpusId, setCorpusId] = useState('')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [citation, setCitation] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const sequence = useRef(0)
  useEffect(() => () => { sequence.current += 1 }, [])
  const selected = corpora.data?.items?.find((item) => item.id === corpusId)
  const capability = corpora.data?.capabilities
  const submit = async (event) => {
    event.preventDefault()
    if (!selected || !query.trim()) return
    const request = ++sequence.current
    setBusy(true); setError(null); setResult(null); setCitation(null)
    try {
      const data = await api('/api/knowledge/queries', { method: 'POST', body: { businessId, projectId: selected.projectId || null, query: query.trim(), topK: 10 } })
      if (request === sequence.current) setResult(data)
    } catch (failure) { if (request === sequence.current) setError(failure) } finally { if (request === sequence.current) setBusy(false) }
  }
  return <section className="space-y-4" data-testid="console-query">
    <Pages resource={corpora} empty="No corpus available for search" />
    {capability && !capability.query && <p role="status" className="text-xs text-muted">Search unavailable. {capability.reason}</p>}
    <form className="space-y-3" onSubmit={submit}>
      <Field label="Search corpus" hint="Choose one corpus. Results identify the exact published generation used."><select className="input" required value={corpusId} onChange={(event) => { sequence.current += 1; setCorpusId(event.target.value); setResult(null); setCitation(null); setError(null); setBusy(false) }}><option value="">Choose a published corpus</option>{corpora.data?.items?.map((corpus) => <option key={corpus.id} value={corpus.id} disabled={!corpus.generation}>{projectName(corpus.projectId)} · Generation {corpus.generation}</option>)}</select></Field>
      <Field label="Knowledge query"><input className="input" value={query} required onChange={(event) => setQuery(event.target.value)} placeholder="ค้นข้อความในคลังความรู้" /></Field>
      <button className="btn btn-primary inline-flex items-center gap-1" type="submit" disabled={busy || !selected?.generation || !capability?.query}><Search size={14} />{busy ? 'Searching…' : 'Search'}</button>
    </form>
    <ReadError error={error} />
    {result && <div className="space-y-3" aria-live="polite"><p className="text-xs">Results from corpus generation {result.corpusGeneration}</p>
      {result.results?.length ? result.results.map((hit) => <Card key={hit.citationId || hit.chunkId}>
        <p className="whitespace-pre-wrap break-words text-sm">{hit.text}</p>
        <p className="mt-2 break-all text-xs text-muted">Snapshot {hit.snapshotId} · Snapshot generation {hit.generation}</p>
        {hit.citationId && <button className="btn mt-2" type="button" onClick={() => setCitation(hit.citationId)}>Open evidence</button>}
      </Card>) : <EmptyState title="No knowledge matched" />}
    </div>}
    {citation && <Artifact key={citation} citationId={citation} onClose={() => setCitation(null)} />}
  </section>
}

function ConsoleBody({ businessId, projectId, projectName }) {
  const [tab, setTab] = useState('sources')
  const [runId, setRunId] = useState(null)
  return <div className="space-y-4">
    <nav className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3" aria-label="Knowledge views">{TABS.map(([key, label]) => <button key={key} type="button" className={`btn ${tab === key ? 'btn-primary' : ''}`} aria-pressed={tab === key} onClick={() => { setTab(key); setRunId(null) }}>{label}</button>)}</nav>
    {runId && <RunDetail key={runId} executionRunId={runId} onClose={() => setRunId(null)} />}
    {tab === 'sources' && <Sources businessId={businessId} projectId={projectId} projectName={projectName} onRun={setRunId} />}
    {tab === 'runs' && <Runs businessId={businessId} projectId={projectId} onRun={setRunId} />}
    {tab === 'corpora' && <Corpora businessId={businessId} projectId={projectId} projectName={projectName} />}
    {tab === 'query' && <Query businessId={businessId} projectId={projectId} projectName={projectName} />}
  </div>
}

function BusinessConsole({ businessId, projects, initialProjectId }) {
  const [projectId, setProjectId] = useState(initialProjectId || '')
  const projectName = (id) => id ? (projects.find((project) => project.id === id)?.name || `Project ${id}`) : 'Business corpus'
  return <div className="space-y-4" data-testid="knowledge-console">
    <PageHeader eyebrow="KNOWLEDGE" title="Knowledge console" subtitle="ต้นทาง รุ่นเอกสาร งานประมวลผล และหลักฐานที่ค้นพบในคลังความรู้" />
    <Field label="Project scope" hint="All authorized projects includes the Business corpus. Admission without a selected project belongs to the Business corpus."><select className="input max-w-lg" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All authorized projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
    <ConsoleBody key={`${businessId}:${projectId}`} businessId={businessId} projectId={projectId || null} projectName={projectName} />
  </div>
}

export default function KnowledgeConsole() {
  const scope = useScope()
  const search = useSearchParams()
  const businessId = scope.shell.activeBusinessId
  const projects = scope.projects.filter((project) => project.businessId === businessId)
  const requestedProject = search.get('projectId') || scope.selection.projectId
  const initialProjectId = projects.some((project) => project.id === requestedProject) ? requestedProject : null
  if (!businessId || !scope.loaded) return <LoadingCard />
  return <BusinessConsole key={`${businessId}:${initialProjectId || ''}`} businessId={businessId} projects={projects} initialProjectId={initialProjectId} />
}
