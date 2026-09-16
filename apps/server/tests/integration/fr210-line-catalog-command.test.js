// @req FR-210 — the `#sku` command on the server-owned LINE worker's answer
//   port, against a real database: a verified OWNER previews, confirms and
//   gets SKUs created; the preview resolves an existing barcode first; only the
//   person who previewed may confirm or cancel; and every sender without the
//   authority — unverified, verified but no Inventory write, a group chat, a
//   non-command message — reaches the normal answer untouched.
// @spec ADR-084 D4; BR-042; SDD-091; SEC-001; FR-097
// @tested tests/integration/fr210-line-catalog-command.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { lineCatalogViewer, withLineCatalogCommand } from '@/modules/agent/line-catalog-command'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { addIdentifier } from '@/modules/inventory/application/inventory-identity-service'

const ACCOUNT = 'LINE-ACC-FR210'
let tenant, business, ownerPerson, memberPerson, strangerPerson, cups
let event = 0

async function person(code, { role = null, verified = true, lineUserId }) {
  const row = await prisma.person.create({ data: { code, displayName: code } })
  if (role) await prisma.membership.create({ data: { personId: row.id, tenantId: tenant.id, businessId: business.id, role, status: 'ACTIVE', domainKeysJson: '["inventory"]' } })
  const at = new Date()
  await prisma.channelIdentity.create({ data: {
    personId: row.id, tenantId: tenant.id, channel: 'LINE', channelAccountId: ACCOUNT, providerSubject: lineUserId,
    status: verified ? 'ACTIVE' : 'PENDING', verifiedAt: verified ? at : null, linkedAt: verified ? at : null,
  } })
  return { ...row, lineUserId }
}

const job = (sender, text, over = {}) => ({
  id: `job-${++event}`, tenantId: tenant.id, businessId: business.id, channelAccountId: ACCOUNT, eventId: `evt-${event}`,
  sourceUserId: sender.lineUserId, audienceKind: 'DIRECT', inbound: { body: text },
  account: { tenantId: tenant.id, businessId: business.id }, ...over,
})

const modelAnswers = []
const model = async (j) => { modelAnswers.push(j.inbound.body); return { text: 'MODEL_ANSWER' } }

describe('FR-210 #sku on the LINE answer port', () => {
  let answer
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-FR210', name: 'LINE intake' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR210', name: 'LINE intake tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR210', name: 'LINE intake business' })
    ownerPerson = await person('PER-FR210-OWNER', { role: 'OWNER', lineUserId: 'U-fr210-owner' })
    memberPerson = await person('PER-FR210-MEMBER', { role: 'MEMBER', lineUserId: 'U-fr210-member' })
    strangerPerson = await person('PER-FR210-STRANGER', { role: 'OWNER', verified: false, lineUserId: 'U-fr210-unverified' })
    const seed = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['projects', 'platform', 'inventory'] })
    const category = await createCategory({ businessId: business.id, code: 'FR210-CAT', nameTh: 'แก้ว', nameEn: 'Cups' }, { viewer: seed })
    cups = await createProductMaster({ businessId: business.id, code: 'FR210-CUPS', categoryId: category.id, nameTh: 'แก้ว', nameEn: 'Cups' }, { viewer: seed })
    const existing = await createProduct({ businessId: business.id, code: 'FR210-CUP-BLK', productMasterId: cups.id, name: 'แก้วดำ' }, { viewer: seed })
    await addIdentifier(existing.id, { businessId: business.id, kind: 'GTIN', value: '4006381333931' }, { viewer: seed })
    answer = withLineCatalogCommand(model)
  })

  it('AC-210.1 — only a verified sender with Inventory write authority in a direct chat is a command sender', async () => {
    expect((await lineCatalogViewer(job(ownerPerson, '#sku'))).principal.id).toBe(ownerPerson.id)
    expect(await lineCatalogViewer(job(memberPerson, '#sku'))).toBeNull()
    expect(await lineCatalogViewer(job(strangerPerson, '#sku'))).toBeNull()
    expect(await lineCatalogViewer(job(ownerPerson, '#sku', { audienceKind: 'GROUP' }))).toBeNull()
    expect(await lineCatalogViewer(job(ownerPerson, '#sku', { channelAccountId: 'LINE-ACC-OTHER' }))).toBeNull()
    expect(await lineCatalogViewer(job(ownerPerson, '#sku', { account: { tenantId: tenant.id, businessId: 'someone-else' } }))).toBeNull()
    expect(await lineCatalogViewer(job({ lineUserId: 'U-nobody' }, '#sku'))).toBeNull()
  })

  it('AC-210.2 — everyone else, and every non-command message, reaches the model untouched', async () => {
    modelAnswers.length = 0
    for (const j of [job(memberPerson, '#sku\nรหัส: X'), job(strangerPerson, '#sku'), job(ownerPerson, '#sku', { audienceKind: 'ROOM' }), job(ownerPerson, 'มีแก้วสีดำไหม')]) {
      expect(await answer(j)).toEqual({ text: 'MODEL_ANSWER' })
    }
    expect(modelAnswers).toEqual(['#sku\nรหัส: X', '#sku', '#sku', 'มีแก้วสีดำไหม'])
    expect(await prisma.inventoryCatalogIntake.count({ where: { businessId: business.id } })).toBe(0)
  })

  it('AC-210.3 — the owner previews, resolution finds the existing barcode, and a confirmation creates the rest', async () => {
    modelAnswers.length = 0
    const preview = await answer(job(ownerPerson, [
      '#sku',
      'รหัส: FR210-CUP-BLACK',
      'สินค้าหลัก: FR210-CUPS',
      'บาร์โค้ด: 4006381333931',
      'หน่วยแปลง: BOX12=12',
      '---',
      'รหัส: FR210-CUP-RED',
      'ชื่อ: แก้วแดง',
      'สินค้าหลัก: FR210-CUPS',
      'บาร์โค้ด: 036000291452',
    ].join('\n')))
    expect(modelAnswers).toEqual([])
    const intake = await prisma.inventoryCatalogIntake.findFirst({ where: { businessId: business.id, sourceChannel: 'LINE_OA' }, orderBy: { createdAt: 'desc' } })
    expect(intake).toMatchObject({ status: 'PREVIEWED', committable: true, requestedById: ownerPerson.id, sourceCorrelationId: expect.stringMatching(/^line:LINE-ACC-FR210:evt-\d+$/) })
    expect(preview.text).toContain(`ผลตรวจรายการสินค้า ${intake.code} (2 รายการ)`)
    expect(preview.text).toContain('1) FR210-CUP-BLACK — พบ SKU เดิม FR210-CUP-BLK (ตรงบาร์โค้ด/รหัสคู่ค้า) · เพิ่ม หน่วย BOX12=12')
    expect(preview.text).toContain('2) FR210-CUP-RED — สร้าง SKU ใหม่ใต้ FR210-CUPS')
    expect(preview.text).toContain(`#sku ยืนยัน ${intake.code}`)
    expect(await prisma.product.count({ where: { businessId: business.id, code: 'FR210-CUP-RED' } })).toBe(0)

    // Another authorized person cannot confirm someone else's preview.
    const secondOwner = await person('PER-FR210-OWNER-2', { role: 'OWNER', lineUserId: 'U-fr210-owner-2' })
    expect((await answer(job(secondOwner, `#sku ยืนยัน ${intake.code}`))).text).toMatch(/ไม่พบรายการนี้/)
    expect(await prisma.product.count({ where: { businessId: business.id, code: 'FR210-CUP-RED' } })).toBe(0)

    const confirmed = await answer(job(ownerPerson, `#sku ยืนยัน ${intake.code.toLowerCase()}`))
    expect(confirmed.text).toContain(`บันทึกแล้ว ${intake.code}`)
    expect(confirmed.text).toContain('สร้าง SKU ใหม่ 1 · เพิ่มข้อมูลให้ SKU เดิม 1')
    expect(await prisma.product.count({ where: { businessId: business.id, code: 'FR210-CUP-RED' } })).toBe(1)
    const black = await prisma.product.findFirst({ where: { businessId: business.id, code: 'FR210-CUP-BLK' }, select: { id: true } })
    expect(await prisma.productUnitConversion.count({ where: { productId: black.id, unit: 'BOX12', factor: 12 } })).toBe(1)
    const committed = await prisma.inventoryCatalogIntake.findUnique({ where: { id: intake.id } })
    expect(committed.status).toBe('COMMITTED')
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'INVENTORY_CATALOG_INTAKE', entityId: intake.id, action: 'INVENTORY_CATALOG_INTAKE_COMMITTED' } })
    expect(audit.actorId).toBe(ownerPerson.id)

    // Confirming again is harmless, cancelling a committed one is refused.
    expect((await answer(job(ownerPerson, `#sku ยืนยัน ${intake.code}`))).text).toContain(`บันทึกแล้ว ${intake.code}`)
    expect((await answer(job(ownerPerson, `#sku ยกเลิก ${intake.code}`))).text).toMatch(/บันทึกไปแล้ว ยกเลิกไม่ได้/)
  })

  it('AC-210.4 — help, unknown keys, an uncommittable batch and a cancellation reply without writing', async () => {
    expect((await answer(job(ownerPerson, '#sku'))).text).toContain('คำสั่งนำเข้าสินค้า (#sku)')
    const unknown = await answer(job(ownerPerson, '#sku\nรหัส: FR210-X\nราคา: 99'))
    expect(unknown.text).toContain('บรรทัด 3: "ราคา"')
    const bad = await answer(job(ownerPerson, '#sku\nรหัส: FR210-Y\nสินค้าหลัก: FR210-NOPE'))
    expect(bad.text).toContain('ข้อมูลผิด')
    expect(bad.text).toContain('ยังบันทึกไม่ได้')
    expect(bad.text).not.toContain('#sku ยืนยัน')
    const toCancel = await answer(job(ownerPerson, '#sku\nรหัส: FR210-CANCEL\nสินค้าหลัก: FR210-CUPS'))
    const code = toCancel.text.match(/CIT-[0-9A-F]{8}/)[0]
    expect((await answer(job(ownerPerson, `#sku ยกเลิก ${code}`))).text).toBe(`ยกเลิก ${code} แล้ว — ไม่มีอะไรถูกบันทึก`)
    expect((await answer(job(ownerPerson, `#sku ยืนยัน ${code}`))).text).toMatch(/ถูกยกเลิกไปแล้ว/)
    expect(await prisma.product.count({ where: { businessId: business.id, code: { in: ['FR210-X', 'FR210-Y', 'FR210-CANCEL'] } } })).toBe(0)
    expect((await answer(job(ownerPerson, '#sku ยืนยัน CIT-00000000'))).text).toMatch(/ไม่พบรายการนี้/)
  })
})
