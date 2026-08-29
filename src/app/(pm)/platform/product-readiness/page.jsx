// @req FR-124 — summary route for the generated product-readiness projection.
// @spec docs/domains/project-manager/features/FR-124-product-readiness-dashboard.md, FR-060, SEC-008
// @tested tests/unit/fr124-product-readiness-ui.test.js, tests/e2e/fr124-product-readiness.spec.js
import ProductReadinessDashboard from '@/modules/project-manager/components/ProductReadinessDashboard'
import { requireProductReadinessViewer } from '@/modules/project-manager/application/product-readiness-access'
import { getProductReadinessSnapshot } from '@/modules/project-manager/application/product-readiness-read-model'

export default async function ProductReadinessPage() {
  await requireProductReadinessViewer()
  return <ProductReadinessDashboard snapshot={getProductReadinessSnapshot()} />
}
