// @req FR-282 — Go-produced golden bytes and adversarial nested wire inputs.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseMarketingReport, canonicalReportText, reportHash, reportCredentialHash, readMarketingReportRequest } from '@/modules/marketing/application/marketing-report-wire'

const bytes = readFileSync(new URL('../fixtures/marketing-report/go-v01.json', import.meta.url))
const original = JSON.parse(bytes)
const encode = value => { const { payloadHash, ...content } = value; return canonicalReportText({ ...content, payloadHash: reportHash(content) }) }

describe('reported Marketing wire', () => {
  test('accepts exact immutable Go bytes while retaining UNKNOWN, null and reported-only provenance', () => {
    const result = parseMarketingReport(bytes)
    expect(result.canonicalEnvelope).toBe(bytes.toString('utf8'))
    expect(result.envelope.sourceRevision).toEqual(original.sourceRevision)
    expect(result.envelope.payload.measurements).toHaveLength(12)
    expect(result.envelope.payload.measurements.every(metric => metric.value === null && metric.quality === 'UNKNOWN')).toBe(true)
  })
  test('rejects malformed Unicode, duplicate escaped keys, byte limit and noncanonical representations', () => {
    for (const bad of [Buffer.from([0xc3, 0x28]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]), bytes.toString() + '\n', bytes.toString().replace('"reportId":', '"report\\u0049d":"other","reportId":'), bytes.toString().replace('"sourceCampaignId":', '"sourceCampaignId":"\\ud800","sourceCampaignId":'), Buffer.alloc(262145)]) expect(() => parseMarketingReport(bad)).toThrow()
  })
  test('hash-valid forged fields, authority, decimal, scope, reference, versions and quality refuse', () => {
    for (const mutate of [
      r => { r.actor = 'OWNER' }, r => { r.reportRevision = 2 }, r => { r.supersedesReportId = r.reportId },
      r => { r.reportId = [r.reportId] }, r => { r.source.credential = 'private' }, r => { r.window.timezone = 'arbitrary' },
      r => { r.window.start = '2026-02-30' }, r => { r.frozenAt = '2099-10-05T00:00:00Z' },
      r => { r.sourceRevision.stateRowVersion = 1 }, r => { r.payload.context.targets.low = '1e4' },
      r => { r.payload.context.targets.low = '01' }, r => { r.payload.context.targets.low = '-0' },
      r => { r.payload.measurements[0].provenance.sourceRefIds = ['not-existing'] },
      r => { r.payload.measurements[0].provenance.person = 'private' },
      r => { r.payload.measurements[0].value = '99' }, r => { r.payload.measurements[0].unit = 'ratio' },
      r => { r.payload.measurements.find(metric => metric.key === 'reported_spend').key = ['reported_spend'] },
      r => { r.payload.measurements.reverse() }, r => { r.payload.sourceReferences.push(r.payload.sourceReferences[0]) },
      r => { r.payload.measurements[0].reasonCodes = ['FREE TEXT'] },
      r => { r.payload.weeklyReviewAssertion = { approvalTrust: 'APPROVED' } },
    ]) {
      const value = structuredClone(original); mutate(value); expect(() => parseMarketingReport(encode(value))).toThrow()
    }
    expect(() => parseMarketingReport(canonicalReportText({ ...original, payloadHash: 'a'.repeat(64) }))).toThrow()
    const value = structuredClone(original)
    const review = { sourceReviewId: 'synthetic-review', recordedDate: '2026-09-22', settingsVersion: 1, reportedGateStatus: ['ON_TRACK'], findingCodes: [], recommendationCodes: [], provenance: 'LEGACY_REPORTED', approvalTrust: 'UNVERIFIED' }
    value.payload.weeklyReviewAssertion = { ...review, sanitizedSnapshotHash: reportHash(review) }
    expect(() => parseMarketingReport(encode(value))).toThrow()
  })
  test('only bounded report bearer is admitted; session/Enterprise tokens cannot substitute', async () => {
    const credential = 'zmr_' + 'a'.repeat(43)
    expect(reportCredentialHash('Bearer ' + credential)).toMatch(/^[a-f0-9]{64}$/)
    for (const value of [null, 'Bearer enterprise-key', 'Basic ' + credential, 'Bearer ' + credential + ', Bearer other', 'Bearer ' + credential + '\n']) expect(() => reportCredentialHash(value)).toThrow()
    const request = (body, headers = {}) => new Request('https://receiver.invalid/api/growth/external-marketing-reports', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } })
    expect((await readMarketingReportRequest(request(bytes))).canonicalEnvelope).toBe(bytes.toString())
    await expect(readMarketingReportRequest(request(bytes, { 'Content-Type': 'text/plain' }))).rejects.toMatchObject({ status: 415 })
    await expect(readMarketingReportRequest(request(bytes, { 'Content-Encoding': 'gzip' }))).rejects.toMatchObject({ status: 415 })
    await expect(readMarketingReportRequest(request(Buffer.alloc(262145)))).rejects.toMatchObject({ status: 413 })
  })
  test('known reported CTR/CPL retain decimal arithmetic without inventing a CTR subset bound', () => {
    const known = (key, numerator, denominator, scalar) => {
      const value = structuredClone(original), metric = value.payload.measurements.find(item => item.key === key)
      metric.value = scalar; metric.quality = 'KNOWN'; metric.reasonCodes = []
      metric.provenance = { ...metric.provenance, collectionKnownAt: value.frozenAt, sourceTimezone: metric.scope.timezone, timezoneState: 'ATTESTED' }
      metric.ratio.numerator = numerator; metric.ratio.denominator = denominator
      return value
    }
    for (const value of [known('reported_ctr', '1', '2', '0.5'), known('reported_ctr', '2', '1', '2'), known('reported_cpl', '7', '2', '3.5'), known('reported_ctr', '1', '3', '0.33333333')]) expect(parseMarketingReport(encode(value)).envelope.payload.measurements).toHaveLength(12)
    for (const value of [known('reported_ctr', '1', '2', '0.8'), known('reported_ctr', '1', '0', '0'), known('reported_cpl', '7', '2', '3.6')]) expect(() => parseMarketingReport(encode(value))).toThrow()
  })
})
