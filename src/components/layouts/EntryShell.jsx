// @req FR-044 — Landing and Login share a pre-shell surface with no operational chrome.
// @spec ADR-015, SDD-022 — EntryShell is separate from BusinessShell and ProjectResourceShell.
// @tested tests/unit/entry-surfaces.test.js

export default function EntryShell({ children }) {
  return (
    <div data-shell="entry" className="min-h-screen bg-[var(--bg-canvas)] px-4 py-8">
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
        <section className="card w-full p-6" aria-label="Zuri entry">
          {children}
        </section>
      </main>
    </div>
  )
}
