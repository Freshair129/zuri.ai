// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-283 — native human authority applies to every private evidence read.
import { assertMarketingReadAccess, marketingNotFound } from './marketing-authority'

export async function readMarketingExternalReport({ db, viewer, businessId, reportId }) {
  const { scope } = await assertMarketingReadAccess({ db, viewer, businessId })
  const report = await db.marketingExternalReport.findFirst({ where: { id: reportId, ...scope } })
  if (!report) throw marketingNotFound()
  return report
}
