// @req FR-210 — the `#sku` adapter in isolation: a non-command message and an
//   unauthorized sender reach the wrapped answer with their options intact; an
//   authorized command never reaches the model; the envelope carries only the
//   job's Business and a correlation built from the job; a service refusal
//   becomes a reply instead of failing the LINE job; and a confirmation from
//   anyone but the previewer is answered as "not found".
// @spec ADR-084 D4; SDD-091; BR-042
// @tested tests/unit/agent-line-catalog-command.test.js
import { describe, expect, it, vi } from 'vitest'
import { withLineCatalogCommand } from '@/modules/agent/line-catalog-command'

const job = (text, over = {}) => ({ tenantId: 't-1', businessId: 'b-1', channelAccountId: 'ACC', eventId: 'evt-9', sourceUserId: 'U-1', audienceKind: 'DIRECT', inbound: { body: text }, ...over })
const viewer = { principal: { id: 'person-1' } }
const intake = (over = {}) => ({ id: 'in-1', code: 'CIT-ABCDEF12', version: 3, planHash: 'h'.repeat(64), requestedById: 'person-1', status: 'PREVIEWED', plan: { committable: true, counts: { total: 1, create: 1, match: 0, unchanged: 0, conflict: 0, invalid: 0 }, items: [{ code: 'A', decision: 'CREATE', master: { code: 'PM' }, actions: [{ type: 'CREATE_PRODUCT' }], issues: [] }] }, ...over })

function setup({ authorized = true, inventory = {} } = {}) {
  const model = vi.fn(async () => ({ text: 'MODEL' }))
  const services = {
    previewCatalogIntake: vi.fn(async () => ({ intake: intake() })),
    commitCatalogIntake: vi.fn(async () => ({ intake: intake({ status: 'COMMITTED', result: { created: [{ code: 'A' }], matched: [], unchanged: [], mastersCreated: [] } }) })),
    findCatalogIntakeByCode: vi.fn(async () => intake()),
    applyCatalogIntakeAction: vi.fn(async () => intake({ status: 'CANCELLED' })),
    ...inventory,
  }
  const answer = withLineCatalogCommand(model, { db: {}, now: () => new Date('2026-09-13T00:00:00Z'), authorize: vi.fn(async () => (authorized ? viewer : null)), inventory: services })
  return { answer, model, services }
}

describe('FR-210 #sku adapter', () => {
  it('passes a non-command message and an unauthorized command through with their options', async () => {
    const { answer, model, services } = setup({ authorized: false })
    const options = { trace: { marker: true } }
    expect(await answer(job('สวัสดี'), options)).toEqual({ text: 'MODEL' })
    expect(await answer(job('#sku\nรหัส: A'), options)).toEqual({ text: 'MODEL' })
    expect(model).toHaveBeenCalledTimes(2)
    expect(model.mock.calls[1][1]).toBe(options)
    expect(services.previewCatalogIntake).not.toHaveBeenCalled()
  })

  it('previews an authorized command without the model, with scope only from the job', async () => {
    const { answer, model, services } = setup()
    const reply = await answer(job('#sku\nรหัส: A\nสินค้าหลัก: PM'))
    expect(model).not.toHaveBeenCalled()
    expect(reply.text).toContain('ผลตรวจรายการสินค้า CIT-ABCDEF12')
    const [envelope, options] = services.previewCatalogIntake.mock.calls[0]
    expect(envelope).toEqual({ schemaVersion: '1.0', businessId: 'b-1', source: { channel: 'LINE_OA', correlationId: 'line:ACC:evt-9' }, items: [{ ref: 'รายการ 1', sku: { code: 'A' }, master: { code: 'PM' } }] })
    expect(options).toMatchObject({ viewer, requestedById: 'person-1' })
  })

  it('confirms and cancels only the previewer\'s own intake, with the stored plan hash', async () => {
    const { answer, services } = setup()
    expect((await answer(job('#sku ยืนยัน CIT-ABCDEF12'))).text).toContain('บันทึกแล้ว CIT-ABCDEF12')
    expect(services.commitCatalogIntake.mock.calls[0][0]).toEqual({ businessId: 'b-1', intakeId: 'in-1', planHash: 'h'.repeat(64) })
    expect((await answer(job('#sku ยกเลิก CIT-ABCDEF12'))).text).toBe('ยกเลิก CIT-ABCDEF12 แล้ว — ไม่มีอะไรถูกบันทึก')
    expect(services.applyCatalogIntakeAction.mock.calls[0].slice(0, 2)).toEqual(['in-1', { action: 'CANCEL', version: 3 }])

    const other = setup({ inventory: { findCatalogIntakeByCode: vi.fn(async () => intake({ requestedById: 'person-2' })) } })
    expect((await other.answer(job('#sku ยืนยัน CIT-ABCDEF12'))).text).toMatch(/ไม่พบรายการนี้/)
    expect(other.services.commitCatalogIntake).not.toHaveBeenCalled()
  })

  it('turns a refusal into a reply instead of failing the LINE job', async () => {
    const stale = Object.assign(new Error('INVENTORY_CATALOG_INTAKE_PLAN_STALE'), { status: 409 })
    const { answer } = setup({ inventory: { commitCatalogIntake: vi.fn(async () => { throw stale }) } })
    expect((await answer(job('#sku ยืนยัน CIT-ABCDEF12'))).text).toMatch(/ตรวจใหม่/)
    const missing = setup({ inventory: { findCatalogIntakeByCode: vi.fn(async () => { throw Object.assign(new Error('Business not found'), { status: 404 }) }) } })
    expect((await missing.answer(job('#sku ยืนยัน CIT-ABCDEF12'))).text).toMatch(/ไม่พบรายการนี้/)
    const help = setup()
    expect((await help.answer(job('#sku'))).text).toContain('คำสั่งนำเข้าสินค้า')
    expect((await help.answer(job('#sku\nราคา: 1'))).text).toContain('บรรทัด 2: "ราคา"')
  })
})
