'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, Archive } from 'lucide-react'
import { PageHeader, Card, SectionTitle, StatusPill, EmptyState, ErrorState } from '@/components/ui'
import { MODE_LABELS, SLUG_BY_MODE } from '@/lib/validation/enums'
import { useFetch, api, LoadingCard } from '@/modules/project-manager/components/useApi'
import ProgressExplain from '@/modules/project-manager/components/ProgressExplain'
import WorkstreamModal from '@/modules/project-manager/components/WorkstreamModal'
import ProjectModal from '@/modules/project-manager/components/ProjectModal'

// @req FR-043 - Project context is Business-owned; schema Workspace is shown as Space metadata.
// @spec ADR-014, SDD-021
// @tested tests/unit/project-business-context.test.js

export default function ProjectDetailPage() {
  const { projectId } = useParams()
  const [wsModal, setWsModal] = useState(false)
  const [editWs, setEditWs] = useState(null)
  const [editProject, setEditProject] = useState(false)
  const project = useFetch(`/api/projects/${projectId}`)
  const progress = useFetch(`/api/progress/project/${projectId}`)

  if (project.loading) return <LoadingCard />
  if (project.error) return <ErrorState detail={project.error} retry={project.reload} />
  const p = project.data
  if (!p) return <ErrorState detail="Project not found" />

  const reloadAll = () => {
    project.reload()
    progress.reload()
  }

  return (
    <div>
      <PageHeader
        eyebrow={`${p.business?.name || 'Shared project'} · Development`}
        title={p.name}
        subtitle={`${p.description || 'No description'} · Space: ${p.workspace?.code || '—'} · ${p.code}`}
        actions={
          <>
            <StatusPill status={p.status} />
            <button type="button" className="btn" onClick={() => setEditProject(true)}>Edit</button>
            <button
              type="button"
              className="btn flex items-center gap-1"
              onClick={async () => {
                if (window.confirm(`Archive ${p.code}?`)) {
                  await api(`/api/projects/${p.id}`, { method: 'DELETE' })
                  window.location.href = '/projects'
                }
              }}
            >
              <Archive size={12} aria-hidden /> Archive
            </button>
          </>
        }
      />

      <Card warm className="mb-4">
        <SectionTitle caption="Weighted roll-up: Σ(workstream % × weight) / Σ(weight)">Project progress</SectionTitle>
        {progress.loading ? (
          <p className="text-xs text-muted">Calculating…</p>
        ) : progress.error ? (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>{progress.error}</p>
        ) : (
          <ProgressExplain result={{ ...progress.data, evidence: { strategy: 'WEIGHTED_ROLLUP', formula: progress.data.formula, totalWeight: progress.data.totalWeight } }} />
        )}
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <SectionTitle caption="Each workstream has its own execution mode and progress strategy">Workstreams</SectionTitle>
        <button type="button" className="btn btn-primary flex items-center gap-1" onClick={() => setWsModal(true)}>
          <Plus size={12} aria-hidden /> New workstream
        </button>
      </div>
      {(p.workstreams || []).length === 0 ? (
        <EmptyState title="No workstreams" hint="Decompose the objective into workstreams — each picks one of the seven execution modes." />
      ) : (
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          {(progress.data?.workstreams || p.workstreams).map((ws) => (
            <Card key={ws.workstreamId || ws.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] text-muted">{ws.code} · weight {ws.progressWeight}</p>
                  <p className="truncate text-xs font-bold">{ws.name}</p>
                  <p className="mt-0.5 text-[9px] text-muted">{MODE_LABELS[ws.executionMode]} · {ws.progressStrategy?.replace(/_/g, ' ')}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Link
                    className="btn px-2 py-1 text-[10px]"
                    href={`/projects/${p.id}/execution/${SLUG_BY_MODE[ws.executionMode]}`}
                  >
                    Open view
                  </Link>
                  <button
                    type="button"
                    className="btn px-2 py-1 text-[10px]"
                    onClick={() => {
                      const raw = p.workstreams.find((w) => w.id === (ws.workstreamId || ws.id))
                      setEditWs(raw)
                      setWsModal(true)
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
              <div className="mt-3">
                {ws.percent != null ? (
                  <ProgressExplain result={ws} compact />
                ) : (
                  <p className="text-[10px] text-muted">progress pending…</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {wsModal && (
        <WorkstreamModal
          open={wsModal}
          onClose={() => {
            setWsModal(false)
            setEditWs(null)
          }}
          projectId={p.id}
          workstream={editWs}
          onSaved={reloadAll}
        />
      )}
      {editProject && (
        <ProjectModal open={editProject} onClose={() => setEditProject(false)} project={p} onSaved={reloadAll} />
      )}
    </div>
  )
}
