'use client'

// @req FR-066 — the Waiting Room: a Profile-only member's valid resting state.
// Shows ONLY the current person's pending invitations and joined Workspaces
// (AC-066.3) — never a scope inventory — and creates zero
// Organization/Tenant/Business/Space/Project rows (AC-066.2). The owner path
// continues from here by creating a top-level Workspace (AC-066.5).
// @req FR-067 — invite acceptance: the handed-over token plus the trusted
// session become an ACTIVE WorkspaceMembership; every failure mode answers
// with one generic refusal.
// @spec ADR-027 D3/D4/D8, BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, PageHeader, ErrorState } from '@/components/ui'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { LoadingCard, api, useFetch } from '@/modules/project-manager/components/useApi'
import { onboardingPathFor } from '@/modules/identity/onboarding-steps'

export default function WaitingRoomPage() {
  const router = useRouter()
  const state = useFetch('/api/onboarding/state')
  const [token, setToken] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (state.error === 'AUTH_REQUIRED' || state.error === 'SESSION_UNAVAILABLE') {
      router.replace('/login')
    }
  }, [state.error, router])

  // AC-066.1 — Profile setup comes first: an incomplete profile is routed back.
  useEffect(() => {
    if (state.data && !state.data.profile.complete) {
      router.replace(onboardingPathFor('PROFILE'))
    }
  }, [state.data, router])

  if (state.loading || state.error === 'AUTH_REQUIRED' || state.error === 'SESSION_UNAVAILABLE') return <LoadingCard />
  if (state.error) {
    return <ErrorState title="ไม่สามารถโหลดห้องรอ" detail={state.error} retry={state.reload} />
  }

  const data = state.data
  const acceptInvite = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api('/api/workspace-invites/accept', { method: 'POST', body: { token: token.trim() } })
      setToken('')
      setNotice(`เข้าร่วม Workspace เรียบร้อยแล้ว (บทบาท: ${result.role})`)
      state.reload()
    } catch (err) {
      setError(`ใช้รหัสเชิญไม่สำเร็จ: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  const createWorkspace = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api('/api/onboarding/workspaces', { method: 'POST', body: { name: workspaceName.trim() } })
      setWorkspaceName('')
      router.replace(onboardingPathFor('WORKSPACE_HOME'))
    } catch (err) {
      setError(`สร้าง Workspace ไม่สำเร็จ: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BusinessRoutingShell>
      <PageHeader
        eyebrow="ห้องรอ"
        title="รอคำเชิญเข้าทีม"
        subtitle="โปรไฟล์ของคุณพร้อมแล้ว คุณสามารถรอคำเชิญจากเจ้าของทีม หรือสร้าง Workspace ของคุณเองได้"
      />
      {error ? <p className="mb-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm" role="status">{notice}</p> : null}

      <div className="grid max-w-3xl gap-4">
        <Card className="p-5">
          <h2 className="text-sm font-bold">คำเชิญที่รอดำเนินการ</h2>
          {data.pendingInvites.length === 0 ? (
            <p className="mt-2 text-xs text-muted">ยังไม่มีคำเชิญถึงคุณในตอนนี้</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {data.pendingInvites.map((invite) => (
                <li key={invite.id} className="text-sm">
                  <span className="font-semibold">{invite.workspaceName}</span>
                  <span className="ml-2 text-xs text-muted">บทบาท {invite.role} · หมดอายุ {new Date(invite.expiresAt).toLocaleDateString('th-TH')}</span>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={acceptInvite} className="mt-4 flex flex-wrap items-center gap-2">
            <input
              className="input min-w-64 flex-1"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="วางรหัสเชิญที่ได้รับ"
              aria-label="รหัสเชิญ"
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !token.trim()}>
              ใช้รหัสเชิญ
            </button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold">Workspace ที่คุณเข้าร่วมแล้ว</h2>
          {data.workspaces.length === 0 ? (
            <p className="mt-2 text-xs text-muted">ยังไม่ได้เข้าร่วม Workspace ใด</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {data.workspaces.map((workspace) => (
                <li key={workspace.portfolioId} className="text-sm">
                  <Link href="/workspace-home" className="font-semibold underline-offset-2 hover:underline">
                    {workspace.name}
                  </Link>
                  <span className="ml-2 text-xs text-muted">บทบาท {workspace.role}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold">สร้าง Workspace ของคุณเอง</h2>
          <p className="mt-1 text-xs text-muted">
            สำหรับเจ้าของทีม: สร้างพื้นที่ทำงานระดับบนสุดก่อน แล้วค่อยเพิ่มองค์กร ธุรกิจ และโปรเจกต์เมื่อจำเป็นเท่านั้น
          </p>
          <form onSubmit={createWorkspace} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="input min-w-64 flex-1"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="ชื่อ Workspace เช่น ทีมอีโตะกรุ๊ป"
              aria-label="ชื่อ Workspace"
              maxLength={200}
            />
            <button type="submit" className="btn" disabled={busy || !workspaceName.trim()}>
              สร้าง Workspace
            </button>
          </form>
        </Card>

        {data.hasBusinessAccess ? (
          <p className="text-sm">
            คุณมีสิทธิ์เข้าถึงธุรกิจแล้ว —{' '}
            <Link href="/businesses" className="font-semibold underline-offset-2 hover:underline">
              ไปที่ Business Routing
            </Link>
          </p>
        ) : null}
      </div>
    </BusinessRoutingShell>
  )
}
