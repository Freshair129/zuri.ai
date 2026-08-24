'use client'

// @req FR-095 — the SoT plan board: phase status is read from the derivation
// endpoint and never edited here; the only actions are navigation into run
// evidence and the FR-096 inbox.
// @spec FR-095
// @tested tests/unit/sot-plan-board-ui.test.js
import Link from 'next/link'

import { Card, ErrorState, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

const STATUS_TH = {
  planned: 'รอเริ่ม',
  running: 'กำลังทำ',
  blocked: 'ติดรออนุมัติ/แก้',
  done: 'เสร็จ',
}

// Maps onto the design-system pill statuses (NFR-008): color never carries
// meaning alone, so the Thai label always sits next to the pill.
const STATUS_PILL = {
  planned: 'PLANNED',
  running: 'IN_PROGRESS',
  blocked: 'BLOCKED',
  done: 'DONE',
}

export default function SotPipelineBoardPage() {
  const { businessId } = useScope()
  const { data, error, loading } = useFetch(
    businessId ? `/api/platform/sot/plan?businessId=${businessId}` : null,
    [businessId]
  )

  if (!businessId) return <ErrorState message="เลือก Business ก่อนเพื่อดูแผน SoT Pipeline" />
  if (loading) return <LoadingCard />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  return (
    <div>
      <PageHeader
        title="SoT Pipeline — แผนงาน"
        subtitle={`${data.titleTh} · v${data.version} · สถานะคำนวณจากหลักฐาน run จริง ไม่ใช่กรอกมือ`}
        actions={(
          <span style={{ display: 'inline-flex', gap: '.6rem' }}>
            <Link href="/platform/sot-pipeline/inbox">กล่องรออนุมัติ</Link>
            <Link href="/platform/sot-pipeline/graph">มุมมองกราฟ</Link>
          </span>
        )}
      />
      <div style={{ display: 'grid', gap: '.6rem' }}>
        {data.phases.map((phase) => (
          <Card key={phase.phaseId}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '.7rem', flexWrap: 'wrap' }}>
              <SectionTitle>{phase.phaseId} · {phase.titleTh}</SectionTitle>
              <StatusPill status={STATUS_PILL[phase.status]} />
              <span style={{ fontSize: '.85em' }}>{STATUS_TH[phase.status]}</span>
              {phase.kind === 'HUMAN_GATE' ? <StatusPill status="REVIEW" /> : null}
              {phase.pendingDecisions > 0 ? (
                <Link href={`/platform/sot-pipeline/inbox?phaseId=${phase.phaseId}`}>
                  รออนุมัติ {phase.pendingDecisions} รายการ
                </Link>
              ) : null}
            </div>
            <p style={{ margin: '.35rem 0 0', color: 'var(--muted, #667)' }}>{phase.summaryTh}</p>
            {phase.runs.length > 0 ? (
              <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem', fontSize: '.85em' }}>
                {phase.runs.map((run) => (
                  <li key={run.dataPipelineDefinitionId}>
                    <code>{run.dataPipelineDefinitionId}</code>
                    {' — '}
                    {run.executionRunId
                      ? <>{run.status} (<code>{run.executionRunId}</code>)</>
                      : 'ยังไม่มี run'}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  )
}
