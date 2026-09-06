'use client'

// @req FR-044 — Business Routing is a pre-shell surface, not the operating BusinessShell.
// @spec ADR-015, SDD-022 — only viewer-visible Business choices and ancestry labels live here.
// @tested tests/unit/business-routing-page.test.js, tests/e2e/fr044-entry-routing.spec.js
// @req FR-046, FR-095 — every page this shell hosts (`/businesses`,
// `/onboarding/profile`, `/waiting-room`, `/workspace-home`) is reachable only
// by a signed-in person, and a person stuck in the Waiting Room with no
// Business yet is exactly the person most likely to need sign-out. One shared
// control here covers all four rather than pasting it into each page.
// @spec ADR-017, SEC-008
// @tested tests/unit/sign-out.test.js

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { performSignOut } from '@/modules/identity/sign-out'

export default function BusinessRoutingShell({ children }) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  // @req FR-046, FR-095 — the redirect to /login always happens, whether the
  // server confirmed the revoke or not; a failed revoke is surfaced via
  // window.alert rather than swallowed (this codebase's existing convention,
  // see src/app/(pm)/platform/integrations/page.jsx).
  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      const { path, warning } = await performSignOut()
      if (warning) window.alert(warning)
      router.replace(path)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div data-shell="business-routing" className="min-h-screen bg-[var(--bg-canvas)] px-4 py-8">
      <div className="mx-auto flex w-full max-w-5xl justify-end">
        <button
          type="button"
          className="btn inline-flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-50"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="ออกจากระบบ"
        >
          <LogOut size={14} aria-hidden /> ออกจากระบบ
        </button>
      </div>
      <main className="mx-auto w-full max-w-5xl" aria-label="Business Routing">
        {children}
      </main>
    </div>
  )
}
