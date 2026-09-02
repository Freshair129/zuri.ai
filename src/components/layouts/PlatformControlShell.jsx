// @req FR-105 — Platform Control has Zuri framing but no BusinessShell chrome.
// @req FR-075 — the shell's only way back is Business Routing (`/businesses`),
// the safe destination whether or not the operator currently has a Business
// selected — never `/overview`, which assumes one (D1-journey-states-tests-docs-12).
// @spec ADR-048 D1, NFR-008
// @tested tests/unit/platform-control-route-contract.test.js

import Link from 'next/link'

export default function PlatformControlShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-canvas)]">
      <header className="nav-glass flex min-h-14 items-center border-b border-white/10 px-6 text-white max-md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--action-primary)] text-sm font-black" aria-hidden>
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
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 p-6 max-md:p-4">{children}</main>
      <footer className="border-t border-[var(--border)] bg-white px-6 py-2 text-[10px] text-[var(--text-tertiary)] max-md:px-4">
        Platform Control · read-only programme projection
      </footer>
    </div>
  )
}
