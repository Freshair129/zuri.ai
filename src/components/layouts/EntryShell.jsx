// @req FR-044, FR-056 — Landing and Login share a pre-shell surface with no operational chrome.
// @spec ADR-015, ADR-021, SDD-022, SDD-029 — EntryShell separates full landing and compact Login presentation.
// @tested tests/unit/entry-surfaces.test.js, tests/unit/fr056-landing.test.js

export default function EntryShell({ children, variant = 'compact' }) {
  if (variant === 'landing') {
    return (
      <div data-shell="entry" data-entry-variant="landing" className="min-h-screen bg-white">
        <main>{children}</main>
      </div>
    )
  }

  return (
    <div data-shell="entry" data-entry-variant="compact" className="min-h-screen bg-[var(--bg-canvas)] px-4 py-8">
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
        <section className="card w-full p-6" aria-label="Zuri entry">
          {children}
        </section>
      </main>
    </div>
  )
}
