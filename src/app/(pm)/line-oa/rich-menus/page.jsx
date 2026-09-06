'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, LayoutGrid } from 'lucide-react'
import { Card, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import {
  LINE_OA_RICH_MENU_LAYOUTS,
  LINE_OA_RICH_MENU_ACTION_TYPES,
} from '@/lib/validation/enums'
import { RICH_MENU_IMAGE_SIZES, RICH_MENU_CHAT_BAR_MAX, layoutAreas } from '@/modules/line-oa-studio/domain/line-oa-rich-menu'

// @req FR-151 — the console surface for the rich menu designer: read an
//   account's menus and their versions, author a draft, and take the three
//   actions the service actually offers (SAVE_DRAFT, FREEZE, ARCHIVE).
// @spec ADR-060 D3, D11; SEC-001 — every request carries the account or menu id
//   as a selector only; the service resolves authority from the session viewer,
//   and a menu the caller may not see answers exactly like an unknown one.
// @tested tests/unit/line-oa-rich-menu-console.test.js
//
// What this page deliberately does NOT offer, because the lane does not:
// there is no "publish to LINE" control. `applyRichMenuAction` accepts three
// actions and none of them talks to LINE, so a Publish button would be a claim
// the system cannot honour. FROZEN means "this version is settled and could be
// deployed", not "LINE has it". The page says so where an author would expect
// the button to be.

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const sizeKey = (size) => `${size.width}x${size.height}`

// The hint sits OUTSIDE the <label> on purpose. Nested inside, it joins the
// input's accessible name — "ข้อความบนแถบแชท สูงสุด 14 ตัวอักษร" — which is
// what a screen reader announces and what a by-label query has to match.
function Field({ label, hint, ...props }) {
  return <div className="grid gap-1">
    <label className="grid gap-1 text-xs font-semibold">{label}<input className={fieldClass} {...props} /></label>
    {hint && <span className="text-xs text-muted">{hint}</span>}
  </div>
}

function Select({ label, options, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<select aria-label={label} className={fieldClass} {...props}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}

/** The action of one tap area. Only the fields LINE's own object carries. */
function AreaAction({ index, action, onChange, area }) {
  const set = (patch) => onChange({ type: action.type, ...patch })
  const label = <Field label="Label (ถ้ามี)" maxLength={20} value={action.label ?? ''} onChange={e => onChange({ ...action, label: e.target.value || undefined })} />
  return <div className="grid gap-2 rounded-lg border border-[var(--border)] p-3">
    <p className="text-xs font-semibold">พื้นที่ {index + 1} <span className="font-normal text-muted">· {area.bounds.width}×{area.bounds.height} ที่ ({area.bounds.x}, {area.bounds.y})</span></p>
    <Select
      label="เมื่อผู้ใช้แตะ"
      value={action.type}
      onChange={e => set(e.target.value === 'MESSAGE' ? { text: '' } : e.target.value === 'POSTBACK' ? { data: '' } : e.target.value === 'URI' ? { uri: '' } : e.target.value === 'LIFF' ? { liffAppCode: '' } : { richMenuAlias: '', data: '' })}
      options={LINE_OA_RICH_MENU_ACTION_TYPES.map(type => ({ value: type, label: type }))}
    />
    {label}
    {action.type === 'MESSAGE' && <Field label="ข้อความที่ส่งแทนผู้ใช้" required maxLength={300} value={action.text ?? ''} onChange={e => onChange({ ...action, text: e.target.value })} />}
    {action.type === 'POSTBACK' && <>
      <Field label="Postback data" required maxLength={300} value={action.data ?? ''} onChange={e => onChange({ ...action, data: e.target.value })} />
      <Field label="ข้อความที่แสดงในห้องแชท (ถ้ามี)" maxLength={300} value={action.displayText ?? ''} onChange={e => onChange({ ...action, displayText: e.target.value || undefined })} />
    </>}
    {action.type === 'URI' && <Field label="ลิงก์" required maxLength={1000} placeholder="https://…" hint="รับเฉพาะ https:// หรือ tel:" value={action.uri ?? ''} onChange={e => onChange({ ...action, uri: e.target.value })} />}
    {action.type === 'LIFF' && <>
      <Field label="LIFF app code" required maxLength={200} value={action.liffAppCode ?? ''} onChange={e => onChange({ ...action, liffAppCode: e.target.value })} />
      <Field label="Path (ถ้ามี)" maxLength={500} value={action.path ?? ''} onChange={e => onChange({ ...action, path: e.target.value || undefined })} />
    </>}
    {action.type === 'RICHMENU_SWITCH' && <>
      <Field label="Alias ของเมนูปลายทาง" required maxLength={32} value={action.richMenuAlias ?? ''} onChange={e => onChange({ ...action, richMenuAlias: e.target.value })} />
      <Field label="Postback data" required maxLength={300} value={action.data ?? ''} onChange={e => onChange({ ...action, data: e.target.value })} />
    </>}
  </div>
}

const emptyAction = () => ({ type: 'MESSAGE', text: '' })

// A new draft starts on the first layout and the first image size the domain
// lists, so the console never carries a second opinion about what those are.
const EMPTY_DRAFT = {
  layout: LINE_OA_RICH_MENU_LAYOUTS[0],
  chatBarText: '',
  imageWidth: RICH_MENU_IMAGE_SIZES[0].width,
  imageHeight: RICH_MENU_IMAGE_SIZES[0].height,
  areas: [],
}

/** A draft body plus the grid its layout implies. Bounds come from the layout. */
function useDraft(initial) {
  const [layout, setLayout] = useState(initial.layout)
  const [size, setSize] = useState(sizeKey({ width: initial.imageWidth, height: initial.imageHeight }))
  const [chatBarText, setChatBarText] = useState(initial.chatBarText)
  const [selected, setSelected] = useState(Boolean(initial.selected))
  const [imageFileAssetId, setImageFileAssetId] = useState(initial.imageFileAssetId ?? '')
  const [actions, setActions] = useState(initial.areas?.map(area => area.action) ?? [])
  const [width, height] = size.split('x').map(Number)
  const bounds = useMemo(() => layoutAreas(layout, width, height), [layout, width, height])
  // The grid decides how many areas exist; keep one action per cell.
  useEffect(() => {
    setActions(previous => bounds.map((_, index) => previous[index] ?? emptyAction()))
  }, [bounds.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const areas = bounds.map((box, index) => ({ bounds: box, action: actions[index] ?? emptyAction() }))
  const body = { layout, chatBarText, selected, imageFileAssetId: imageFileAssetId || null, imageWidth: width, imageHeight: height, areas }
  return {
    body, areas,
    controls: <>
      <div className="grid gap-3 md:grid-cols-2">
        <Select label="Layout" value={layout} onChange={e => setLayout(e.target.value)} options={LINE_OA_RICH_MENU_LAYOUTS.map(value => ({ value, label: value }))} />
        <Select label="ขนาดภาพ" value={size} onChange={e => setSize(e.target.value)} options={RICH_MENU_IMAGE_SIZES.map(s => ({ value: sizeKey(s), label: sizeKey(s) }))} />
      </div>
      <Field label="ข้อความบนแถบแชท" required maxLength={RICH_MENU_CHAT_BAR_MAX} hint={`สูงสุด ${RICH_MENU_CHAT_BAR_MAX} ตัวอักษร`} value={chatBarText} onChange={e => setChatBarText(e.target.value)} />
      <Field label="Image FileAsset ID" value={imageFileAssetId} onChange={e => setImageFileAssetId(e.target.value)} hint="อัปโหลดภาพผ่านคลังไฟล์ก่อน แล้ววางรหัสที่นี่ — ต้องมีก่อนจึงจะ Freeze ได้" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} onChange={e => setSelected(e.target.checked)} />เปิดเมนูค้างไว้เมื่อผู้ใช้เข้าห้องแชท</label>
      <p className="text-xs text-muted">พื้นที่แตะถูกจัดเป็นตารางเท่ากันตาม layout ที่เลือก หน้านี้ยังไม่มีตัวลากปรับขอบเขตทีละช่อง</p>
      <div className="grid gap-2">{areas.map((area, index) => <AreaAction key={index} index={index} area={area} action={area.action} onChange={next => setActions(previous => previous.map((value, i) => (i === index ? next : value)))} />)}</div>
    </>,
  }
}

function Issues({ issues }) {
  if (!issues?.length) return null
  return <ul className="mt-2 grid gap-1 text-xs text-red-700">{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>· {issue.message || issue.code}</li>)}</ul>
}

function Version({ version }) {
  return <div className="border-t border-[var(--border)] py-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">v{version.versionNumber}</span>
      <StatusPill status={version.status} />
      <span className="text-muted">{version.layout} · {version.imageWidth}×{version.imageHeight} · {version.areas?.length ?? 0} พื้นที่ · แถบแชท “{version.chatBarText}”</span>
    </div>
    {version.status === 'DRAFT' && <Issues issues={version.issues} />}
    {version.frozenAt && <p className="mt-1 text-muted">Freeze เมื่อ {new Date(version.frozenAt).toLocaleString()}</p>}
  </div>
}

function Menu({ menu, onAction, busy }) {
  const latest = menu.versions?.[menu.versions.length - 1]
  const editable = latest && latest.status === 'DRAFT' && menu.status !== 'ARCHIVED'
  const [open, setOpen] = useState(false)
  const draft = useDraft(latest ?? EMPTY_DRAFT)
  const blockers = latest?.status === 'DRAFT' ? latest.issues ?? [] : []
  return <Card>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-bold">{menu.name}</h2><p className="text-xs text-muted">{menu.code}{menu.alias ? ` · alias ${menu.alias}` : ''}{menu.isDefault ? ' · ค่าเริ่มต้น' : ''}</p></div>
      <StatusPill status={menu.status} />
    </div>
    <div className="mt-3">{menu.versions?.map(version => <Version key={version.id} version={version} />)}</div>
    {menu.status !== 'ARCHIVED' && <fieldset disabled={busy} className="mt-3 grid gap-3">
      {editable && <>
        <button className="btn w-fit" type="button" onClick={() => setOpen(value => !value)}>{open ? 'ปิดตัวแก้ไข' : `แก้ไขฉบับร่าง v${latest.versionNumber}`}</button>
        {open && <div className="grid gap-3">{draft.controls}<div><button className="btn btn-primary" onClick={() => onAction(menu, { action: 'SAVE_DRAFT', draft: draft.body })}>บันทึกฉบับร่าง</button></div></div>}
      </>}
      <div className="flex flex-wrap items-center gap-2">
        {editable && <button className="btn" disabled={blockers.length > 0} onClick={() => onAction(menu, { action: 'FREEZE' })}>Freeze ฉบับร่างนี้</button>}
        <button className="btn" onClick={() => onAction(menu, { action: 'ARCHIVE' })}>เก็บเข้าคลัง</button>
      </div>
      {editable && blockers.length > 0 && <div><p className="text-xs font-semibold">Freeze ยังไม่ได้เพราะ</p><Issues issues={blockers} /></div>}
    </fieldset>}
  </Card>
}

function CreateMenu({ accountId, onCreate, busy }) {
  const draft = useDraft(EMPTY_DRAFT)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  return <Card>
    <SectionTitle>สร้างเมนูใหม่</SectionTitle>
    <form onSubmit={event => { event.preventDefault(); onCreate({ accountId, code, name, ...(alias ? { alias } : {}), draft: draft.body }) }}>
      <fieldset disabled={busy || !accountId} className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="รหัสเมนู" required minLength={3} maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="main-menu" value={code} onChange={e => setCode(e.target.value)} />
          <Field label="ชื่อเมนู" required maxLength={300} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <Field label="Alias (ถ้ามี)" maxLength={32} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="main" hint="ใช้อ้างถึงเมนูนี้จากปุ่ม RICHMENU_SWITCH ของเมนูอื่น" value={alias} onChange={e => setAlias(e.target.value)} />
        {draft.controls}
        <div><button className="btn btn-primary" type="submit">สร้างเมนูพร้อมฉบับร่างแรก</button></div>
      </fieldset>
    </form>
  </Card>
}

export default function LineOaRichMenusPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('')
  const [menus, setMenus] = useState([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadAccounts = useCallback(async () => {
    if (!business?.id) { setAccounts([]); setAccountId(''); return }
    const result = await api(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`)
    setAccounts(result.accounts ?? [])
    setAccountId(previous => (result.accounts ?? []).some(a => a.id === previous) ? previous : (result.accounts?.[0]?.id ?? ''))
  }, [business?.id])

  const loadMenus = useCallback(async () => {
    if (!accountId) { setMenus([]); return }
    const result = await api(`/api/line-oa/rich-menus?accountId=${encodeURIComponent(accountId)}${includeArchived ? '&includeArchived=true' : ''}`)
    setMenus(result.richMenus ?? [])
  }, [accountId, includeArchived])

  useEffect(() => { setError(''); setMessage(''); loadAccounts().catch(err => setError(err.message)) }, [loadAccounts])
  useEffect(() => { setError(''); loadMenus().catch(err => setError(err.message)) }, [loadMenus])

  async function run(task, note) {
    setBusy(true); setError(''); setMessage('')
    try { await task(); await loadMenus(); if (note) setMessage(note) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  const action = (menu, data) => run(() => api(`/api/line-oa/rich-menus/${menu.id}`, 'PATCH', { ...data, version: menu.version }))
  const create = (body) => run(() => api('/api/line-oa/rich-menus', 'POST', body), 'สร้างเมนูแล้ว')

  return <div>
    <PageHeader
      eyebrow="LINE OA Studio"
      title="Rich Menu"
      subtitle={business ? business.name : 'เลือก Business ก่อนจัดการเมนู'}
      actions={<button className="btn" disabled={busy || !accountId} onClick={() => run(loadMenus)}><RefreshCw size={15} />รีเฟรช</button>}
    />
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-lg bg-[var(--brand-surface)] p-3 text-sm">{message}</p>}
    {business && accounts.length === 0 && <Card className="mb-4"><LayoutGrid size={20} /><p className="mt-2 text-sm">ยังไม่มีบัญชี LINE OA สำหรับ Business นี้ — เชื่อมบัญชีที่หน้า Dashboard ก่อน</p></Card>}
    {business && accounts.length > 0 && <>
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Select label="บัญชี LINE OA" value={accountId} onChange={e => setAccountId(e.target.value)} options={accounts.map(a => ({ value: a.id, label: `${a.displayName} (${a.code})` }))} />
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} />แสดงเมนูที่เก็บเข้าคลังแล้ว</label>
        </div>
        <p className="mt-3 text-xs text-muted">Freeze คือการปิดฉบับร่างไม่ให้แก้ไขต่อ ไม่ใช่การส่งขึ้น LINE — หน้านี้ยังไม่มีการส่งเมนูไปยัง LINE เพราะระบบยังไม่มีขั้นตอนนั้น</p>
      </Card>
      <div className="mb-4 grid gap-4 xl:grid-cols-2">{menus.map(menu => <Menu key={menu.id} menu={menu} onAction={action} busy={busy} />)}</div>
      {menus.length === 0 && !error && <Card className="mb-4"><p className="text-sm">ยังไม่มีเมนูสำหรับบัญชีนี้</p></Card>}
      <CreateMenu accountId={accountId} onCreate={create} busy={busy} />
    </>}
  </div>
}
