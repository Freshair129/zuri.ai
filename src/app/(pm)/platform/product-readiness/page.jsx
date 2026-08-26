// @req FR-094 — summary route for the generated product-readiness projection.
// @spec docs/domains/project-manager/features/FR-094-domain-feature-readiness-dashboard.md
// @tested tests/unit/product-readiness-ui.test.js, tests/e2e/product-readiness.spec.js
import ProductReadinessDashboard from '@/modules/project-manager/components/ProductReadinessDashboard'
import { getProductReadinessSnapshot } from '@/modules/project-manager/application/product-readiness-read-model'

export default function ProductReadinessPage() {
  return <ProductReadinessDashboard snapshot={getProductReadinessSnapshot()} />
}
