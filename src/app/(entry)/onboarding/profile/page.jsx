'use client'

// @req FR-066 — Profile setup (ตั้งค่าโปรไฟล์): the first user-facing step
// after a local identity/session exists, before any Business or Project
// creation prompt (AC-066.1). Completing it routes onward by the server's
// nextStep answer — Waiting Room, Workspace Home, or Business Routing.
// @spec ADR-027 D1/D8, BR-016, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, ErrorState, PageHeader } from '@/components/ui'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { LoadingCard, api, useFetch } from '@/modules/project-manager/components/useApi'
import { onboardingPathFor } from '@/modules/identity/onboarding-steps'

export default function OnboardingProfilePage() {
  const router = useRouter()
  const state = useFetch('/api/onboarding/state')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (state.error === 'AUTH_REQUIRED' || state.error === 'SESSION_UNAVAILABLE') {
      router.replace('/login')
    }
  }, [state.error, router])

  useEffect(() => {
    if (state.data?.profile) {
      setDisplayName((current) => current || state.data.profile.displayName || '')
      setEmail((current) => current || state.data.profile.email || '')
    }
  }, [state.data])

  if (state.loading || state.error === 'AUTH_REQUIRED' || state.error === 'SESSION_UNAVAILABLE') return <LoadingCard />
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
        body: { displayName, ...(email.trim() ? { email: email.trim() } : {}) },
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
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">ชื่อที่แสดง *</span>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="เช่น วรรณภา ใจดี"
              required
              maxLength={200}
            />
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
            <button type="submit" className="btn btn-primary" disabled={busy || !displayName.trim()}>
              {busy ? 'กำลังบันทึก…' : 'บันทึกโปรไฟล์'}
            </button>
          </div>
        </form>
      </Card>
    </BusinessRoutingShell>
  )
}
