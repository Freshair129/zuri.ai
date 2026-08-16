'use client'

// @req FR-058 — File Manager view switcher: the same FR-045 asset set rendered as
// grid (unchanged default), timeline, by-project, and preview.
// @spec SDD-031 — pure client-side projections over the canonical assetDto list; no
// new route, no second fetch, preview never accepts a filesystem path.
// @spec SEC-007 — preview only ever reaches /api/files/{id}/content for LOCAL_FILE
// + ACTIVE assets; every other combination is a client-side fallback, never a call.
// @tested tests/unit/fr058-file-manager-views-ui.test.js, tests/e2e/fr058-file-views.spec.js
import { useEffect, useState } from 'react'
import { Download, ExternalLink, Eye, FolderTree, History, LayoutGrid } from 'lucide-react'
import { compareAssetsByTimeline } from '@/modules/project-manager/application/file-manager-read-model'

export const FILE_MANAGER_VIEWS = [
  { key: 'grid', label: 'Grid', icon: LayoutGrid },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'by-project', label: 'By project', icon: FolderTree },
  { key: 'preview', label: 'Preview', icon: Eye },
]

/**
 * FR-058 §2 — reuse the read model's deterministic comparator verbatim; this
 * function only decides *when* to apply it (client-side, at render time).
 */
export function timelineOrderedAssets(assets) {
  return [...(assets || [])].sort(compareAssetsByTimeline)
}

/**
 * FR-058 §3 — join the read model's existing `groups` (ids only) against the
 * same `assets` array already in the response. No second fetch, no duplicated DTO.
 */
export function resolveProjectGroups(groups, assets) {
  const byId = new Map((assets || []).map((asset) => [asset.id, asset]))
  return (groups || []).map((group) => ({
    ...group,
    assets: (group.assetIds || []).map((id) => byId.get(id)).filter(Boolean),
  }))
}

/**
 * FR-058 §4 / SEC-007 / SDD-031 — the preview eligibility matrix, keyed on
 * (storageKind, state, mime). Returns a discriminated `{ mode }` descriptor;
 * never constructs or accepts a filesystem path, and only ever names the
 * existing `/api/files/{id}/content` route for LOCAL_FILE + ACTIVE assets —
 * the only combination that route serves (verified against
 * resolveFileAssetContent in file-asset-service.js).
 */
export function getPreviewEligibility(asset) {
  if (!asset) return { mode: 'unavailable' }

  if (asset.storageKind === 'EXTERNAL_URL') {
    return asset.externalUrl ? { mode: 'external-link', href: asset.externalUrl } : { mode: 'unavailable' }
  }

  // MANAGED_BLOB (any status/mime): resolveFileAssetContent throws "Only active
  // local files expose managed content" for anything but LOCAL_FILE — never call it.
  if (asset.storageKind !== 'LOCAL_FILE') return { mode: 'unavailable' }

  // MISSING / QUARANTINED: resolveFileAssetContent throws `File asset is {status}`
  // for any non-ACTIVE state — the UI must not attempt the fetch.
  if (asset.state !== 'ACTIVE') return { mode: 'unavailable' }

  const contentUrl = `/api/files/${asset.id}/content`
  const mime = asset.mime || ''
  if (mime.startsWith('image/')) return { mode: 'image', contentUrl }
  if (mime === 'application/pdf') return { mode: 'pdf', contentUrl }
  if (mime.startsWith('text/')) return { mode: 'text', contentUrl }
  // Any other mime: link-out file-info card, not a new endpoint — the content
  // route already serves any mime with Content-Disposition: inline.
  return { mode: 'file-info', contentUrl }
}

/** NFR-004 — aria-pressed toggle-button state for the view switcher. */
export function viewSwitcherButtonProps(viewKey, activeViewKey) {
  return { type: 'button', 'aria-pressed': viewKey === activeViewKey }
}

function ViewSwitcher({ view, onChange }) {
  return (
    <div
      role="group"
      aria-label="File view"
      className="mb-3 inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-mid)] p-1"
    >
      {FILE_MANAGER_VIEWS.map(({ key, label, icon: Icon }) => {
        const active = key === view
        return (
          <button
            key={key}
            {...viewSwitcherButtonProps(key, view)}
            onClick={() => onChange(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active ? 'bg-[var(--surface-card)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Icon size={14} aria-hidden /> {label}
          </button>
        )
      })}
    </div>
  )
}

function GridView({ assets, renderAsset }) {
  return <div className="grid gap-3 md:grid-cols-2">{assets.map(renderAsset)}</div>
}

function TimelineView({ assets, renderAsset }) {
  const ordered = timelineOrderedAssets(assets)
  if (!ordered.length) return <p className="text-xs text-muted">No files yet.</p>
  return <div className="grid gap-3 md:grid-cols-2">{ordered.map(renderAsset)}</div>
}

function ByProjectView({ assets, groups, renderAsset }) {
  const resolved = resolveProjectGroups(groups, assets)
  if (!resolved.length) return <p className="text-xs text-muted">No files yet.</p>
  return (
    <div className="grid gap-5">
      {resolved.map((group) => (
        <div key={`${group.kind}-${group.projectId || 'business'}`}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">
            {group.kind === 'BUSINESS' ? 'No project' : `${group.projectCode} · ${group.projectName}`} · {group.assets.length}
          </p>
          <div className="grid gap-3 md:grid-cols-2">{group.assets.map(renderAsset)}</div>
        </div>
      ))}
    </div>
  )
}

function TextPreview({ contentUrl }) {
  const [text, setText] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let cancelled = false
    setText(null)
    setError(null)
    fetch(contentUrl)
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load preview')
        return response.text()
      })
      .then((body) => {
        if (!cancelled) setText(body)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [contentUrl])
  if (error) return <p className="text-[11px] text-[var(--danger)]">{error}</p>
  if (text === null) return <p className="text-[11px] text-muted">Loading preview…</p>
  return <pre className="max-h-64 overflow-auto rounded-lg bg-[var(--surface-mid)] p-2 text-[10px]">{text}</pre>
}

function PreviewCard({ asset }) {
  const eligibility = getPreviewEligibility(asset)
  return (
    <div className="card p-3">
      <p className="mb-2 truncate text-xs font-bold">{asset.name}</p>
      {eligibility.mode === 'image' && (
        <img src={eligibility.contentUrl} alt={asset.name} className="max-h-64 w-full rounded-lg object-contain" />
      )}
      {eligibility.mode === 'pdf' && (
        <embed src={eligibility.contentUrl} type="application/pdf" className="h-64 w-full rounded-lg" />
      )}
      {eligibility.mode === 'text' && <TextPreview contentUrl={eligibility.contentUrl} />}
      {eligibility.mode === 'file-info' && (
        <div className="text-[11px] text-muted">
          <p>{asset.mime || 'Unknown type'} · {asset.storageKind}</p>
          <a
            className="btn mt-2 inline-flex items-center gap-1 text-[11px]"
            href={eligibility.contentUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={12} /> Download
          </a>
        </div>
      )}
      {eligibility.mode === 'external-link' && (
        <a className="btn inline-flex items-center gap-1 text-[11px]" href={eligibility.href} target="_blank" rel="noreferrer">
          <ExternalLink size={12} /> Open link
        </a>
      )}
      {eligibility.mode === 'unavailable' && (
        <p className="text-[11px] text-muted">Preview unavailable · {asset.storageKind} · {asset.state}</p>
      )}
    </div>
  )
}

function PreviewView({ assets }) {
  if (!assets.length) return <p className="text-xs text-muted">No files yet.</p>
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {assets.map((asset) => <PreviewCard key={asset.id} asset={asset} />)}
    </div>
  )
}

/**
 * Hosts the four-view switcher over one canonical asset list. `renderAsset` is
 * the caller's existing per-asset card (grid/timeline/by-project reuse it
 * unchanged); preview renders its own eligibility-gated content instead.
 */
export default function FileManagerViews({ view, onViewChange, assets, groups, renderAsset }) {
  const list = assets || []
  return (
    <div>
      <ViewSwitcher view={view} onChange={onViewChange} />
      {view === 'timeline' ? (
        <TimelineView assets={list} renderAsset={renderAsset} />
      ) : view === 'by-project' ? (
        <ByProjectView assets={list} groups={groups} renderAsset={renderAsset} />
      ) : view === 'preview' ? (
        <PreviewView assets={list} />
      ) : (
        <GridView assets={list} renderAsset={renderAsset} />
      )}
    </div>
  )
}
