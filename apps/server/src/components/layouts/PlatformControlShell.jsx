'use client'

// @req FR-105 — Platform Control has Zuri framing but no BusinessShell chrome.
// @req FR-075 — the shell's only way back is Business Routing (`/businesses`),
// the safe destination whether or not the operator currently has a Business
// selected — never `/overview`, which assumes one (D1-journey-states-tests-docs-12).
// @spec ADR-048 D1, NFR-008
// @tested tests/unit/platform-control-route-contract.test.js
// @req FR-046, FR-095 — the operator is a signed-in person too, so this shell
// gets the same sign-out control as the Business shell rather than leaving
// the operator to wait out session expiry.
// @spec ADR-017, SEC-008
// @tested tests/unit/sign-out.test.js
//
// Theme (owner request 2026-09-13): the shell root carries `data-theme`
// ("light" | "dark"). The choice is stored per browser under
// `zai-control-theme`; with nothing stored the system preference applies. The
// first server render carries no attribute and the effect sets it on the
// client, so static markup is theme-neutral and never flashes the wrong one.
// Tokens for both themes live in platform-control-shell.module.css.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogOut, Moon, Sun } from 'lucide-react'
import { performSignOut } from '@/modules/identity/sign-out'
import styles from './platform-control-shell.module.css'

const THEME_KEY = 'zai-control-theme'

function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    return stored === 'dark' || stored === 'light' ? stored : null
  } catch {
    return null
  }
}

function systemTheme() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function PlatformControlShell({ children }) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const [theme, setTheme] = useState(null)

  useEffect(() => {
    setTheme(readStoredTheme() ?? systemTheme())
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const follow = (event) => {
      if (!readStoredTheme()) setTheme(event.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      window.localStorage.setItem(THEME_KEY, next)
    } catch {
      /* private window: the choice lives for this page only */
    }
  }

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
    <div className={`${styles.root} flex min-h-screen flex-col`} data-theme={theme ?? undefined}>
      <header className="nav-glass flex min-h-14 items-center border-b border-white/10 px-6 text-white max-md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--action-primary)] text-sm font-black text-[#1A1710]" aria-hidden>
            Z
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-white/65">Zuri</p>
            <p className="truncate text-sm font-bold">Platform Control</p>
          </div>
        </div>
        <Link href="/businesses" className="ml-auto text-xs font-semibold text-white/80 underline-offset-2 hover:underline">
          กลับสู่ Business
        </Link>
        <button
          type="button"
          className={styles.themeToggle}
          onClick={toggleTheme}
          aria-pressed={theme === 'dark'}
          aria-label={theme === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
          title="สลับโหมดมืด/สว่าง (จำค่าในเบราว์เซอร์นี้)"
        >
          {theme === 'dark' ? <Sun size={13} aria-hidden /> : <Moon size={13} aria-hidden />}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button
          type="button"
          className="ml-4 inline-flex items-center gap-1 text-xs font-semibold text-white/80 underline-offset-2 hover:underline disabled:opacity-50"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="ออกจากระบบ"
        >
          <LogOut size={13} aria-hidden /> ออกจากระบบ
        </button>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 p-6 max-md:p-4">{children}</main>
      <footer className={`${styles.footer} px-6 py-2 text-[10px] max-md:px-4`}>
        Platform Control · read-only programme projection
      </footer>
    </div>
  )
}
