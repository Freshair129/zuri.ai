// @req FR-080, FR-146 — compatibility entry point for the consolidated hub
// @spec ADR-032, ADR-060, SDD-044
import { redirect } from 'next/navigation'

export default function LineStudioIntegrationsPage() {
  redirect('/platform/integrations')
}
