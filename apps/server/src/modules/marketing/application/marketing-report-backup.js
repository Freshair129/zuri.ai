// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-282, FR-283 — legacy JSON cannot silently omit retained machine evidence.
import { reportError } from './marketing-report-wire.js'

export const MARKETING_REPORT_TABLES = ['marketingReportPolicy', 'marketingReportBinding', 'marketingExternalReport']

export function unsupportedMarketingReportSnapshot(snapshot) {
  return MARKETING_REPORT_TABLES.some(model => [model, model[0].toUpperCase() + model.slice(1)].some(key => Object.hasOwn(snapshot?.tables || {}, key)))
    || Object.keys(snapshot || {}).some(key => /^marketingReport|^marketingExternalReport/.test(key))
}

export async function assertMarketingReportBackupSafe(db, snapshot) {
  if (unsupportedMarketingReportSnapshot(snapshot)) throw reportError(409, 'MARKETING_REPORT_LEGACY_BACKUP_UNSUPPORTED')
  for (const model of MARKETING_REPORT_TABLES) {
    if (!db?.[model]?.count) throw reportError(409, 'MARKETING_REPORT_BACKUP_VISIBILITY_UNAVAILABLE')
    if (await db[model].count() !== 0) throw reportError(409, 'MARKETING_REPORT_LEGACY_BACKUP_UNSUPPORTED')
  }
}
