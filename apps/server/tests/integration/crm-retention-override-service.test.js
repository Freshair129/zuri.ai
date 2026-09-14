import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant } from '../factories/scope'
import {
  setTenantRetentionOverride,
  getEffectiveRetentionWindowDays,
} from '@/modules/crm/retention-override-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'

// @req FR-230 — a Tenant may shorten a retention window, never lengthen it
//   (ADR-091 D2, TASK-ZAI-089 success criterion).
// @spec BR-002, SEC-031

let tenant

describe('Tenant retention override (FR-230)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Retention Override Group', code: 'PF-RETOVR' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Retention Override Tenant', code: 'TNT-RETOVR' })
  })

  it('with no override, the effective window is the installation default', async () => {
    const days = await getEffectiveRetentionWindowDays({ tenantId: tenant.id, dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS' })
    expect(days).toBe(RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS)
  })

  it('a shortening override is honoured, and audited', async () => {
    const before = await prisma.auditEvent.count()
    await setTenantRetentionOverride({ tenantId: tenant.id, dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS', windowDays: 30 })
    const days = await getEffectiveRetentionWindowDays({ tenantId: tenant.id, dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS' })
    expect(days).toBe(30)
    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: 'TENANT_RETENTION_OVERRIDE', tenantId: tenant.id },
      orderBy: { occurredAt: 'desc' },
    })
    expect(audit.action).toBe('RETENTION_OVERRIDE_SET')
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS', windowDays: 30 })
    expect(await prisma.auditEvent.count()).toBe(before + 1)
  })

  it('an attempt to lengthen past the installation default is refused, not clamped', async () => {
    await expect(
      setTenantRetentionOverride({
        tenantId: tenant.id, dataClass: 'RAW_LINE_PAYLOAD',
        windowDays: RETENTION_DEFAULT_WINDOW_DAYS.RAW_LINE_PAYLOAD + 1,
      }),
    ).rejects.toMatchObject({ status: 422 })
    const days = await getEffectiveRetentionWindowDays({ tenantId: tenant.id, dataClass: 'RAW_LINE_PAYLOAD' })
    expect(days).toBe(RETENTION_DEFAULT_WINDOW_DAYS.RAW_LINE_PAYLOAD)
  })

  it('rejects an unknown data class and an invalid window', async () => {
    await expect(
      setTenantRetentionOverride({ tenantId: tenant.id, dataClass: 'NOT_A_CLASS', windowDays: 10 }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      setTenantRetentionOverride({ tenantId: tenant.id, dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS', windowDays: 0 }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('replacing an existing override updates it in place rather than duplicating it', async () => {
    await setTenantRetentionOverride({ tenantId: tenant.id, dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS', windowDays: 20 })
    const rows = await prisma.tenantRetentionOverride.findMany({
      where: { tenantId: tenant.id, dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].windowDays).toBe(20)
  })

  it("never affects another Tenant's effective window", async () => {
    const pf2 = await createPortfolio({ name: 'Retention Override Group 2', code: 'PF-RETOVR-2' })
    const otherTenant = await createTenant({ portfolioId: pf2.id, name: 'Retention Override Tenant 2', code: 'TNT-RETOVR-2' })
    const days = await getEffectiveRetentionWindowDays({ tenantId: otherTenant.id, dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS' })
    expect(days).toBe(RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS)
  })
})
