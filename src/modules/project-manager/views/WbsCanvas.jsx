'use client'

// @req FR-040 — Structure Plan renders the opened Project's canonical work hierarchy.
// @spec SDD-019, ADR-012 — Project > Work > Structure Plan is a read-only WBS view.
// @tested tests/unit/wbs-structure.test.js
import { useState } from 'react'
import { FolderKanban, ListChecks, SquareStack } from 'lucide-react'
import { MODE_LABELS } from '@/lib/validation/enums'
import { useFetch, LoadingCard } from '../components/useApi'
import { ErrorState, EmptyState } from '@/components/ui'
import WorkpackageModal from '../components/WorkpackageModal'
import s from './wbs.module.css'

const STATUS_DOT = {
  PLANNED: '#9CA3AF', READY: '#3b82f6', IN_PROGRESS: '#2563eb', REVIEW: '#f59e0b',
  BLOCKED: '#C84B4B', DONE: '#238553', CANCELLED: '#C0C4CC',
}
const short = (str, n = 26) => (str && str.length > n ? `${str.slice(0, n)}…` : str)

function ItemCard({ item, onOpen }) {
  const dot = STATUS_DOT[item.status] || '#9CA3AF'
  return (
    <button
      type="button"
      className={s.card}
      title={item.title}
      aria-label={`WorkItem: ${item.title}`}
      onClick={() => onOpen(item)}
      style={{ cursor: 'pointer', textAlign: 'left' }}
    >
      <div className={s.eyebrow}>WorkItem</div>
      <div className={s.head}>
        <span className={s.dot} style={{ background: dot }} aria-hidden />
        <span className={s.title}>{item.title}</span>
      </div>
      <div className={s.badges}>
        <span className={s.badge}>{item.subtype?.replace(/_/g, ' ')}</span>
        <span className={s.badge} style={{ color: dot }}>{item.status?.replace(/_/g, ' ').toLowerCase()}</span>
      </div>
    </button>
  )
}

function ContainerNode({ container, onOpen }) {
  const items = container.items || []
  const children = container.children || []
  return (
    <div className={s.node}>
      <div
        className={s.card}
        title={container.title}
        role="treeitem"
        tabIndex={0}
        aria-label={`WorkContainer: ${container.title}`}
        aria-expanded={children.length > 0 || items.length > 0}
      >
        <div className={s.eyebrow}>WorkContainer</div>
        <div className={s.head}>
          <span className={s.dot} style={{ background: '#238553' }} aria-hidden />
          <span className={s.title}>{container.title}</span>
        </div>
        <div className={s.badges}>
          <span className={s.badge}><ListChecks size={9} aria-hidden /> {items.length} work items</span>
          {container.subtype && <span className={s.badge}>{container.subtype.replace(/_/g, ' ')}</span>}
        </div>
      </div>
      {children.length > 0 && (
        <div className={s.branch} aria-label={`${container.title} child work containers`}>
          {children.map((child) => (
            <div key={child.id} className={s.leaf}><ContainerNode container={child} onOpen={onOpen} /></div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className={s.chain}>
          {items.map((it) => (
            <div key={it.id} className={s.chainItem}><ItemCard item={it} onOpen={onOpen} /></div>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkstreamNode({ ws, onOpen }) {
  const containers = ws.containers || []
  const items = ws.items || []
  return (
    <div className={s.node}>
      <div
        className={s.card}
        title={ws.name}
        role="treeitem"
        tabIndex={0}
        aria-label={`Workstream: ${ws.name}`}
        aria-expanded={containers.length > 0 || items.length > 0}
      >
        <div className={s.eyebrow}>Workstream</div>
        <div className={s.head}>
          <span className={s.icon} style={{ background: '#7c6cf0' }} aria-hidden><SquareStack size={13} /></span>
          <span className={s.title}>{ws.name}</span>
        </div>
        <div className={s.badges}>
          <span className={s.badge}>{MODE_LABELS[ws.executionMode] || ws.executionMode}</span>
          <span className={s.badge}>{containers.length} work containers</span>
        </div>
      </div>
      {containers.length > 0 && (
        <div className={s.branch}>
          {containers.map((c) => (
            <div key={c.id} className={s.leaf}><ContainerNode container={c} onOpen={onOpen} /></div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className={s.chain} aria-label={`${ws.name} ungrouped work items`}>
          {items.map((item) => (
            <div key={item.id} className={s.chainItem}><ItemCard item={item} onOpen={onOpen} /></div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function WbsCanvas({ projectId }) {
  const { data, loading, error, reload } = useFetch(`/api/projects/${projectId}/tree`)
  const [selected, setSelected] = useState(null)
  if (loading) {
    return <div className={s.state} aria-label="Structure Plan loading"><LoadingCard /></div>
  }
  if (error) {
    return <div className={s.state} aria-label="Structure Plan error"><ErrorState detail={error} retry={reload} /></div>
  }
  const project = data
  if (!project) {
    return <div className={s.state} aria-label="Structure Plan empty"><EmptyState title="Project unavailable" hint="This project could not be loaded." /></div>
  }
  const workstreams = project?.workstreams || []

  return (
    <>
    <section className={s.canvas} aria-label="Project Structure Plan">
      <div className={s.tree} role="tree" aria-label={`${project.name} work breakdown structure`}>
        <div className={s.node}>
          <div
            className={`${s.card} ${s.rootCard}`}
            title={project.name}
            role="treeitem"
            tabIndex={0}
            aria-label={`Project: ${project.name}`}
            aria-expanded={workstreams.length > 0}
          >
            <div className={s.eyebrow}>Project</div>
            <div className={s.head}>
              <span className={s.icon} style={{ background: '#2f4fe0' }} aria-hidden><FolderKanban size={13} /></span>
              <span className={s.title}>{short(project?.name, 30)}</span>
            </div>
            <div className={s.badges}>
              <span className={s.badge}>{project.code}</span>
              <span className={s.badge}>{workstreams.length} workstreams</span>
            </div>
          </div>
          {workstreams.length === 0 ? (
            <div className="mt-6">
              <EmptyState title="No workstreams yet" hint="Add a workstream to start the structure plan." />
            </div>
          ) : (
            <div className={s.branch}>
              {workstreams.map((ws) => (
                <div key={ws.id} className={s.leaf}><WorkstreamNode ws={ws} onOpen={setSelected} /></div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
    <WorkpackageModal key={selected?.id} open={!!selected} item={selected} onClose={() => setSelected(null)} onSaved={reload} />
    </>
  )
}
