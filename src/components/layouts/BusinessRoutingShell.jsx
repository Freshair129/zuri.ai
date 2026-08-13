// @req FR-044 — Business Routing is a pre-shell surface, not the operating BusinessShell.
// @spec ADR-015, SDD-022 — only viewer-visible Business choices and ancestry labels live here.
// @tested tests/unit/business-routing-page.test.js, tests/e2e/fr044-entry-routing.spec.js

export default function BusinessRoutingShell({ children }) {
  return (
    <div data-shell="business-routing" className="min-h-screen bg-[var(--bg-canvas)] px-4 py-8">
      <main className="mx-auto w-full max-w-5xl" aria-label="Business Routing">
        {children}
      </main>
    </div>
  )
}
