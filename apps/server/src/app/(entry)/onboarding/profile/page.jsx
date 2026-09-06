'use client'

// @req FR-066 — Profile setup (ตั้งค่าโปรไฟล์): the first user-facing step
// after a local identity/session exists, before any Business or Project
// creation prompt (AC-066.1). Completing it routes onward by the server's
// nextStep answer — Waiting Room, Workspace Home, or Business Routing.
// @req FR-122 — and what it asks for: given name, family name and telephone
// number, all required. Display name is optional in the form because the
// server composes it from the two names when it is left blank — asking for it
// as a third required field would be asking the same person for their own name
// twice. The required marks here are a courtesy; the enforcement is the
// service's, which is the half a disabled button cannot be trusted for.
// @spec ADR-027 D1/D8, BR-016, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, ErrorState, PageHeader } from '@/components/ui'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { LoadingCard, api, useFetch } from '@/modules/project-manager/components/useApi'
import { onboardingPathFor } from '@/modules/identity/onboarding-steps'
import { classifyViewerFailure, SESSION_UNAVAILABLE_DETAIL_TH, SESSION_UNAVAILABLE_TITLE_TH } from '@/lib/viewer-failure'

export default function OnboardingProfilePage() {
  const router = useRouter()
  const state = useFetch('/api/onboarding/state')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
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

  useEffect(() => {
    if (state.data?.profile) {
      setDisplayName((current) => current || state.data.profile.displayName || '')
      setEmail((current) => current || state.data.profile.email || '')
      setFirstName((current) => current || state.data.profile.firstName || '')
      setLastName((current) => current || state.data.profile.lastName || '')
      setPhone((current) => current || state.data.profile.phone || '')
    }
  }, [state.data])

  if (state.loading || viewerFailure === 'AUTH_REQUIRED') return <LoadingCard />
  if (viewerFailure === 'SESSION_UNAVAILABLE') {
    return <ErrorState title={SESSION_UNAVAILABLE_TITLE_TH} detail={SESSION_UNAVAILABLE_DETAIL_TH} retry={state.reload} />
  }
  if (state.error) {
    return <ErrorState title="ไม่สามารถโหลดข้อมูลโปรไฟล์" detail={state.error} retry={state.reload} />
  }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/api/onboarding/profile', {
        method: 'POST',
        body: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          // Omitted rather than sent empty when untouched: the contract makes it
          // optional so the server can compose it, and "" would fail min(1).
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        },
      })
      const next = await api('/api/onboarding/state')
      router.replace(onboardingPathFor(next.nextStep))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BusinessRoutingShell>
      <PageHeader
        eyebrow="เริ่มต้นใช้งาน"
        title="ตั้งค่าโปรไฟล์"
        subtitle="บอกให้เรารู้ว่าคุณคือใครก่อน — ยังไม่ต้องสร้างองค์กร ธุรกิจ หรือโปรเจกต์ใด ๆ"
      />
      <Card className="max-w-xl p-5">
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">ชื่อ *</span>
              <input
                className="input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="วรรณภา"
                autoComplete="given-name"
                required
                maxLength={100}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">นามสกุล *</span>
              <input
                className="input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="ใจดี"
                autoComplete="family-name"
                required
                maxLength={100}
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">เบอร์โทรศัพท์ *</span>
            <input
              className="input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08x-xxx-xxxx"
              autoComplete="tel"
              required
              maxLength={32}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">ชื่อที่แสดง (ไม่บังคับ)</span>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={firstName.trim() || lastName.trim() ? `${firstName.trim()} ${lastName.trim()}`.trim() : 'เช่น วรรณภา ใจดี'}
              autoComplete="nickname"
              maxLength={200}
            />
            <span className="text-xs text-muted">เว้นว่างได้ ระบบจะใช้ชื่อกับนามสกุลข้างบน</span>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">อีเมล (ไม่บังคับ)</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              maxLength={320}
            />
          </label>
          {error ? (
            <p className="text-sm text-[var(--danger,#b91c1c)]" role="alert">บันทึกไม่สำเร็จ: {error}</p>
          ) : null}
          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !firstName.trim() || !lastName.trim() || !phone.trim()}
            >
              {busy ? 'กำลังบันทึก…' : 'บันทึกโปรไฟล์'}
            </button>
          </div>
        </form>
      </Card>
    </BusinessRoutingShell>
  )
}
