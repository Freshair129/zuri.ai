import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeTransportHealth } from '@/modules/line-oa-studio/domain/transport-health-presentation'

// @req FR-190 — the console chip: what a shop owner is told, and that the
//   Studio page actually reads the transport-health endpoint.
// @spec ADR-061, SEC-009 — states only; the chip never names the other endpoint.
// @tested tests/unit/fr190-transport-health-presentation.test.js

const settings = readFileSync('src/modules/line-oa-studio/ui/LineStudioSettings.jsx', 'utf8')

const healthy = {
  monitored: true,
  silence: { state: 'OK', ageMinutes: 12 },
  endpoint: { state: 'MATCHED' },
}

describe('describeTransportHealth', () => {
  it('is quiet and green when deliveries are arriving', () => {
    expect(describeTransportHealth(healthy)).toMatchObject({ tone: 'ok', label: 'รับข้อความปกติ' })
  })

  it('puts a misrouted endpoint above any silence reading — the 2026-09-12 cause', () => {
    const misrouted = describeTransportHealth({
      ...healthy,
      silence: { state: 'OK', ageMinutes: 3 },
      endpoint: { state: 'MISMATCHED' },
    })
    expect(misrouted).toMatchObject({ tone: 'bad', label: 'LINE ส่งไปที่อื่น' })
  })

  it('names the deployment flag when the transport itself is off — the 2026-09-11 cause', () => {
    const off = describeTransportHealth({
      ...healthy,
      endpoint: { state: 'UNKNOWN', reason: 'TRANSPORT_DISABLED' },
    })
    expect(off).toMatchObject({ tone: 'bad', label: 'Server ปิดรับ LINE' })
  })

  it('reports the webhook switch being off in the console', () => {
    expect(describeTransportHealth({ ...healthy, endpoint: { state: 'DISABLED' } }))
      .toMatchObject({ tone: 'bad', label: 'ปิด webhook ใน LINE' })
  })

  it('counts silence in hours once the endpoint is known good', () => {
    expect(describeTransportHealth({ ...healthy, silence: { state: 'QUIET', ageMinutes: 448 } }))
      .toMatchObject({ tone: 'warn', label: 'เงียบ 7 ชม.' })
    expect(describeTransportHealth({ ...healthy, silence: { state: 'SILENT', ageMinutes: 1800 } }))
      .toMatchObject({ tone: 'bad', label: 'ไม่มีข้อความเข้า 30 ชม.' })
  })

  it('degrades honestly when the check itself could not run', () => {
    expect(describeTransportHealth({ ...healthy, endpoint: { state: 'UNKNOWN', reason: 'PROVIDER_429' } }))
      .toMatchObject({ tone: 'warn', label: 'ตรวจปลายทางไม่ได้', detail: expect.stringContaining('429') })
    expect(describeTransportHealth({ ...healthy, endpoint: { state: 'UNKNOWN', reason: 'CREDENTIAL_UNAVAILABLE' } }).tone).toBe('warn')
    expect(describeTransportHealth(null)).toMatchObject({ tone: 'muted', label: 'ยังไม่ได้ตรวจ' })
  })

  it('says why an account is not watched instead of calling it healthy', () => {
    expect(describeTransportHealth({ monitored: false, reason: 'PAUSED' }))
      .toMatchObject({ tone: 'muted', label: 'พักการรับข้อความอยู่' })
    expect(describeTransportHealth({ monitored: false, reason: 'NOT_SERVER_ENABLED' }).tone).toBe('muted')
  })

  it('never leaks the other endpoint or a credential into the wording', () => {
    const shown = [
      describeTransportHealth({ ...healthy, endpoint: { state: 'MISMATCHED' } }),
      describeTransportHealth({ ...healthy, endpoint: { state: 'UNKNOWN', reason: 'CREDENTIAL_UNAVAILABLE' } }),
    ].map((chip) => `${chip.label} ${chip.detail}`).join(' ')
    expect(shown).not.toMatch(/https?:\/\/|token|secret|Bearer/i)
  })
})

describe('the Studio settings page reads the endpoint', () => {
  it('calls transport-health per account and renders the chip from this module', () => {
    expect(settings).toContain('/transport-health')
    expect(settings).toContain('describeTransportHealth')
  })

  it('keeps the account list read-only — no repair button that rewrites the provider', () => {
    expect(settings).not.toMatch(/channelSecret|channelAccessToken|setWebhookEndpoint/)
  })
})
