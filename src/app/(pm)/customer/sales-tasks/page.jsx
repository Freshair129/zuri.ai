'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { SALES_TASK_ACTIONS, SALES_TASK_PRIORITIES, SALES_TASK_TYPES } from '@/lib/validation/enums'

// @req FR-157 — the sales tasks console: the follow-ups a Business's sales
//   team owes customers, with the due state and summary the server recomputes
//   against today on every load; create a task (optionally on a conversation
//   and assigned to a member), start it, complete it with an outcome, cancel
//   it. Writes need OWNER or SALES_REP; the server refuses, the page shows
//   the refusal.
// @spec ADR-064; SEC-001 — every request names the selected Business as a
//   selector the server validates against the trusted viewer.
// @tested tests/e2e/fr157-sales-tasks.spec.js, tests/unit/sales-task-routes.test.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const TYPE_LABEL = { FOLLOW_UP: 'ติดตาม', CALL: 'โทร', LINE_MESSAGE: 'ส่ง LINE', EMAIL: 'อีเมล', MEETING: 'นัดพบ', DEMO: 'เดโม', QUOTE: 'ใบเสนอราคา' }
const PRIORITY_LABEL = { URGENT: 'ด่วน', HIGH: 'สูง', NORMAL: 'ปกติ', LOW: 'ต่ำ' }
const STATUS_LABEL = { OPEN: 'รอทำ', IN_PROGRESS: 'กำลังทำ', DONE: 'เสร็จ', CANCELLED: 'ยกเลิก' }
const DUE_LABEL = { OVERDUE: 'เกินกำหนด', TODAY: 'วันนี้', UPCOMING: 'ถัดไป', NONE: '' }
// Row buttons, derived from the action registry (never a second list of it):
// which actions a row offers depends only on its status.
const isOpen = (status) => status === 'OPEN' || status === 'IN_PROGRESS'
const ROW_ACTIONS = {
  START: { label: 'เริ่ม', when: (status) => status === 'OPEN' },
  COMPLETE: { label: 'เสร็จ', primary: true, when: isOpen },
  CANCEL: { label: 'ยกเลิก', when: isOpen },
  REOPEN: { label: 'เปิดใหม่', when: (status) => !isOpen(status) },
}
const FILTERS = [
  ['open', 'ที่เปิดอยู่', ''],
  ['mine', 'ของฉัน', '&assigneePersonId=me'],
  ['today', 'วันนี้', '&due=TODAY'],
  ['overdue', 'เกินกำหนด', '&due=OVERDUE'],
  ['closed', 'ปิดแล้ว', '&includeClosed=true'],
]

function Input({ label, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<input className={fieldClass} aria-label={label} {...props} /></label>
}
function Select({ label, options, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<select className={fieldClass} aria-label={label} {...props}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
}

const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const dateOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

export default function SalesTasksPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [filter, setFilter] = useState('open')
  const [data, setData] = useState(null)
  const [people, setPeople] = useState([])
  const [conversations, setConversations] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ title: '', type: 'FOLLOW_UP', priority: 'NORMAL', dueDate: todayKey(), timeStart: '', timeEnd: '', conversationId: '', assigneePersonId: '', description: '' })
  const bind = (name) => ({ name, value: form[name] ?? '', onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })) })

  const refresh = useCallback(async () => {
    if (!businessId) { setData(null); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const extra = FILTERS.find(([key]) => key === filter)?.[2] ?? ''
    const [tasks, directory, inbox] = await Promise.all([
      api(`/api/crm/sales-tasks?${q}${extra}`),
      api(`/api/people?${q}`).catch(() => ({ people: [] })),
      api(`/api/crm/conversations?${q}`).catch(() => ({ conversations: [] })),
    ])
    setData(tasks); setPeople(directory.people ?? []); setConversations(inbox.conversations ?? [])
  }, [businessId, filter])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  async function run(fn, done) {
    if (!businessId || busy) return
    setBusy(true); setError(''); setMessage('')
    try { const text = await fn(); setMessage(text); done?.(); await refresh() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const create = () => run(async () => {
    const task = await api('/api/crm/sales-tasks', 'POST', {
      businessId, title: form.title, type: form.type, priority: form.priority, dueDate: form.dueDate,
      ...(form.timeStart ? { timeStart: form.timeStart } : {}), ...(form.timeEnd ? { timeEnd: form.timeEnd } : {}),
      ...(form.conversationId ? { conversationId: form.conversationId } : {}), ...(form.assigneePersonId ? { assigneePersonId: form.assigneePersonId } : {}),
      ...(form.description ? { description: form.description } : {}),
    })
    return `สร้างงาน ${task.code} แล้ว`
  }, () => setForm((f) => ({ ...f, title: '', description: '', timeStart: '', timeEnd: '' })))

  const act = (task, action, extra = {}) => run(async () => {
    const result = await api(`/api/crm/sales-tasks/${task.id}`, 'PATCH', { action, version: task.version, ...extra })
    return `${result.code}: ${STATUS_LABEL[result.status]}`
  })

  const columns = [
    { key: 'code', label: 'รหัส', render: (t) => <span className="font-mono text-xs">{t.code}</span> },
    { key: 'title', label: 'งาน', render: (t) => <div><p className="font-semibold">{t.title}</p>{t.customer && <p className="text-[11px] text-muted">{t.customer.displayName}</p>}</div> },
    { key: 'type', label: 'ประเภท', render: (t) => TYPE_LABEL[t.type] || t.type },
    { key: 'priority', label: 'ความสำคัญ', render: (t) => PRIORITY_LABEL[t.priority] || t.priority },
    { key: 'dueDate', label: 'กำหนด', render: (t) => <span style={{ color: t.dueState === 'OVERDUE' ? 'var(--danger)' : 'inherit' }}>{dateOf(t.dueDate)}{t.timeStart ? ` ${t.timeStart}${t.timeEnd ? `–${t.timeEnd}` : ''}` : ''}{t.dueState !== 'NONE' ? ` · ${DUE_LABEL[t.dueState]}` : ''}</span> },
    { key: 'assignee', label: 'ผู้รับผิดชอบ', render: (t) => t.assignee?.displayName || '—' },
    { key: 'status', label: 'สถานะ', render: (t) => STATUS_LABEL[t.status] || t.status },
    { key: 'actions', label: '', render: (t) => <div className="flex flex-wrap gap-1">
      {SALES_TASK_ACTIONS.filter((action) => ROW_ACTIONS[action]?.when(t.status)).map((action) => (
        <button key={action} type="button" className={`btn px-2 py-1 text-xs ${ROW_ACTIONS[action].primary ? 'btn-primary' : ''}`} disabled={busy} onClick={() => act(t, action)}>{ROW_ACTIONS[action].label}</button>
      ))}
    </div> },
  ]

  return <div>
    <PageHeader
      eyebrow="CRM · FEAT-021"
      title="งานขาย (Sales Tasks)"
      subtitle={`งานติดตามลูกค้าที่ทีมขายต้องทำ — โทร ส่ง LINE นัดพบ เดโม ใบเสนอราคา${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูงานขาย</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {data && <div className="mb-4 grid gap-3 md:grid-cols-5">
      <Kpi label="รอทำ" value={data.summary.open} />
      <Kpi label="กำลังทำ" value={data.summary.inProgress} />
      <Kpi label="วันนี้" value={data.summary.dueToday} tone={data.summary.dueToday ? 'warn' : undefined} />
      <Kpi label="เกินกำหนด" value={data.summary.overdue} tone={data.summary.overdue ? 'bad' : 'good'} />
      <Kpi label="ของฉัน" value={data.summary.mine} meta={data.summary.unassigned ? `ยังไม่มอบหมาย ${data.summary.unassigned}` : undefined} />
    </div>}

    {business && <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="ตัวกรอง">
      {FILTERS.map(([key, label]) => <button key={key} type="button" className={`btn px-3 py-1 text-xs ${filter === key ? 'btn-primary' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
    </div>}

    {data && <div className="mb-4">
      <SectionTitle caption="สถานะ 'วันนี้' และ 'เกินกำหนด' คำนวณจากวันปัจจุบันทุกครั้งที่โหลด ไม่ได้เก็บในตัวงาน">รายการงาน</SectionTitle>
      <DataTable columns={columns} rows={data.tasks} rowKey={(t) => t.id} />
    </div>}

    {business && <Card>
      <SectionTitle caption="TSK-YYYYMMDD-NNN ออกให้อัตโนมัติ · ผูกกับบทสนทนาและผู้รับผิดชอบได้">งานใหม่</SectionTitle>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-3"><Input label="ชื่องาน" placeholder="โทรติดตามใบเสนอราคา" {...bind('title')} /></div>
        <Select label="ประเภท" options={SALES_TASK_TYPES.map((t) => [t, TYPE_LABEL[t]])} {...bind('type')} />
        <Select label="ความสำคัญ" options={SALES_TASK_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])} {...bind('priority')} />
        <Input label="วันกำหนด" type="date" {...bind('dueDate')} />
        <Input label="เวลาเริ่ม" type="time" {...bind('timeStart')} />
        <Input label="เวลาสิ้นสุด" type="time" {...bind('timeEnd')} />
        <Select label="ผู้รับผิดชอบ" options={[['', '— ยังไม่มอบหมาย —'], ...people.map((p) => [p.person.id, p.person.displayName])]} {...bind('assigneePersonId')} />
        <div className="md:col-span-3"><Select label="บทสนทนา" options={[['', '— ไม่ผูกบทสนทนา —'], ...conversations.map((c) => [c.id, `${c.customer?.displayName ?? c.id} · ${c.channel}`])]} {...bind('conversationId')} /></div>
        <label className="grid gap-1 text-xs font-semibold md:col-span-3">รายละเอียด<textarea className={fieldClass} rows={2} aria-label="รายละเอียด" {...bind('description')} /></label>
      </fieldset>
      <div className="mt-3"><button type="button" className="btn btn-primary" onClick={create} disabled={busy || !form.title || !form.dueDate}>สร้างงาน</button></div>
    </Card>}
  </div>
}
