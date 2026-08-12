'use client'

import { useState } from 'react'
import { PageHeader, Card, SectionTitle, Field } from '@/components/ui'
import { MODE_LABELS, MODE_DEFAULT_STRATEGY } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'
import { api } from '@/modules/project-manager/components/useApi'

// @req FR-020 — the A → B transition lives here: the word "เครือ" appears for
// the first time when the owner adds a second business.
// @tested tests/e2e/smoke.spec.js, tests/integration/adaptive-shell.test.js
function AddBusinessCard({ scope }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCreated(null)
    try {
      const result = await api('/api/scope', {
        method: 'POST',
        body: { entity: 'businessInGroup', data: { name: name.trim(), code: code.trim() || undefined } },
      })
      setCreated(result)
      setName('')
      setCode('')
      await scope.refresh()
      scope.select({ businessId: result.business.id })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <SectionTitle caption="ธุรกิจใหม่จะแยกข้อมูลออกจากธุรกิจเดิมโดยอัตโนมัติ พร้อม workspace เริ่มต้นให้ 1 อัน">
        เพิ่มธุรกิจใหม่ในเครือของคุณ
      </SectionTitle>
      <form onSubmit={submit}>
        <Field label="ชื่อธุรกิจ">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น ครัวกลาง"
            aria-label="ชื่อธุรกิจใหม่"
          />
        </Field>
        <Field label="รหัสย่อ (ถ้าเว้นว่าง ระบบตั้งให้)" hint="ตัวอักษรอังกฤษ/ตัวเลข เช่น BUS-KITCHEN">
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BUS-…"
            aria-label="รหัสธุรกิจใหม่"
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'กำลังสร้าง…' : 'เพิ่มธุรกิจ'}
        </button>
      </form>
      {error && (
        <p className="mt-2 rounded-lg px-2 py-1 text-[10px]" role="alert" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      {created && (
        <p className="mt-2 text-[11px]">
          สร้าง <b>{created.business.name}</b> ({created.business.code}) แล้ว — workspace เริ่มต้น{' '}
          <b>{created.workspace.code}</b> · สลับธุรกิจได้จากมุมซ้ายบน
        </p>
      )}
    </Card>
  )
}

export default function SettingsPage() {
  const scope = useScope()
  return (
    <div>
      <PageHeader eyebrow="Settings" title="Settings" subtitle="Local demo identity, execution-mode reference, and data utilities." />
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <AddBusinessCard scope={scope} />
        <Card>
          <SectionTitle caption="MVP runs with a local demo identity — no production login">Identity</SectionTitle>
          <p className="text-xs">Signed in as <b>Local Owner</b> (demo). Memberships are seeded for TNT-001 / BUS-001.</p>
          <p className="mt-2 text-[10px] text-muted">
            Production auth, LINE, and cloud sync are intentionally out of MVP scope.
          </p>
        </Card>
        <Card>
          <SectionTitle caption="Reset and reseed the local SQLite database from the terminal">Data utilities</SectionTitle>
          <p className="mb-2 text-[11px] text-muted">Idempotent demo seed (safe to re-run):</p>
          <code className="block rounded-lg bg-[#1F2937] p-2.5 text-[10px] text-[#D9E0E8]">npm run db:seed</code>
          <p className="mb-2 mt-3 text-[11px] text-muted">Full reset (drops all local data, then reseeds):</p>
          <code className="block rounded-lg bg-[#1F2937] p-2.5 text-[10px] text-[#D9E0E8]">npm run db:reset</code>
        </Card>
        <Card>
          <SectionTitle caption="Advanced: execution mode is normally chosen per workstream at planning time">Mode → default strategy</SectionTitle>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted"><th className="py-1">Mode</th><th>Default progress strategy</th></tr>
            </thead>
            <tbody>
              {Object.entries(MODE_LABELS).map(([mode, label]) => (
                <tr key={mode} className="border-t border-[var(--border)]">
                  <td className="py-1.5 font-semibold">{label}</td>
                  <td className="text-muted">{MODE_DEFAULT_STRATEGY[mode].replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-muted">
            Manual overrides live on each workstream (edit workstream → progress strategy).
          </p>
        </Card>
        <Card>
          <SectionTitle caption="หน้าจอปรับตามจำนวนธุรกิจโดยอัตโนมัติ ไม่มีสวิตช์ให้ตั้งค่า">
            ขอบเขตข้อมูลของคุณ
          </SectionTitle>
          <ul className="space-y-1 text-[11px]">
            <li>
              {scope.businesses.length} ธุรกิจ —{' '}
              {scope.shell.multiBusiness ? 'โหมดเครือ (มี switcher + ภาพรวมทั้งเครือ)' : 'โหมดธุรกิจเดียว (ไม่มี switcher)'}
            </li>
            <li>{scope.workspaces.length} workspace</li>
            <li>{scope.projects.length} โปรเจกต์ที่ยังไม่เก็บถาวร</li>
          </ul>
          <p className="mt-2 text-[10px] text-muted">
            การแยกข้อมูลระหว่างธุรกิจทำที่หลังบ้าน ({scope.tenants.length} isolation boundary) — ไม่ต้องตั้งค่าเอง
          </p>
        </Card>
      </div>
    </div>
  )
}
