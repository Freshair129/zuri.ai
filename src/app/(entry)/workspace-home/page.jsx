'use client'

// @req FR-066 — Workspace Home: the joined top-level Workspaces (schema
// Portfolio, ADR-027 §D2). A Workspace membership alone never mounts
// BusinessShell (AC-066.4); the continuation to Business Routing appears only
// when the server says Business access exists (AC-066.6). The owner
// continuation "create Business when needed" (ADR-027 D4) calls the existing
// FR-020/FR-074(c) one-step creator — Tenant implicit, Default Space in the
// same transaction, no Space prompt (AC-066.8..11) — never a second write path.
// @spec ADR-027 D3/D4/D8, BR-016, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Users } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader } from '@/components/ui'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { LoadingCard, api, useFetch } from '@/modules/project-manager/components/useApi'
import { onboardingPathFor } from '@/modules/identity/onboarding-steps'
import { classifyViewerFailure, SESSION_UNAVAILABLE_DETAIL_TH, SESSION_UNAVAILABLE_TITLE_TH } from '@/lib/viewer-failure'

export default function WorkspaceHomePage() {
  const router = useRouter()
  const state = useFetch('/api/onboarding/state')
  const [businessName, setBusinessName] = useState('')
  const [businessWorkspace, setBusinessWorkspace] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // @req FR-046 — SESSION_UNAVAILABLE (session store outage) is kept apart
  // from AUTH_REQUIRED (no valid session) so an outage never bounces an
  // already-logged-in person to /login (D1-entry-layers-09).
  const viewerFailure = classifyViewerFailure({ body: state.error })

  useEffect(() => {
    if (viewerFailure === 'AUTH_REQUIRED') {
      router.replace('/login')
    }
  }, [viewerFailure, router])

  // AC-066.1 — an incomplete profile is routed to Profile setup first.
  useEffect(() => {
    if (state.data && !state.data.profile.complete) {
      router.replace(onboardingPathFor('PROFILE'))
    }
  }, [state.data, router])

  if (state.loading || viewerFailure === 'AUTH_REQUIRED') return <LoadingCard />
  if (viewerFailure === 'SESSION_UNAVAILABLE') {
    return <ErrorState title={SESSION_UNAVAILABLE_TITLE_TH} detail={SESSION_UNAVAILABLE_DETAIL_TH} retry={state.reload} />
  }
  if (state.error) {
    return <ErrorState title="ไม่สามารถโหลด Workspace" detail={state.error} retry={state.reload} />
  }

  const data = state.data
  const ownedWorkspaces = data.workspaces.filter((workspace) => workspace.role === 'OWNER')

  const createBusiness = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // FR-020's one-step creator: Tenant implicit, Business, and a
      // BUSINESS-scoped Default Space in the same transaction (AC-066.8..11) —
      // the user names a Business only, never a Space (AC-066.11).
      await api('/api/scope', {
        method: 'POST',
        body: {
          entity: 'businessInGroup',
          data: {
            name: businessName.trim(),
            // Always anchored to one of the caller's own Workspaces — never the
            // server's "first portfolio" fallback, which could be someone else's.
            portfolioId: businessWorkspace || ownedWorkspaces[0]?.portfolioId,
          },
        },
      })
      router.replace('/businesses')
    } catch (err) {
      setError(`สร้างธุรกิจไม่สำเร็จ: ${err.message}`)
      setBusy(false)
    }
  }

  return (
    <BusinessRoutingShell>
      <PageHeader
        eyebrow="Workspace"
        title="Workspace ของคุณ"
        subtitle="พื้นที่ทำงานร่วมกันระดับบนสุด — สิทธิ์เข้าถึงธุรกิจยังคงต้องได้รับมอบหมายแยกต่างหาก"
      />
      {error ? <p className="mb-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
      {data.workspaces.length === 0 ? (
        <EmptyState
          title="ยังไม่ได้เข้าร่วม Workspace"
          hint="รอคำเชิญในห้องรอ หรือสร้าง Workspace ของคุณเอง"
        />
      ) : (
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {data.workspaces.map((workspace) => (
            <Card key={workspace.portfolioId} className="p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-tint)] text-[var(--brand-dark)]" aria-hidden>
                  <Users size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{workspace.name}</span>
                  <span className="mt-1 block truncate text-[11px] text-muted">
                    {workspace.code} · บทบาท {workspace.role}
                  </span>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {ownedWorkspaces.length > 0 ? (
        <Card className="mt-5 max-w-3xl p-5">
          <h2 className="text-sm font-bold">เพิ่มธุรกิจเมื่อพร้อม</h2>
          <p className="mt-1 text-xs text-muted">
            ตั้งชื่อธุรกิจอย่างเดียวพอ — ระบบจัดการองค์กรและพื้นที่งานเริ่มต้นให้เองในขั้นตอนเดียว
          </p>
          <form onSubmit={createBusiness} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="input min-w-64 flex-1"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="ชื่อธุรกิจ เช่น ร้านสมาร์ทกิฟ"
              aria-label="ชื่อธุรกิจ"
              maxLength={200}
            />
            {ownedWorkspaces.length > 1 ? (
              <select
                className="input"
                value={businessWorkspace}
                onChange={(e) => setBusinessWorkspace(e.target.value)}
                aria-label="เลือก Workspace"
              >
                <option value="">เลือก Workspace</option>
                {ownedWorkspaces.map((workspace) => (
                  <option key={workspace.portfolioId} value={workspace.portfolioId}>{workspace.name}</option>
                ))}
              </select>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !businessName.trim() || (ownedWorkspaces.length > 1 && !businessWorkspace)}
            >
              {busy ? 'กำลังสร้าง…' : 'สร้างธุรกิจ'}
            </button>
          </form>
        </Card>
      ) : null}

      <div className="mt-5 grid max-w-3xl gap-2 text-sm">
        <Link href="/waiting-room" className="font-semibold underline-offset-2 hover:underline">
          กลับไปห้องรอ / ใช้รหัสเชิญ
        </Link>
        {data.hasBusinessAccess ? (
          <Link href="/businesses" className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
            ไปที่ Business Routing <ArrowRight size={14} aria-hidden />
          </Link>
        ) : (
          <p className="text-xs text-muted">
            ยังไม่มีสิทธิ์เข้าถึงธุรกิจ — เจ้าของธุรกิจต้องมอบหมายสิทธิ์ให้คุณแยกต่างหาก
          </p>
        )}
      </div>
    </BusinessRoutingShell>
  )
}
