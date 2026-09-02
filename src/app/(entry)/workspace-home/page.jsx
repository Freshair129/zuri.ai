'use client'

// @req FR-066 — Workspace Home: the joined top-level Workspaces (schema
// Portfolio, ADR-027 §D2). A Workspace membership alone never mounts
// BusinessShell (AC-066.4); the continuation to Business Routing appears only
// when the server says Business access exists (AC-066.6). The owner
// continuation "create Business when needed" (ADR-027 D4) calls the existing
// FR-020/FR-074(c) one-step creator — Tenant implicit, Default Space in the
// same transaction, no Space prompt (AC-066.8..11) — never a second write path.
// @req FR-067 — the owner half of collaboration, which had no surface anywhere
// in the product until now: mint an invite, revoke a pending one, remove a
// member. ADR-027 puts membership and invitation state on Workspace Home, so
// the panel lives here rather than on a new route. Every decision it makes —
// who sees it, what each control sends, what a destructive control confirms,
// how a refusal reads — is in workspace-collaboration-view.js, because there is
// no rendering harness to test JSX with. The minted token is shown exactly
// once: it exists in the mint response and nowhere else.
// @spec ADR-027 D3/D4/D5/D6/D8/D9, BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js
// @tested tests/unit/workspace-collaboration-view.test.js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Copy, UserMinus, Users, X } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader } from '@/components/ui'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { LoadingCard, api, useFetch } from '@/modules/project-manager/components/useApi'
import { onboardingPathFor } from '@/modules/identity/onboarding-steps'
import { classifyViewerFailure, SESSION_UNAVAILABLE_DETAIL_TH, SESSION_UNAVAILABLE_TITLE_TH } from '@/lib/viewer-failure'
import {
  DEFAULT_INVITE_ROLE,
  MINTABLE_ROLE_OPTIONS,
  MINTED_TOKEN_NOTICE_TH,
  buildMintRequest,
  buildRemoveMemberRequest,
  buildRevokeRequest,
  buildRosterView,
  confirmRemoveMemberMessage,
  confirmRevokeInviteMessage,
  describeMintResult,
  describeRefusal,
  rosterPath,
  selectAdministrableWorkspaces,
} from '@/modules/identity/workspace-collaboration-view'

const thaiDate = (value) => {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('th-TH') : '—'
}

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
  const [notice, setNotice] = useState(null)
  const [adminWorkspaceId, setAdminWorkspaceId] = useState('')
  const [inviteRole, setInviteRole] = useState(DEFAULT_INVITE_ROLE)
  const [invitedEmail, setInvitedEmail] = useState('')
  const [mintedInvite, setMintedInvite] = useState(null)

  // Derived above every early return, because the roster's useFetch below is a
  // hook and may not sit behind a conditional. `selectAdministrableWorkspaces`
  // tolerates the null read model of the first render.
  const administrable = selectAdministrableWorkspaces(state.data)
  const activeWorkspaceId = administrable.some((w) => w.portfolioId === adminWorkspaceId)
    ? adminWorkspaceId
    : administrable[0]?.portfolioId || ''
  const roster = useFetch(rosterPath(activeWorkspaceId))
  // `isSelf` comes marked on each member by the server, which is the only side
  // that knows the session principal.
  const rosterView = buildRosterView(roster.data)

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
  const activeWorkspace = administrable.find((w) => w.portfolioId === activeWorkspaceId) || null
  // The token belongs to the Workspace it was minted for; switching away drops
  // it from view rather than showing one Workspace's secret under another.
  const shownInvite = mintedInvite && mintedInvite.portfolioId === activeWorkspaceId ? mintedInvite : null

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

  const mintInvite = async (event) => {
    event.preventDefault()
    const built = buildMintRequest({ portfolioId: activeWorkspaceId, role: inviteRole, invitedEmail })
    if (built.error) {
      setError(built.error)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    setMintedInvite(null)
    try {
      const result = await api(built.request.path, { method: built.request.method, body: built.request.body })
      setMintedInvite(describeMintResult(result, {
        origin: typeof window === 'undefined' ? '' : window.location.origin,
      }))
      setInvitedEmail('')
      roster.reload()
    } catch (err) {
      setError(describeRefusal('MINT', err.message))
    } finally {
      setBusy(false)
    }
  }

  const revokeInvite = async (invite) => {
    if (!window.confirm(confirmRevokeInviteMessage(invite))) return
    const built = buildRevokeRequest(invite.id)
    if (built.error) {
      setError(built.error)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api(built.request.path, { method: built.request.method })
      if (mintedInvite?.inviteId === invite.id) setMintedInvite(null)
      setNotice('ยกเลิกคำเชิญเรียบร้อยแล้ว')
      roster.reload()
    } catch (err) {
      setError(describeRefusal('REVOKE', err.message))
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (member) => {
    if (!window.confirm(confirmRemoveMemberMessage(member))) return
    const built = buildRemoveMemberRequest({ portfolioId: activeWorkspaceId, personId: member.personId })
    if (built.error) {
      setError(built.error)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api(built.request.path, { method: built.request.method })
      setNotice(`นำ ${member.displayName} ออกจาก Workspace แล้ว`)
      roster.reload()
    } catch (err) {
      setError(describeRefusal('REMOVE', err.message))
    } finally {
      setBusy(false)
    }
  }

  const copyInviteCode = async (text) => {
    setError(null)
    try {
      await navigator.clipboard.writeText(text)
      setNotice('คัดลอกรหัสเชิญแล้ว')
    } catch {
      // Clipboard access can be refused by the browser; say so instead of
      // leaving a button that looks like it worked.
      setNotice('คัดลอกอัตโนมัติไม่สำเร็จ — เลือกข้อความในกล่องแล้วคัดลอกด้วยตนเอง')
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
      {notice ? <p className="mb-3 text-sm" role="status">{notice}</p> : null}
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

      {/* AC-067.1/2/7 — the owner controls. Rendered only for a Workspace the
          server's own read model says this person owns; the service re-checks
          on every call regardless. */}
      {administrable.length > 0 ? (
        <Card className="mt-5 max-w-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold">สมาชิกและคำเชิญ</h2>
            {administrable.length > 1 ? (
              <select
                className="input"
                value={activeWorkspaceId}
                onChange={(e) => {
                  setAdminWorkspaceId(e.target.value)
                  setMintedInvite(null)
                  setNotice(null)
                  setError(null)
                }}
                aria-label="เลือก Workspace ที่จะจัดการ"
              >
                {administrable.map((workspace) => (
                  <option key={workspace.portfolioId} value={workspace.portfolioId}>{workspace.name}</option>
                ))}
              </select>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            จัดการผู้ร่วมงานของ {activeWorkspace?.name || 'Workspace นี้'} — การเป็นสมาชิก Workspace ไม่ได้ให้สิทธิ์เข้าถึงธุรกิจโดยอัตโนมัติ
          </p>

          {roster.loading ? (
            <p className="mt-3 text-xs text-muted" role="status">กำลังโหลดรายชื่อ…</p>
          ) : roster.error ? (
            <ErrorState
              title="ไม่สามารถโหลดรายชื่อสมาชิก"
              detail={describeRefusal('LOAD', roster.error)}
              retry={roster.reload}
            />
          ) : (
            <>
              <h3 className="mt-4 text-xs font-bold text-muted">สมาชิกปัจจุบัน ({rosterView.memberCount})</h3>
              {rosterView.memberCount === 0 ? (
                <p className="mt-2 text-xs text-muted">ยังไม่มีสมาชิกใน Workspace นี้</p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {rosterView.members.map((member) => (
                    <li key={member.personId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {member.displayName}
                          {member.isSelf ? <span className="ml-2 text-[11px] text-muted">(คุณ)</span> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {member.code} · บทบาท {member.roleLabel} · เข้าร่วม {thaiDate(member.joinedAt)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn inline-flex items-center gap-1 px-2 py-1 text-xs"
                        disabled={busy || !member.canRemove}
                        title={member.removeBlockedReason || undefined}
                        aria-label={`นำ ${member.displayName} ออกจาก Workspace`}
                        onClick={() => removeMember(member)}
                      >
                        <UserMinus size={14} aria-hidden /> นำออก
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-5 text-xs font-bold text-muted">คำเชิญที่รอดำเนินการ ({rosterView.pendingCount})</h3>
              {rosterView.pendingCount === 0 ? (
                <p className="mt-2 text-xs text-muted">ยังไม่มีคำเชิญค้างอยู่</p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {rosterView.pendingInvites.map((invite) => (
                    <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{invite.audienceLabel}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          บทบาท {invite.roleLabel} ·{' '}
                          {invite.expired
                            ? <span className="text-[var(--danger)]">หมดอายุแล้ว ({thaiDate(invite.expiresAt)})</span>
                            : `หมดอายุ ${thaiDate(invite.expiresAt)}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn inline-flex items-center gap-1 px-2 py-1 text-xs"
                        disabled={busy}
                        aria-label={`ยกเลิกคำเชิญ ${invite.audienceLabel}`}
                        onClick={() => revokeInvite(invite)}
                      >
                        <X size={14} aria-hidden /> ยกเลิก
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <form onSubmit={mintInvite} className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
            <input
              className="input min-w-56 flex-1"
              type="email"
              value={invitedEmail}
              onChange={(e) => setInvitedEmail(e.target.value)}
              placeholder="อีเมลผู้รับ (ไม่บังคับ)"
              aria-label="อีเมลผู้รับคำเชิญ"
              maxLength={320}
            />
            <select
              className="input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              aria-label="บทบาทของผู้ได้รับเชิญ"
            >
              {MINTABLE_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary" disabled={busy || !activeWorkspaceId}>
              {busy ? 'กำลังดำเนินการ…' : 'ออกรหัสเชิญ'}
            </button>
          </form>

          {shownInvite ? (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--brand-tint)] p-3" role="status">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-bold">รหัสเชิญใหม่ (บทบาท {shownInvite.roleLabel})</p>
                <button
                  type="button"
                  className="btn px-2 py-1 text-[11px]"
                  aria-label="ปิดรหัสเชิญ"
                  onClick={() => setMintedInvite(null)}
                >
                  ปิด
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted">{MINTED_TOKEN_NOTICE_TH}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-[var(--surface)] px-2 py-1 text-[11px]">
                  {shownInvite.inviteToken}
                </code>
                <button
                  type="button"
                  className="btn inline-flex items-center gap-1 px-2 py-1 text-xs"
                  onClick={() => copyInviteCode(shownInvite.inviteToken)}
                >
                  <Copy size={14} aria-hidden /> คัดลอกรหัส
                </button>
                <button
                  type="button"
                  className="btn inline-flex items-center gap-1 px-2 py-1 text-xs"
                  onClick={() => copyInviteCode(shownInvite.shareText)}
                >
                  <Copy size={14} aria-hidden /> คัดลอกข้อความเชิญ
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted">
                ผู้รับนำรหัสไปกรอกที่ห้องรอ ({shownInvite.acceptUrl}) · หมดอายุ {thaiDate(shownInvite.expiresAt)}
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}

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
