'use client'

// @req FR-278 — one-page executive view of weekly verified Commerce measures,
//   live CRM follow-up health, and funnel stages that have no approved source.
// @spec SEC-001; SDD-086
// @tested tests/unit/marketing/line-sales-dashboard-ui.test.js

import React, { useState } from 'react'
import { Card, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { useFetch } from '@/modules/project-manager/components/useApi'
import { MarketingDataState, ScopeNotice } from './MarketingState'

const REASONS = {
  PAID_MEDIA_METRICS_SOURCE_UNAVAILABLE: 'ยังไม่มีแหล่งสถิติ Ads และ A/B Test ที่อนุมัติและตรวจสอบได้',
  LEAD_ATTRIBUTION_SOURCE_UNAVAILABLE: 'ยังไม่มีสถิติ AI chatbot, Lead lifecycle และหลักฐานเชื่อมกับ Ads ที่ยืนยันได้',
  CALL_OUTCOMES_SOURCE_UNAVAILABLE: 'ยังไม่มีบันทึกการโทรและผลการโทรแบบโครงสร้าง',
  VERIFIED_REVENUE_UNAVAILABLE: 'บัญชีนี้อ่านข้อมูล Commerce ไม่ได้หรือยังไม่มีข้อมูล',
  VERIFIED_REVENUE_READ_UNKNOWN: 'อ่านข้อมูล Commerce ไม่สำเร็จ จึงไม่แสดงยอดแทน',
  SALES_TASK_HEALTH_UNAVAILABLE: 'บัญชีนี้อ่านข้อมูล CRM ไม่ได้หรือยังไม่มีข้อมูล',
  SALES_TASK_HEALTH_READ_UNKNOWN: 'อ่านข้อมูล CRM ไม่สำเร็จ จึงไม่แสดงตัวเลขแทน',
}

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function mondayOf(key) {
  const date = new Date(`${key}T00:00:00.000Z`)
  return addDays(key, -((date.getUTCDay() + 6) % 7))
}

function currency(value) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(value)
}

function timestamp(value) {
  if (!value) return 'ไม่มีเวลาอ่านข้อมูล'
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(new Date(value))
}

function MetricCard({ label, value, source, note }) {
  return (
    <Card className="min-h-32">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold text-muted">{label}</p>
        {source && <StatusPill status={source.state} />}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      {note && <p className="mt-1 text-[10px] text-muted">{note}</p>}
      {source?.reasonCode && <p className="mt-2 text-[10px] text-muted">{REASONS[source.reasonCode] || source.reasonCode}</p>}
      {source?.observedAt && <p className="mt-2 text-[10px] text-muted">อ่านข้อมูล ณ {timestamp(source.observedAt)}</p>}
    </Card>
  )
}

function StepNumber({ step }) {
  return <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[10px] font-bold text-[var(--brand-dark)]">{String(step).padStart(2, '0')}</span>
}

function TaskHealth({ step, section }) {
  const source = section.source
  const summary = section.summary
  const metrics = [
    ['งานเปิด', summary?.open],
    ['กำลังดำเนินการ', summary?.inProgress],
    ['เกินกำหนด', summary?.overdue],
    ['ครบกำหนดวันนี้', summary?.dueToday],
    ['ยังไม่มอบหมาย', summary?.unassigned],
  ]
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2"><StepNumber step={step} /><SectionTitle caption="ข้อมูลรวมจาก CRM · ไม่แสดงรายชื่อลูกค้าหรืองานรายบุคคล">สุขภาพงานติดตามการขาย</SectionTitle></div>
        <StatusPill status={section.state} />
      </div>
      {summary ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {metrics.map(([label, value]) => <div key={label} className="rounded-lg bg-[var(--surface-mid)] p-3">
            <p className="text-[10px] text-muted">{label}</p><p className="mt-1 text-xl font-bold">{value}</p>
          </div>)}
        </div>
      ) : <p className="mt-4 text-sm text-muted">{REASONS[source.reasonCode] || 'ไม่มีข้อมูล CRM ที่อ่านได้'}</p>}
      <p className="mt-3 text-[10px] text-muted">เป็น snapshot ปัจจุบัน ไม่ใช่สถานะย้อนหลังของสัปดาห์ · อ่านข้อมูล ณ {timestamp(section.observedAt)}</p>
    </Card>
  )
}

function UnavailableCard({ step, title, section, labels }) {
  return (
    <Card className="min-h-36">
      <div className="flex items-start justify-between gap-2"><div className="flex items-start gap-2"><StepNumber step={step} /><SectionTitle>{title}</SectionTitle></div><StatusPill status={section.state} /></div>
      <p className="mt-3 text-sm font-semibold text-muted">ยังไม่มีข้อมูลที่ยืนยันได้</p>
      <p className="mt-1 text-[10px] text-muted">{REASONS[section.reasonCode]}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${title} metrics`}>
        {labels.map((label) => <span key={label} className="rounded-md bg-[var(--surface-mid)] px-2 py-1 text-[10px] text-muted">{label}: —</span>)}
      </div>
    </Card>
  )
}

function CommerceCloseStage({ step, section }) {
  const summary = section.orders
  return (
    <Card className="min-h-36">
      <div className="flex items-start justify-between gap-2"><div className="flex items-start gap-2"><StepNumber step={step} /><SectionTitle>ปิดการขายใน Commerce</SectionTitle></div><StatusPill status={section.state} /></div>
      {summary ? <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-[var(--surface-mid)] p-3"><p className="text-[10px] text-muted">ออเดอร์ที่ยังเปิด</p><p className="mt-1 text-xl font-bold">{summary.open}</p></div>
        <div className="rounded-lg bg-[var(--surface-mid)] p-3"><p className="text-[10px] text-muted">ออเดอร์สำเร็จ</p><p className="mt-1 text-xl font-bold">{summary.completed}</p></div>
      </div> : <p className="mt-4 text-sm text-muted">{REASONS[section.source?.reasonCode] || 'ไม่มีสถานะออเดอร์ที่อ่านได้'}</p>}
      <p className="mt-3 text-[10px] text-muted">สถานะออเดอร์ปัจจุบัน · รายรับจริงแสดงด้านบนตามสัปดาห์ที่เลือก</p>
    </Card>
  )
}

export default function LineSalesExecutiveDashboard({ businessId }) {
  const scope = useScope()
  const [weekOf, setWeekOf] = useState('')
  const path = businessId
    ? `/api/growth/line-sales?businessId=${encodeURIComponent(businessId)}${weekOf ? `&weekOf=${encodeURIComponent(weekOf)}` : ''}`
    : null
  const { data, loading, error, reload } = useFetch(path, [businessId, weekOf])
  const businessName = scope.shell.activeBusiness?.name || 'ธุรกิจที่เลือก'
  if (!businessId) return <ScopeNotice />

  const sections = data?.sections
  const week = data?.window
  const selectedWeek = weekOf || week?.from || ''
  const chooseDay = (day) => setWeekOf(mondayOf(day))

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-5 max-md:p-3">
      <PageHeader
        eyebrow="LINE OA · SALES"
        title="ภาพรวมการขายสำหรับผู้บริหาร"
        subtitle={`${businessName} · วัดเฉพาะตัวเลขจากแหล่งข้อมูลที่เจ้าของระบบยืนยันได้`}
        actions={<button type="button" className="btn text-[11px]" onClick={reload}>รีเฟรชข้อมูล</button>}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-3">
        <div>
          <p className="text-[11px] font-semibold">รายรับรายสัปดาห์</p>
          <p className="mt-1 text-[10px] text-muted">จันทร์ 00:00 ถึงก่อนจันทร์ถัดไป · Asia/Bangkok</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn px-3" aria-label="สัปดาห์ก่อน" disabled={!week} onClick={() => chooseDay(addDays(week.from, -7))}>‹</button>
          <input
            aria-label="เลือกสัปดาห์ โดยระบุวันใดก็ได้ในสัปดาห์นั้น"
            type="date"
            value={selectedWeek}
            onChange={(event) => event.target.value && chooseDay(event.target.value)}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
          />
          <button type="button" className="btn px-3" aria-label="สัปดาห์ถัดไป" disabled={!week} onClick={() => chooseDay(addDays(week.from, 7))}>›</button>
          {week && <StatusPill status={data.state} />}
        </div>
      </div>

      <MarketingDataState loading={loading} error={error} retry={reload}>
        {sections && <>
          <section aria-label="ยอดขายและออเดอร์" className="space-y-3">
            <div><SectionTitle caption={`ช่วงรายรับ ${week.from} ถึง ${week.to} · ตัวเลขยอดเงินเป็น VERIFIED`}>ยอดขายและออเดอร์</SectionTitle></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard label="รายรับสุทธิ" value={sections.commerce.state === 'READY' ? currency(sections.commerce.verifiedNet) : '—'} source={sections.commerce.source} note="รับเงินจริง หัก refund ที่ยืนยันแล้ว" />
              <MetricCard label="Refund ที่ยืนยันแล้ว" value={sections.commerce.state === 'READY' ? currency(sections.commerce.refunded) : '—'} source={sections.commerce.source} />
              <MetricCard label="ยอดรอตรวจ" value={sections.commerce.state === 'READY' ? currency(sections.commerce.pending?.amount) : '—'} source={sections.commerce.source} note={sections.commerce.state === 'READY' ? `${sections.commerce.pending?.count ?? 0} รายการ` : undefined} />
            </div>
          </section>

          <section aria-label="เส้นทางจากโฆษณาถึงการปิดการขาย" className="space-y-3">
            <div><SectionTitle caption="อ่านตามลำดับขั้น · ตัวเลขที่ไม่มี owner source แสดง UNAVAILABLE ไม่แทนด้วยศูนย์">เส้นทางจากโฆษณาถึงการปิดการขาย</SectionTitle></div>
            <ol aria-label="ขั้นตอนการขายผ่าน LINE OA" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <li><UnavailableCard step={1} title="Ads และ A/B Test" section={sections.paidMedia} labels={['Spend', 'Impressions', 'Clicks', 'A/B results', 'ROAS']} /></li>
              <li><UnavailableCard step={2} title="AI chatbot ตอบและส่งต่อ Lead" section={sections.leadAttribution} labels={['ตอบโดย AI', 'ส่งต่อ Lead', 'มีเบอร์/พร้อมโทร', 'อนุญาตให้โทร']} /></li>
              <li><TaskHealth step={3} section={sections.followUp} /></li>
              <li><UnavailableCard step={4} title="แอดมินโทรติดตาม" section={sections.callOutcomes} labels={['โทรออก', 'ติดต่อได้', 'ปิดการขาย']} /></li>
              <li><CommerceCloseStage step={5} section={sections.commerce} /></li>
            </ol>
          </section>

          <Card className="border-l-4 border-l-[var(--brand)]">
            <p className="text-xs font-semibold">การอ่านผลรายสัปดาห์</p>
            <p className="mt-1 text-[11px] text-muted">รายรับใช้ช่วงสัปดาห์ที่เลือก ส่วน CRM เป็น snapshot ณ เวลาอ่านข้อมูล ระบบรุ่นนี้ยังไม่เก็บ snapshot รายสัปดาห์หรือเชื่อมรายรับกับ campaign/Lead; ห้ามเรียกยอดจาก CHAT ว่า Ads-attributed revenue.</p>
            <p className="mt-2 text-[10px] text-muted">สร้างข้อมูล ณ {timestamp(data.generatedAt)} · สถานะรวม <span className="font-semibold">{data.state}</span></p>
          </Card>
        </>}
      </MarketingDataState>
    </main>
  )
}
