'use client'

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
    <button type="button" className={s.card} title={item.title} onClick={() => onOpen(item)} style={{ cursor: 'pointer', textAlign: 'left' }}>
      <div className={s.eyebrow}>Workpackage</div>
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
  return (
    <div className={s.node}>
      <div className={s.card} title={container.title}>
        <div className={s.eyebrow}>Part Task</div>
        <div className={s.head}>
          <span className={s.dot} style={{ background: '#238553' }} aria-hidden />
          <span className={s.title}>{container.title}</span>
        </div>
        <div className={s.badges}>
          <span className={s.badge}><ListChecks size={9} aria-hidden /> {items.length} work</span>
          {container.subtype && <span className={s.badge}>{container.subtype.replace(/_/g, ' ')}</span>}
        </div>
      </div>
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
  return (
    <div className={s.node}>
      <div className={s.card} title={ws.name}>
        <div className={s.eyebrow}>Part Project</div>
        <div className={s.head}>
          <span className={s.icon} style={{ background: '#7c6cf0' }} aria-hidden><SquareStack size={13} /></span>
          <span className={s.title}>{ws.name}</span>
        </div>
        <div className={s.badges}>
          <span className={s.badge}>{MODE_LABELS[ws.executionMode] || ws.executionMode}</span>
          <span className={s.badge}>{containers.length} tasks</span>
        </div>
      </div>
      {containers.length > 0 && (
        <div className={s.branch}>
          {containers.map((c) => (
            <div key={c.id} className={s.leaf}><ContainerNode container={c} onOpen={onOpen} /></div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function WbsCanvas({ projectId }) {
  const { data, loading, error, reload } = useFetch(`/api/projects/${projectId}/tree`)
  const [selected, setSelected] = useState(null)
  if (loading) return <LoadingCard />
  if (error) return <ErrorState detail={error} retry={reload} />
  const project = data
  const workstreams = project?.workstreams || []

  return (
    <>
    <div className={s.canvas}>
      <div className={s.tree}>
        <div className={s.node}>
          <div className={`${s.card} ${s.rootCard}`} title={project?.name}>
            <div className={s.eyebrow}>Project</div>
            <div className={s.head}>
              <span className={s.icon} style={{ background: '#2f4fe0' }} aria-hidden><FolderKanban size={13} /></span>
              <span className={s.title}>{short(project?.name, 30)}</span>
            </div>
            <div className={s.badges}>
              <span className={s.badge}>{project?.code}</span>
              <span className={s.badge}>{workstreams.length} part projects</span>
            </div>
          </div>
          {workstreams.length === 0 ? (
            <div className="mt-6">
              <EmptyState title="No part projects yet" hint="Add a workstream to start the structure plan." />
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
    </div>
    <WorkpackageModal key={selected?.id} open={!!selected} item={selected} onClose={() => setSelected(null)} onSaved={reload} />
    </>
  )
}
