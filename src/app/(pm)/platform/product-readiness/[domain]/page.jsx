// @req FR-094 — stable domain drilldown refuses unknown implementation domains.
// @spec docs/domains/project-manager/features/FR-094-domain-feature-readiness-dashboard.md
// @tested tests/unit/product-readiness-ui.test.js, tests/e2e/product-readiness.spec.js
import { notFound } from 'next/navigation'
import ProductReadinessDashboard from '@/modules/project-manager/components/ProductReadinessDashboard'
import {
  getProductReadinessDomain,
  getProductReadinessSnapshot,
} from '@/modules/project-manager/application/product-readiness-read-model'

export default function ProductReadinessDomainPage({ params }) {
  if (!getProductReadinessDomain(params.domain)) notFound()
  return <ProductReadinessDashboard snapshot={getProductReadinessSnapshot()} initialDomain={params.domain} />
}
