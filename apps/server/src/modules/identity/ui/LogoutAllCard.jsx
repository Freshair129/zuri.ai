'use client'

// @req FR-046, FR-095 — the authenticated Person can revoke every active session from the profile.
// @spec ADR-124 D5, SEC-018
// @tested tests/unit/logout-all-card.test.js, tests/integration/session-idle-multi-instance.test.js
import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { Card, SectionTitle } from '@/components/ui'

const LOGOUT_ALL_ERROR = 'ออกจากระบบทุกอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง'
const LOGOUT_ALL_CONFIRMATION = 'ต้องการออกจากระบบทุกอุปกรณ์หรือไม่? อุปกรณ์ทั้งหมดจะต้องเข้าสู่ระบบอีกครั้ง'

export async function logoutAllClientAction({
  fetchImpl = fetch,
  confirm = (message) => window.confirm(message),
  navigate = (path) => window.location.assign(path),
  onPending = () => {},
  onError = () => {},
} = {}) {
  if (!confirm(LOGOUT_ALL_CONFIRMATION)) return false

  onError('')
  onPending(true)
  try {
    const csrfResponse = await fetchImpl('/api/auth/csrf', { method: 'GET', cache: 'no-store' })
    if (!csrfResponse?.ok) throw new Error('CSRF_UNAVAILABLE')
    const csrf = await csrfResponse.json()
    if (typeof csrf?.token !== 'string' || !csrf.token) throw new Error('CSRF_TOKEN_MISSING')

    const response = await fetchImpl('/api/auth/logout-all', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf.token },
    })
    if (!response?.ok) throw new Error('LOGOUT_ALL_FAILED')

    navigate('/login')
    return true
  } catch {
    onError(LOGOUT_ALL_ERROR)
    return false
  } finally {
    onPending(false)
  }
}

export function LogoutAllButton({ busy, onClick }) {
  return (
    <button type="button" className="btn mt-3" onClick={onClick} disabled={busy}>
      {busy ? 'กำลังออกจากระบบ…' : 'ออกจากระบบทุกอุปกรณ์'}
    </button>
  )
}

export default function LogoutAllCard({ active = false }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function logoutEverywhere() {
    await logoutAllClientAction({
      onPending: setBusy,
      onError: setError,
    })
  }

  return (
    <Card>
      <SectionTitle caption="คุกกี้ session ที่ลงชื่อไว้สำหรับอุปกรณ์นี้">Sessions</SectionTitle>
      <div className="flex items-center gap-2 text-xs"><Monitor size={16} aria-hidden /> อุปกรณ์นี้ · {active ? 'session กำลังใช้งาน' : 'ไม่มี session ใช้งาน'}</div>
      {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800" role="alert">{error}</p> : null}
      <LogoutAllButton busy={busy} onClick={logoutEverywhere} />
    </Card>
  )
}
