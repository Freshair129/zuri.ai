// @req FR-044, FR-056 — Landing and Login share a pre-shell surface with no operational chrome.
// @spec ADR-015, ADR-021, SDD-022, SDD-029 — EntryShell separates full landing and compact Login presentation.
// @tested tests/unit/entry-surfaces.test.js, tests/unit/fr056-landing.test.js

export default function EntryShell({ children, variant = 'compact', backdrop = false, label = 'Zuri entry' }) {
  if (variant === 'landing') {
    return (
      <div data-shell="entry" data-entry-variant="landing" className="min-h-screen bg-white">
        <main>{children}</main>
      </div>
    )
  }

  // `backdrop` is opt-in rather than the compact default. Login is the only
  // compact consumer today, so styling the variant itself would look identical
  // — and would silently hand a login-specific treatment to whatever compact
  // surface is added next. The prop keeps the decision at the call site.
  //
  // The art is one CSS custom property so replacing it is a one-line change:
  // point `--entry-backdrop` at `url('/your-image.jpg')` and the layout below
  // is unchanged. It is drawn rather than fetched on purpose — an entry surface
  // must render before the network settles, and this one has no request to wait
  // on and nothing to lay out twice.
  return (
    <div
      data-shell="entry"
      data-entry-variant="compact"
      data-entry-backdrop={backdrop ? 'on' : undefined}
      className="relative min-h-screen bg-[var(--bg-canvas)] px-4 py-8"
    >
      {backdrop ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'var(--entry-backdrop, radial-gradient(120% 90% at 12% 0%, color-mix(in srgb, var(--action-primary) 18%, transparent) 0%, transparent 58%), radial-gradient(90% 70% at 100% 100%, color-mix(in srgb, var(--action-primary-active) 12%, transparent) 0%, transparent 62%))',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          {/* Keeps the card's contrast fixed no matter how strong the artwork
              behind it is, so swapping in a photograph cannot make the form
              hard to read. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--bg-canvas) 55%, transparent))' }}
          />
        </>
      ) : null}

      <main className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
        <section className="card w-full p-6" aria-label={label}>
          {children}
        </section>
      </main>
    </div>
  )
}
