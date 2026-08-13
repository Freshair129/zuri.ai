import PeopleDirectory from '@/modules/people/components/PeopleDirectory'

// @req FR-042 - HR / People is a top-level Business domain peer.
// @spec ADR-013, SITEMAP-V2-DOMAIN-NAV
// @tested tests/e2e/fr041-business-first.spec.js

export default function PeoplePage() {
  return <PeopleDirectory />
}
