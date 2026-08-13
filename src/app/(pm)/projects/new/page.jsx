'use client'

// @req FR-017 — UI wizard intake: start from objective, no template picker.
// @spec BR-003 — projects start from a goal; execution mode belongs to the workstream.
// The wizard is an envelope builder — output goes through the SAME
// validate → dry-run → confirm pipeline as agent JSON (BR-009).
// @tested tests/e2e/smoke.spec.js

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, ArrowRight, ArrowLeft } from 'lucide-react'
import { PageHeader, Card, SectionTitle, Field, EmptyState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { EXECUTION_MODES, MODE_LABELS, MODE_DEFAULT_STRATEGY } from '@/lib/validation/enums'
import { api } from '@/modules/project-manager/components/useApi'

// Plain-language framing: the user picks what kind of WORK each stream is —
// execution mode belongs to the workstream, never to the project.
const MODE_QUESTIONS = {
  SOFTWARE_SPRINT: 'พัฒนาซอฟต์แวร์ / ฟีเจอร์',
  DATA_MIGRATION: 'ย้าย/ตรวจสอบข้อมูล',
  B2B_SALES: 'ปิดดีลลูกค้าองค์กร',
  B2C_CAMPAIGN: 'แคมเปญการตลาดถึงผู้บริโภค',
  PRODUCT_LAUNCH: 'เปิดตัวสินค้า/บริการ',
  OPERATIONS: 'งานปฏิบัติการประจำ',
  BUSINESS_EXPANSION: 'ขยายธุรกิจ/เปิดสาขา',
}

const DEFAULT_ITEM_SUBTYPE = {
  SOFTWARE_SPRINT: 'TASK',
  DATA_MIGRATION: 'DATASET',
  B2B_SALES: 'DEAL',
  B2C_CAMPAIGN: 'CREATIVE',
  PRODUCT_LAUNCH: 'DELIVERABLE',
  OPERATIONS: 'CHECKLIST_ITEM',
  BUSINESS_EXPANSION: 'SETUP_ACTION',
}

function slug(name, maxLen = 18) {
  const s = String(name)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toUpperCase()
    .slice(0, maxLen)
    .replace(/-+$/g, '')
  return s || 'X'
}

export default function ProjectWizardPage() {
  const scope = useScope()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [objective, setObjective] = useState('')
  const [description, setDescription] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [targetAt, setTargetAt] = useState('')
  const [streams, setStreams] = useState([])
  const [dry, setDry] = useState(null)
  const [errors, setErrors] = useState(null)
  const [busy, setBusy] = useState(false)

  // Spaces are narrowed to the active business by the shell (FR-020); this
  // selection stays inside Development and never becomes shell context (FR-039).
  const options = scope.scopedWorkspaces
  const effectiveWorkspaceId = workspaceId || scope.selection.workspaceId || options[0]?.id || ''
  const workspace = options.find((w) => w.id === effectiveWorkspaceId)
  // In "ทุกธุรกิจ" mode the workspace choice IS the business choice — group the
  // list by business so the destination is never ambiguous.
  const workspaceGroups = scope.shell.multiBusiness && !scope.shell.activeBusinessId
    ? [
        ...scope.businesses.map((b) => ({ label: b.name, items: options.filter((w) => w.businessId === b.id) })),
        { label: 'งานระดับเครือ', items: options.filter((w) => !w.businessId) },
      ].filter((g) => g.items.length > 0)
    : null
  const destinationBusiness = workspace
    ? scope.businesses.find((b) => b.id === workspace.businessId) || null
    : null

  const addStream = () =>
    setStreams((s) => [...s, { name: '', mode: 'SOFTWARE_SPRINT', itemsText: '' }])
  const patchStream = (i, patch) =>
    setStreams((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)))
  const removeStream = (i) => setStreams((s) => s.filter((_, idx) => idx !== i))

  // Envelope builder — the wizard's entire output is this one object.
  const envelope = useMemo(() => {
    const projectSlug = slug(objective)
    const usedCodes = new Set()
    const unique = (base) => {
      let code = base
      let n = 2
      while (usedCodes.has(code)) code = `${base}-${n++}`
      usedCodes.add(code)
      return code
    }
    return {
      schemaVersion: '1.0',
      generatedBy: 'zuri-v2 UI wizard',
      scope: workspace ? { workspaceCode: workspace.code } : {},
      project: {
        code: unique(`PRJ-${projectSlug}`),
        name: objective || 'Untitled objective',
        description: description || undefined,
        type: 'GENERAL',
        status: 'PLANNED',
      },
      workstreams: streams
        .filter((st) => st.name.trim())
        .map((st) => {
          const wsCode = unique(`WST-${slug(st.name)}`)
          const items = st.itemsText
            .split('\n')
            .map((t) => t.trim())
            .filter(Boolean)
            .map((title) => ({
              code: unique(`${wsCode.replace(/^WST-/, 'WI-')}-${slug(title, 12)}`),
              subtype: DEFAULT_ITEM_SUBTYPE[st.mode],
              title,
              status: 'PLANNED',
            }))
          return {
            code: wsCode,
            name: st.name,
            executionMode: st.mode,
            progressStrategy: MODE_DEFAULT_STRATEGY[st.mode],
            progressWeight: 1,
            items,
          }
        }),
    }
  }, [objective, description, streams, workspace])

  const runDry = async () => {
    setBusy(true)
    setErrors(null)
    setDry(null)
    try {
      const result = await api('/api/import/dry-run', {
        method: 'POST',
        body: { plan: envelope, workspaceId: effectiveWorkspaceId || undefined },
      })
      if (!result.valid && !result.preview) setErrors(result.errors)
      else {
        setDry(result)
        if (!result.valid) setErrors(result.errors)
        setStep(2)
      }
    } catch (err) {
      setErrors([err.message])
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    setBusy(true)
    setErrors(null)
    try {
      const result = await api('/api/import/commit', {
        method: 'POST',
        body: { plan: envelope, workspaceId: effectiveWorkspaceId || undefined },
      })
      if (result.committed) {
        scope.refresh()
        router.push(`/projects/${result.projectId}`)
      } else {
        setErrors(result.errors)
      }
    } catch (err) {
      setErrors([err.message])
    } finally {
      setBusy(false)
    }
  }

  const stepLabels = ['เป้าหมาย', 'แตกงาน', 'พรีวิว + ยืนยัน']

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="เริ่มจากเป้าหมาย"
        title="สร้างโปรเจกต์ใหม่"
        subtitle="บอกเป้าหมาย → แตกเป็นสายงาน → พรีวิวแล้วยืนยัน ระบบเลือกมุมมองการทำงานให้อัตโนมัติ"
      />
      <nav className="mb-4 flex gap-2" aria-label="ขั้นตอน">
        {stepLabels.map((label, i) => (
          <span
            key={label}
            className={`pill ${i === step ? 'pill-active' : i < step ? 'pill-done' : 'pill-planned'}`}
            aria-current={i === step ? 'step' : undefined}
          >
            {i + 1}. {label}
          </span>
        ))}
      </nav>

      {step === 0 && (
        <Card>
          <SectionTitle caption="ไม่ต้องเลือกประเภทโปรเจกต์ — ประเภทงานอยู่ที่สายงานในขั้นถัดไป">
            เป้าหมายคืออะไร
          </SectionTitle>
          <Field label="เป้าหมาย" hint='เช่น "เปิดสาขาเชียงใหม่" หรือ "แคมเปญ 12.12"'>
            <input
              className="input"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="อยากทำอะไรให้สำเร็จ?"
              aria-label="เป้าหมายโปรเจกต์"
            />
          </Field>
          <Field label="รายละเอียด (ถ้ามี)">
            <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <Field
              label="Space"
              hint={destinationBusiness ? `ปลายทาง: ${destinationBusiness.name}` : 'ปลายทาง: งานระดับเครือ'}
            >
              <select
                className="input"
                value={effectiveWorkspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                aria-label="Space ปลายทาง"
              >
                {workspaceGroups
                  ? workspaceGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((w) => (
                          <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                        ))}
                      </optgroup>
                    ))
                  : options.map((w) => (
                      <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                    ))}
              </select>
            </Field>
            <Field label="วันเป้าหมาย (ถ้ามี)">
              <input className="input" type="date" value={targetAt} onChange={(e) => setTargetAt(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1"
              disabled={!objective.trim() || !effectiveWorkspaceId}
              onClick={() => {
                if (streams.length === 0) addStream()
                setStep(1)
              }}
            >
              ถัดไป <ArrowRight size={13} aria-hidden />
            </button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <SectionTitle caption="แต่ละสายงานเลือกลักษณะงานของตัวเอง — โปรเจกต์เดียวผสมได้หลายแบบ">
            แตกเป้าหมายเป็นสายงาน
          </SectionTitle>
          {streams.map((st, i) => (
            <div key={i} className="mb-3 rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-3">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 grid-cols-2 gap-3 max-md:grid-cols-1">
                  <Field label={`สายงานที่ ${i + 1}`}>
                    <input
                      className="input"
                      value={st.name}
                      onChange={(e) => patchStream(i, { name: e.target.value })}
                      placeholder='เช่น "หาทำเล + สัญญาเช่า"'
                      aria-label={`ชื่อสายงานที่ ${i + 1}`}
                    />
                  </Field>
                  <Field label="งานนี้เป็นงานแบบไหน">
                    <select
                      className="input"
                      value={st.mode}
                      onChange={(e) => patchStream(i, { mode: e.target.value })}
                      aria-label={`ลักษณะงานของสายงานที่ ${i + 1}`}
                    >
                      {EXECUTION_MODES.map((m) => (
                        <option key={m} value={m}>
                          {MODE_QUESTIONS[m]} ({MODE_LABELS[m]})
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button
                  type="button"
                  className="btn mt-5 px-2 py-1"
                  aria-label={`ลบสายงานที่ ${i + 1}`}
                  onClick={() => removeStream(i)}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </div>
              <Field label="งานเริ่มต้น (บรรทัดละรายการ — เว้นว่างได้)">
                <textarea
                  className="input"
                  rows={2}
                  value={st.itemsText}
                  onChange={(e) => patchStream(i, { itemsText: e.target.value })}
                  placeholder={'ดูทำเลนิมมาน\nต่อรองสัญญาเช่า'}
                />
              </Field>
            </div>
          ))}
          <button type="button" className="btn flex items-center gap-1" onClick={addStream}>
            <Plus size={12} aria-hidden /> เพิ่มสายงาน
          </button>
          <div className="mt-4 flex justify-between">
            <button type="button" className="btn flex items-center gap-1" onClick={() => setStep(0)}>
              <ArrowLeft size={13} aria-hidden /> ย้อนกลับ
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || streams.every((s) => !s.name.trim())}
              onClick={runDry}
            >
              {busy ? 'กำลังตรวจ…' : 'ตรวจสอบ + พรีวิว'}
            </button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <SectionTitle caption={`ปลายทาง: ${dry?.workspace?.code || workspace?.code || '?'} — ยังไม่มีการเขียนข้อมูลจนกว่าจะยืนยัน`}>
            พรีวิวสิ่งที่จะถูกสร้าง
          </SectionTitle>
          {errors && (
            <ul className="mb-3 space-y-1" role="alert">
              {errors.map((e, i) => (
                <li key={i} className="rounded-lg px-2 py-1 text-[10px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                  {e}
                </li>
              ))}
            </ul>
          )}
          {dry?.preview ? (
            <>
              <p className="mb-2 text-xs">
                โปรเจกต์ <b>{envelope.project.name}</b> ({envelope.project.code}) · สร้างใหม่{' '}
                <b>{dry.preview.summary.insertCount}</b> รายการ
                {dry.preview.summary.conflictCount > 0 && (
                  <span style={{ color: 'var(--danger)' }}> · ขัดแย้ง {dry.preview.summary.conflictCount}</span>
                )}
              </p>
              <ul className="mb-3 space-y-1 text-[11px]">
                {envelope.workstreams.map((ws) => (
                  <li key={ws.code} className="rounded-lg border border-[#ECEEF1] bg-[#FAFBFC] px-3 py-2">
                    <b>{ws.name}</b> — {MODE_LABELS[ws.executionMode]} · {ws.items.length} งานเริ่มต้น
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState title="ยังไม่มีพรีวิว" hint="กลับไปขั้นก่อนแล้วกดตรวจสอบอีกครั้ง" />
          )}
          <div className="flex justify-between">
            <button type="button" className="btn flex items-center gap-1" onClick={() => setStep(1)}>
              <ArrowLeft size={13} aria-hidden /> แก้ไข
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !dry?.valid}
              onClick={commit}
            >
              {busy ? 'กำลังสร้าง…' : 'ยืนยัน สร้างโปรเจกต์'}
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}
