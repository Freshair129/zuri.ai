import PeopleDirectory from '@/modules/people/components/PeopleDirectory'

// @req FR-042 - People Directory is a Business-scoped HR surface.
// @spec ADR-013, SITEMAP-V2-DOMAIN-NAV
// @tested tests/e2e/fr041-business-first.spec.js

export default function PeopleDirectoryPage() {
  return <PeopleDirectory directoryOnly />
}
