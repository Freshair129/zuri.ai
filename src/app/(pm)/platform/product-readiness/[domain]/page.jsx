// @req FR-124 — stable domain drilldown refuses unknown implementation domains.
// @spec docs/domains/project-manager/features/FR-124-product-readiness-dashboard.md, FR-060, SEC-008
// @tested tests/unit/fr124-product-readiness-ui.test.js, tests/e2e/fr124-product-readiness.spec.js
import { notFound } from 'next/navigation'
import ProductReadinessDashboard from '@/modules/project-manager/components/ProductReadinessDashboard'
import { requireProductReadinessViewer } from '@/modules/project-manager/application/product-readiness-access'
import {
  getProductReadinessDomain,
  getProductReadinessSnapshot,
} from '@/modules/project-manager/application/product-readiness-read-model'

export default async function ProductReadinessDomainPage({ params }) {
  // Authorization first: an unknown-vs-known domain key must not be answerable
  // before the viewer is resolved, or the not-found boundary becomes an
  // enumeration oracle for anyone who can reach the route.
  await requireProductReadinessViewer()
  if (!getProductReadinessDomain(params.domain)) notFound()
  return <ProductReadinessDashboard snapshot={getProductReadinessSnapshot()} initialDomain={params.domain} />
}
