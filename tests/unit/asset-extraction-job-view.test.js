// @req FR-143 — the reviewer's view of an extraction job.
// @spec ADR-059, SDD-085
// @tested tests/unit/asset-extraction-job-view.test.js
import { describe, expect, it } from 'vitest'
import {
  describeExtractionJob,
  extractRequest,
  extractionJobPath,
  isJobPending,
} from '@/modules/asset-management/application/asset-extraction-job-view'

describe('extraction job view model (FR-143)', () => {
  it('names every state in Thai, and names the device that holds the work', () => {
    expect(describeExtractionJob(null).text).toBe('ยังไม่ได้ส่งให้ Edge Device ประมวลผล')
    expect(describeExtractionJob({ status: 'QUEUED' }).text).toBe('รอ Edge Device รับงาน')
    expect(describeExtractionJob({ status: 'CLAIMED', claimedByDeviceId: 'DEV-01' }).text).toBe('Edge Device DEV-01 กำลังประมวลผล')
    expect(describeExtractionJob({ status: 'COMPLETED' }).text).toBe('เสร็จแล้ว')
    expect(describeExtractionJob({ status: 'CANCELLED' }).text).toBe('ยกเลิกแล้ว')
  })

  it('always carries the reason on a failure', () => {
    // "ล้มเหลว" with no cause is the line that sends an operator to the logs,
    // which is what a status line exists to prevent.
    expect(describeExtractionJob({ status: 'FAILED', lastError: 'OCR timed out' }).text).toBe('ล้มเหลว: OCR timed out')
    expect(describeExtractionJob({ status: 'FAILED' }).text).toBe('ล้มเหลว: ไม่ทราบสาเหตุ')
  })

  it('marks exactly the two states worth polling', () => {
    expect(isJobPending({ status: 'QUEUED' })).toBe(true)
    expect(isJobPending({ status: 'CLAIMED' })).toBe(true)
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) expect(isJobPending({ status })).toBe(false)
    expect(isJobPending(null)).toBe(false)
    expect(describeExtractionJob({ status: 'QUEUED' }).pending).toBe(true)
    expect(describeExtractionJob({ status: 'COMPLETED' }).pending).toBe(false)
  })

  it('builds requests against real routes and escapes the id', () => {
    expect(extractionJobPath('ev 1/2')).toBe('/api/assets/evidence/ev%201%2F2/extraction-job')
    expect(extractionJobPath(null)).toBeNull()
    const { path, init } = extractRequest('ev-1', 'BUS-1')
    expect(path).toBe('/api/assets/evidence/ev-1/extract')
    expect(init).toEqual({ method: 'POST', headers: { 'x-zuri-business-id': 'BUS-1' } })
  })

  it('does not invent a state for a status it does not know', () => {
    expect(describeExtractionJob({ status: 'WAT' }).text).toContain('WAT')
  })
})
