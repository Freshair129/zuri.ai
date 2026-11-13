import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEffectiveRetentionWindow } from '@/modules/crm/retention-override-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'

// @req FR-230 — the shared retention override read enforces a safe lower bound.
// @spec BR-002, SEC-031, ADR-091 D2
// @tested tests/unit/retention-override-resolver.test.js

const DATA_CLASS = 'RAW_LINE_PAYLOAD'
const TENANT_ID = 'tenant-safe-window'

function dbFor(windowDays) {
  return { tenantRetentionOverride: { findUnique: vi.fn().mockResolvedValue(
    windowDays === undefined ? null : { tenantId: TENANT_ID, dataClass: DATA_CLASS, windowDays },
  ) } }
}

afterEach(() => vi.restoreAllMocks())

describe('resolveEffectiveRetentionWindow', () => {
  it('returns the installation default when there is no override', async () => {
    const db = dbFor(undefined)
    await expect(resolveEffectiveRetentionWindow({ tenantId: TENANT_ID, dataClass: DATA_CLASS, db }))
      .resolves.toEqual({ windowDays: RETENTION_DEFAULT_WINDOW_DAYS[DATA_CLASS], source: 'DEFAULT' })
    expect(db.tenantRetentionOverride.findUnique).toHaveBeenCalledWith({
      where: { tenantId_dataClass: { tenantId: TENANT_ID, dataClass: DATA_CLASS } },
    })
  })

  it('uses a valid shortening override and labels its source', async () => {
    await expect(resolveEffectiveRetentionWindow({ tenantId: TENANT_ID, dataClass: DATA_CLASS, db: dbFor(30) }))
      .resolves.toEqual({ windowDays: 30, source: 'OVERRIDE' })
  })

  it('clamps a valid longer stored value to the installation default', async () => {
    await expect(resolveEffectiveRetentionWindow({ tenantId: TENANT_ID, dataClass: DATA_CLASS, db: dbFor(180) }))
      .resolves.toEqual({ windowDays: RETENTION_DEFAULT_WINDOW_DAYS[DATA_CLASS], source: 'OVERRIDE' })
  })

  it.each([0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('ignores unsafe override %s and writes one structured error line', async windowDays => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(resolveEffectiveRetentionWindow({ tenantId: TENANT_ID, dataClass: DATA_CLASS, db: dbFor(windowDays) }))
      .resolves.toEqual({ windowDays: RETENTION_DEFAULT_WINDOW_DAYS[DATA_CLASS], source: 'DEFAULT_INVALID_OVERRIDE' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      scope: 'retention-override-service',
      tenantId: TENANT_ID,
      dataClass: DATA_CLASS,
      code: 'RETENTION_OVERRIDE_INVALID',
    })
    expect(log.mock.calls[0][0]).not.toContain('payload')
  })

  it('uses the default without querying when no Tenant is supplied', async () => {
    const db = dbFor(30)
    await expect(resolveEffectiveRetentionWindow({ dataClass: DATA_CLASS, db }))
      .resolves.toEqual({ windowDays: RETENTION_DEFAULT_WINDOW_DAYS[DATA_CLASS], source: 'DEFAULT' })
    expect(db.tenantRetentionOverride.findUnique).not.toHaveBeenCalled()
  })

  it.each(['UNKNOWN', 'toString', '__proto__'])('rejects an unknown data class (%s)', async dataClass => {
    await expect(resolveEffectiveRetentionWindow({ tenantId: TENANT_ID, dataClass, db: dbFor(30) }))
      .rejects.toMatchObject({ status: 400, message: 'UNKNOWN_RETENTION_DATA_CLASS' })
  })
})
