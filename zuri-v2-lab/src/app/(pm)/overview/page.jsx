'use client'

// @req FR-002, FR-020 — one landing route that adapts to the shell mode:
// many businesses with none picked → group roll-up cards;
// otherwise → that business's execution overview.
// @tested tests/e2e/smoke.spec.js

import Link from 'next/link'
import { PageHeader, Card, Kpi, SectionTitle, StatusPill, ProgressBar, EmptyState, ErrorState } from '@/components/ui'
import { MODE_LABELS, SLUG_BY_MODE } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'

function ProjectProgressRow({ project }) {
  const { data } = useFetch(`/api/progress/project/${project.id}`)
  return (
    <Link href={`/projects/${project.id}`} className="block rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-3 hover:border-[#F0BE81]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] text-muted">{project.code} · {project.workspace?.code}</p>
          <p className="truncate text-xs font-bold">{project.name}</p>
        </div>
        <StatusPill status={project.status} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1">
          <ProgressBar percent={data?.percent ?? 0} label={`${project.name} progress`} />
        </div>
        <span className="w-12 text-right text-xs font-bold">{data ? `${data.percent}%` : '…'}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(project.workstreams || []).map((ws) => (
          <span key={ws.id} className="pill pill-planned">{MODE_LABELS[ws.executionMode]}</span>
        ))}
      </div>
    </Link>
  )
}

function BusinessCard({ card, onOpen }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] text-muted">{card.code}</p>
          <p className="truncate text-sm font-bold">{card.name}</p>
        </div>
        <span className="text-lg font-bold">{card.percent}%</span>
      </div>
      <div className="mt-2">
        <ProgressBar percent={card.percent} label={`${card.name} progress`} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="pill pill-planned">{card.activeProjects}/{card.projectCount} โปรเจกต์ที่ทำอยู่</span>
        <span className={`pill ${card.openRequiredGates > 0 ? 'pill-gate' : 'pill-done'}`}>
          {card.openRequiredGates} gate ค้าง
        </span>
      </div>
      <p className="mt-2 text-[10px] text-muted">
        {card.nextMilestone
          ? `หมุดหมายถัดไป: ${card.nextMilestone.title} · ${String(card.nextMilestone.targetAt).slice(0, 10)}`
          : 'ยังไม่มีหมุดหมายที่ตั้งวันไว้'}
      </p>
    </>
  )
  if (!onOpen) return <Card>{body}</Card>
  return (
    <button type="button" className="card p-4 text-left hover:border-[#F0BE81]" onClick={onOpen}>
      {body}
    </button>
  )
}

// กรณี B — เจ้าของหลายธุรกิจยังไม่ได้เลือกธุรกิจ: ภาพรวมทั้งเครือ (อ่านอย่างเดียว)
function GroupLanding({ scope }) {
  const { data, loading, error, reload } = useFetch('/api/progress/portfolio')

  return (
    <div>
      <PageHeader
        eyebrow="ทุกธุรกิจ"
        title="ภาพรวมทั้งเครือ"
        subtitle="สุขภาพของแต่ละธุรกิจในเครือ — เลือกธุรกิจเพื่อเข้าไปทำงาน"
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && data && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Kpi label="ความคืบหน้ารวม" value={`${data.total.percent}%`} meta="ถ่วงน้ำหนักทุกสายงาน" />
            <Kpi label="ธุรกิจในเครือ" value={data.total.businessCount} meta="ข้อมูลแยกกันโดยอัตโนมัติ" />
            <Kpi label="โปรเจกต์ทั้งหมด" value={data.total.projectCount} meta="ไม่รวมที่เก็บถาวร" />
            <Kpi
              label="Gate บังคับที่ค้าง"
              value={data.total.openRequiredGates}
              tone={data.total.openRequiredGates > 0 ? 'warn' : 'good'}
              meta="ทั้งเครือ"
            />
          </div>
          <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
            {data.businesses.map((card) => (
              <BusinessCard key={card.code} card={card} onOpen={() => scope.select({ businessId: card.id })} />
            ))}
            {data.group && <BusinessCard card={data.group} />}
          </div>
          <p className="mt-3 text-[10px] text-muted">
            มุมมองนี้อ่านอย่างเดียว — การสร้างหรือแก้ไขงานทำในธุรกิจที่เลือก
          </p>
        </>
      )}
    </div>
  )
}

// กรณี A — ธุรกิจเดียว หรือเลือกธุรกิจแล้ว: งานของธุรกิจนั้น
function BusinessOverview({ scope }) {
  const businessId = scope.shell.activeBusinessId
  const params = new URLSearchParams()
  // An explicit workspace is the narrower scope — and group-level workspaces
  // are shared, so combining both filters would wrongly return nothing.
  if (scope.selection.workspaceId) params.set('workspaceId', scope.selection.workspaceId)
  else if (businessId) params.set('businessId', businessId)
  const { data: projects, loading, error, reload } = useFetch(`/api/projects?${params.toString()}`, [
    businessId,
    scope.selection.workspaceId,
  ])

  const workstreamCount = (projects || []).reduce((s, p) => s + (p.workstreams?.length || 0), 0)
  const openGates = (projects || []).reduce(
    (s, p) => s + (p.gates || []).filter((g) => g.required && !['PASSED', 'WAIVED'].includes(g.status)).length,
    0
  )
  const milestonesDone = (projects || []).reduce((s, p) => s + (p.milestones || []).filter((m) => m.status === 'DONE').length, 0)
  const milestonesTotal = (projects || []).reduce((s, p) => s + (p.milestones || []).length, 0)

  return (
    <div>
      <PageHeader
        eyebrow={scope.shell.multiBusiness ? 'ธุรกิจที่เลือก' : 'ธุรกิจของคุณ'}
        title={scope.shell.activeBusiness ? `${scope.shell.activeBusiness.name} — Overview` : 'Overview'}
        subtitle="Business execution across every project and workstream in the selected scope."
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Kpi label="Active projects" value={(projects || []).filter((p) => p.status === 'ACTIVE').length} meta={`${(projects || []).length} total in scope`} />
            <Kpi label="Workstreams" value={workstreamCount} meta="across all execution modes" />
            <Kpi label="Open required gates" value={openGates} tone={openGates > 0 ? 'warn' : 'good'} meta="guarding progress" />
            <Kpi label="Milestones done" value={`${milestonesDone}/${milestonesTotal}`} meta="in this scope" />
          </div>
          <div className="grid grid-cols-[1.5fr_1fr] gap-4 max-md:grid-cols-1">
            <Card>
              <SectionTitle caption="Weighted progress per project — click to open">Projects</SectionTitle>
              {(projects || []).length === 0 ? (
                <EmptyState
                  title="ยังไม่มีโปรเจกต์ในธุรกิจนี้"
                  hint="เริ่มจากเป้าหมายที่อยากทำให้สำเร็จ แล้วระบบจะช่วยแตกเป็นสายงานให้"
                  action={<Link className="btn btn-primary" href="/projects/new">เริ่มจากเป้าหมายใหม่</Link>}
                />
              ) : (
                <div className="space-y-2.5">
                  {(projects || []).map((p) => <ProjectProgressRow key={p.id} project={p} />)}
                </div>
              )}
            </Card>
            <Card>
              <SectionTitle caption="Seven canonical execution modes">Execution modes</SectionTitle>
              <div className="space-y-1.5">
                {Object.entries(MODE_LABELS).map(([mode, label], i) => (
                  <Link key={mode} href={`/execution/${SLUG_BY_MODE[mode]}`} className="flex items-center justify-between rounded-xl border border-[#ECEEF1] p-2.5 hover:bg-brand-surface">
                    <span className="text-[11px] font-bold">{i + 1}. {label}</span>
                    <span className="pill pill-planned">
                      {(projects || []).reduce((s, p) => s + (p.workstreams || []).filter((w) => w.executionMode === mode).length, 0)} streams
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

export default function OverviewPage() {
  const scope = useScope()
  return scope.shell.landing === 'PORTFOLIO' ? <GroupLanding scope={scope} /> : <BusinessOverview scope={scope} />
}
