// @req FR-044, FR-056 — Landing is the Zuri-branded first entry surface with one path into Login.
// @spec ADR-015, ADR-021, SDD-022, SDD-029 — Landing remains inside EntryShell before Business Routing.
// @tested tests/unit/entry-surfaces.test.js, tests/unit/fr056-landing.test.js
import EntryShell from '@/components/layouts/EntryShell'
import ZuriLanding from '@/components/landing/ZuriLanding'

export default function LandingPage() {
  return (
    <EntryShell variant="landing">
      <ZuriLanding />
    </EntryShell>
  )
}
