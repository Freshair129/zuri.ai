// @req FR-208 — the catalogue intake pipeline against a real database: a
//   preview resolves every item before planning a create and persists the plan
//   idempotently; a commit applies exactly that plan in one transaction through
//   the catalogue writers, refuses a stale, uncommittable, expired or cancelled
//   plan, rolls the whole batch back when a writer refuses, and replays once
//   committed; reads need the domain, writes need Inventory authority.
// @req FR-209 — a workbook read by the Excel converter previews through the
//   same pipeline under an `xlsx:` correlation, with row refs.
// @spec ADR-084 D1..D3; BR-009, BR-041; SEC-001; FR-072
// @tested tests/integration/fr208-inventory-catalog-intake.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import { applyProductAction, createCategory, createProduct, createProductMaster, getProduct } from '@/modules/inventory/application/inventory-catalog-service'
import { addIdentifier, listIdentifiers, listUnitConversions } from '@/modules/inventory/application/inventory-identity-service'
import {
  applyCatalogIntakeAction, commitCatalogIntake, getCatalogIntake, listCatalogIntakes, previewCatalogIntake,
} from '@/modules/inventory/application/catalog-intake-service'
import { buildCatalogTemplateWorkbook, CATALOG_WORKBOOK_COLUMNS, readCatalogWorkbook } from '@/modules/inventory/import/catalog-workbook'

const DOMAINS = ['projects', 'platform', 'inventory']
let tenant, business, other, owner, manager, member, category, cups
let seq = 0
const b = () => business.id
const envelope = (items, correlationId = `c-${++seq}`, channel = 'REST_API') => ({ schemaVersion: '1.0', businessId: b(), source: { channel, correlationId }, items })

describe('FR-208 catalogue intake pipeline', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-CIT', name: 'Catalogue intake' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CIT', name: 'Intake tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-CIT', name: 'Intake business' })
    other = await createBusiness({ tenantId: tenant.id, code: 'BUS-CIT-2', name: 'Other business' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })
    category = await createCategory({ businessId: b(), code: 'CIT-CAT', nameTh: 'เครื่องดื่ม', nameEn: 'Drinkware' }, { viewer: owner })
    cups = await createProductMaster({ businessId: b(), code: 'CIT-CUPS', categoryId: category.id, nameTh: 'แก้ว', nameEn: 'Cups' }, { viewer: owner })
  })

  it('AC-208.1 — a preview resolves before it plans a create, persists the plan, and writes no catalogue row', async () => {
    const existing = await createProduct({ businessId: b(), code: 'CIT-CUP-BLK', productMasterId: cups.id, name: 'Cup black' }, { viewer: owner })
    await addIdentifier(existing.id, { businessId: b(), kind: 'GTIN', value: '4006381333931' }, { viewer: owner })
    const productsBefore = await prisma.product.count({ where: { businessId: b() } })

    const { replayed, intake } = await previewCatalogIntake(envelope([
      { sku: { code: 'CIT-CUP-BLACK', name: 'Cup black' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'BARCODE', value: '4006381333931' }, { kind: 'SUPPLIER_CODE', value: 'CIT-ACME-1' }], unitConversions: [{ unit: 'BOX12', factor: 12 }] },
      { sku: { code: 'CIT-CUP-RED', name: 'Cup red' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'GTIN', value: '036000291452' }] },
      { sku: { code: 'CIT-JAR-1', name: 'Jar' }, master: { code: 'CIT-JARS', categoryCode: 'CIT-CAT', nameTh: 'โหล', nameEn: 'Jars', variantAxes: ['size'] }, identifiers: [] },
    ], 'ac-1'), { viewer: manager })

    expect(replayed).toBe(false)
    expect(intake).toMatchObject({ status: 'PREVIEWED', committable: false, itemCount: 3, sourceChannel: 'REST_API', sourceCorrelationId: 'ac-1' })
    expect(intake.code).toMatch(/^CIT-[0-9A-F]{8}$/)
    expect(intake.planHash).toMatch(/^[a-f0-9]{64}$/)
    expect(intake.plan.items.map((i) => i.decision)).toEqual(['MATCH', 'CREATE', 'INVALID'])
    expect(intake.plan.items[0]).toMatchObject({ matchedBy: 'IDENTIFIER', product: { id: existing.id, code: 'CIT-CUP-BLK' } })
    expect(intake.plan.items[2].issues.map((i) => i.code)).toEqual(['INVENTORY_VARIANT_AXES_INCOMPLETE'])
    expect(await prisma.product.count({ where: { businessId: b() } })).toBe(productsBefore)
    expect(await prisma.productMaster.count({ where: { businessId: b(), code: 'CIT-JARS' } })).toBe(0)
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'INVENTORY_CATALOG_INTAKE', entityId: intake.id } })
    expect(audit.action).toBe('INVENTORY_CATALOG_INTAKE_PREVIEWED')

    // Not committable: nothing is applied.
    await expect(commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: intake.planHash }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATALOG_INTAKE_NOT_COMMITTABLE', details: [{ ref: '3', decision: 'INVALID', codes: ['INVENTORY_VARIANT_AXES_INCOMPLETE'] }] })
  })

  it('AC-208.2 — a commit applies exactly the plan in one transaction: new master, new SKU, additions to the matched SKU', async () => {
    const { intake } = await previewCatalogIntake(envelope([
      { sku: { code: 'CIT-CUP-BLACK', name: 'Cup black' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'GTIN', value: '4006381333931' }, { kind: 'SUPPLIER_CODE', value: 'CIT-ACME-1', unit: 'BOX12' }], unitConversions: [{ unit: 'BOX12', factor: 12 }] },
      { sku: { code: 'CIT-CUP-RED', name: 'Cup red' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'GTIN', value: '036000291452' }], unitConversions: [{ unit: 'BOX6', factor: 6 }] },
      { sku: { code: 'CIT-JAR-S', name: 'Jar S', variant: { size: 'S' } }, master: { code: 'CIT-JARS', categoryCode: 'CIT-CAT', nameTh: 'โหล', nameEn: 'Jars', variantAxes: ['size'] } },
      { sku: { code: 'CIT-JAR-L', name: 'Jar L', variant: { size: 'L' } }, master: { code: 'CIT-JARS' } },
      { sku: { code: 'CIT-ENGRAVE' }, master: { code: 'CIT-SVC', categoryCode: 'CIT-CAT', nameTh: 'สลักชื่อ', nameEn: 'Engraving', nature: 'SERVICE' } },
    ], 'ac-2'), { viewer: manager })
    expect(intake.committable).toBe(true)
    expect(intake.plan.counts).toMatchObject({ total: 5, create: 4, match: 1, createMasters: 2 })

    await expect(commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: 'f'.repeat(64) }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATALOG_INTAKE_PLAN_STALE' })
    await expect(commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: intake.planHash }, { viewer: member })).rejects.toMatchObject({ status: 404 })

    const { intake: committed } = await commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: intake.planHash }, { viewer: manager })
    expect(committed).toMatchObject({ status: 'COMMITTED', version: intake.version + 1 })
    expect(committed.committedAt).toBeTruthy()
    expect(committed.result.created.map((r) => r.code)).toEqual(['CIT-CUP-RED', 'CIT-JAR-S', 'CIT-JAR-L', 'CIT-ENGRAVE'])
    expect(committed.result.matched).toMatchObject([{ code: 'CIT-CUP-BLACK', productCode: 'CIT-CUP-BLK', matchedBy: 'IDENTIFIER', additions: 2 }])
    expect(committed.result.mastersCreated.map((m) => m.code)).toEqual(['CIT-JARS', 'CIT-SVC'])

    const black = await prisma.product.findFirst({ where: { businessId: b(), code: 'CIT-CUP-BLK' } })
    expect(await prisma.product.count({ where: { businessId: b(), code: 'CIT-CUP-BLACK' } })).toBe(0)
    expect((await listIdentifiers(black.id, { viewer: member })).map((i) => [i.kind, i.value, i.unit])).toEqual([['GTIN', '4006381333931', null], ['SUPPLIER_CODE', 'CIT-ACME-1', 'BOX12']])
    expect((await listUnitConversions(black.id, { viewer: member })).conversions.map((c) => [c.unit, c.factor])).toEqual([['BOX12', 12]])
    const red = await prisma.product.findFirst({ where: { businessId: b(), code: 'CIT-CUP-RED' } })
    expect(await getProduct(red.id, { viewer: member })).toMatchObject({ stockPolicy: 'TRACKED', name: 'Cup red' })
    const jarL = await prisma.product.findFirst({ where: { businessId: b(), code: 'CIT-JAR-L' }, select: { variantKey: true } })
    expect(jarL.variantKey).toBe('size=l')
    expect(await prisma.product.findFirst({ where: { businessId: b(), code: 'CIT-ENGRAVE' }, select: { stockPolicy: true, safetyStock: true } })).toEqual({ stockPolicy: 'SERVICE', safetyStock: 0 })
    // Each writer kept its own audit row, and the intake has its own.
    expect(await prisma.auditEvent.count({ where: { entityType: 'PRODUCT', action: 'PRODUCT_CREATED', entityId: { in: committed.result.created.map((r) => r.productId) } } })).toBe(4)
    expect((await prisma.auditEvent.findMany({ where: { entityType: 'INVENTORY_CATALOG_INTAKE', entityId: intake.id }, orderBy: { occurredAt: 'asc' } })).map((a) => a.action)).toEqual(['INVENTORY_CATALOG_INTAKE_PREVIEWED', 'INVENTORY_CATALOG_INTAKE_COMMITTED'])

    // Replays: commit again and preview again return the committed row, write nothing.
    const again = await commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: intake.planHash }, { viewer: owner })
    expect(again).toMatchObject({ replayed: true, intake: { status: 'COMMITTED' } })
    const previewAgain = await previewCatalogIntake(envelope(JSON.parse((await prisma.inventoryCatalogIntake.findUnique({ where: { id: intake.id } })).normalizedEnvelopeJson).items, 'ac-2'), { viewer: owner })
    expect(previewAgain).toMatchObject({ replayed: true, intake: { id: intake.id, status: 'COMMITTED' } })
    await expect(previewCatalogIntake(envelope([{ sku: { code: 'CIT-DIFF' }, master: { code: 'CIT-CUPS' } }], 'ac-2'), { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATALOG_INTAKE_CORRELATION_REUSED' })

    // The same file previewed after the commit now resolves every row to what exists.
    const { intake: second } = await previewCatalogIntake(envelope(JSON.parse((await prisma.inventoryCatalogIntake.findUnique({ where: { id: intake.id } })).normalizedEnvelopeJson).items, 'ac-2-again'), { viewer: owner })
    expect(second.plan.items.map((i) => i.decision)).toEqual(['UNCHANGED', 'UNCHANGED', 'UNCHANGED', 'UNCHANGED', 'UNCHANGED'])
  })

  it('AC-208.3 — a plan that changed after the preview is refused, and a re-preview recomputes it', async () => {
    const items = [{ sku: { code: 'CIT-STALE-1', name: 'Stale' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'BARCODE', value: 'CIT-STALE-BAR' }] }]
    const { intake } = await previewCatalogIntake(envelope(items, 'ac-3'), { viewer: owner })
    expect(intake.plan.items[0].decision).toBe('CREATE')
    // Someone creates the SKU by hand in between.
    await createProduct({ businessId: b(), code: 'CIT-STALE-1', productMasterId: cups.id, name: 'Stale' }, { viewer: owner })
    await expect(commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: intake.planHash }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATALOG_INTAKE_PLAN_STALE' })
    const { replayed, intake: fresh } = await previewCatalogIntake(envelope(items, 'ac-3'), { viewer: owner })
    expect(replayed).toBe(false)
    expect(fresh).toMatchObject({ id: intake.id, version: intake.version + 1 })
    expect(fresh.plan.items[0]).toMatchObject({ decision: 'MATCH', matchedBy: 'CODE' })
    expect(fresh.planHash).not.toBe(intake.planHash)
    const { intake: done } = await commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: fresh.planHash }, { viewer: owner })
    expect(done.result.matched).toMatchObject([{ code: 'CIT-STALE-1', additions: 1 }])
  })

  it('AC-208.4 — a code taken in another Business of the Tenant after the preview makes the plan stale, and nothing is written', async () => {
    const { intake } = await previewCatalogIntake(envelope([
      { sku: { code: 'CIT-RB-1', name: 'Stale one' }, master: { code: 'CIT-CUPS' } },
      { sku: { code: 'CIT-RB-2', name: 'Stale two' }, master: { code: 'CIT-CUPS' } },
    ], 'ac-4'), { viewer: owner })
    expect(intake.committable).toBe(true)
    // Codes are unique per Tenant: the other Business taking one changes what the re-plan decides.
    const otherCategory = await prisma.inventoryCategory.create({ data: { tenantId: tenant.id, businessId: other.id, code: 'CIT-OTHER-CAT', nameTh: 'x', nameEn: 'x' } })
    const otherMaster = await prisma.productMaster.create({ data: { tenantId: tenant.id, businessId: other.id, code: 'CIT-OTHER-PM', categoryId: otherCategory.id, nameTh: 'x', nameEn: 'x' } })
    await prisma.product.create({ data: { tenantId: tenant.id, businessId: other.id, code: 'CIT-RB-2', productMasterId: otherMaster.id } })
    await expect(commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: intake.planHash }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATALOG_INTAKE_PLAN_STALE' })
    expect(await prisma.product.count({ where: { businessId: b(), code: { in: ['CIT-RB-1', 'CIT-RB-2'] } } })).toBe(0)
    expect((await prisma.inventoryCatalogIntake.findUnique({ where: { id: intake.id } })).status).toBe('PREVIEWED')
    const { intake: replanned } = await previewCatalogIntake(envelope([
      { sku: { code: 'CIT-RB-1', name: 'Stale one' }, master: { code: 'CIT-CUPS' } },
      { sku: { code: 'CIT-RB-2', name: 'Stale two' }, master: { code: 'CIT-CUPS' } },
    ], 'ac-4'), { viewer: owner })
    expect(replanned.plan.items[1].issues.map((i) => i.code)).toEqual(['INTAKE_CODE_TAKEN_IN_TENANT'])
  })

  it('AC-208.5 — expiry, cancellation, authority and reads', async () => {
    const { intake } = await previewCatalogIntake(envelope([{ sku: { code: 'CIT-EXP-1' }, master: { code: 'CIT-CUPS' } }], 'ac-5'), { viewer: owner, now: new Date('2026-01-01T00:00:00Z') })
    expect(new Date(intake.expiresAt).toISOString()).toBe('2026-01-02T00:00:00.000Z')
    await expect(commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: intake.planHash }, { viewer: owner, now: new Date('2026-01-02T00:00:01Z') })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATALOG_INTAKE_EXPIRED' })

    const line = await previewCatalogIntake(envelope([{ sku: { code: 'CIT-LINE-1' }, master: { code: 'CIT-CUPS' } }], 'line:acc:evt', 'LINE_OA'), { viewer: owner, now: new Date('2026-01-01T00:00:00Z') })
    expect(new Date(line.intake.expiresAt).toISOString()).toBe('2026-01-01T00:30:00.000Z')

    const { intake: toCancel } = await previewCatalogIntake(envelope([{ sku: { code: 'CIT-CAN-1' }, master: { code: 'CIT-CUPS' } }], 'ac-5b'), { viewer: owner })
    await expect(applyCatalogIntakeAction(toCancel.id, { action: 'CANCEL', version: toCancel.version + 5 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT' })
    const cancelled = await applyCatalogIntakeAction(toCancel.id, { action: 'CANCEL', version: toCancel.version }, { viewer: manager })
    expect(cancelled).toMatchObject({ status: 'CANCELLED' })
    await expect(commitCatalogIntake({ businessId: b(), intakeId: toCancel.id, planHash: toCancel.planHash }, { viewer: owner })).rejects.toMatchObject({ message: 'INVENTORY_CATALOG_INTAKE_CANCELLED' })

    await expect(previewCatalogIntake(envelope([{ sku: { code: 'X' }, master: { code: 'CIT-CUPS' } }]), { viewer: member })).rejects.toMatchObject({ status: 404 })
    await expect(previewCatalogIntake({ ...envelope([{}]), businessId: other.id }, { viewer: owner })).rejects.toMatchObject({ status: 404 })
    await expect(previewCatalogIntake({ schemaVersion: '2.0', businessId: b(), source: { channel: 'REST_API', correlationId: 'x' }, items: [{}] }, { viewer: owner })).rejects.toThrow()
    expect(await getCatalogIntake(intake.id, { viewer: member })).toMatchObject({ id: intake.id, plan: { counts: { total: 1 } } })
    const listed = await listCatalogIntakes({ businessId: b(), viewer: member })
    expect(listed.length).toBeGreaterThanOrEqual(5)
    expect(listed[0]).not.toHaveProperty('planJson')
    const noDomain = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: ['projects'] })
    await expect(listCatalogIntakes({ businessId: b(), viewer: noDomain })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-209.1 — a workbook previews through the same pipeline with row refs and an xlsx correlation', async () => {
    const workbook = buildCatalogTemplateWorkbook({ categories: [category], masters: [cups] })
    const sheet = workbook.getWorksheet('Products')
    const at = (key) => CATALOG_WORKBOOK_COLUMNS.findIndex(([k]) => k === key)
    const put = (rowNumber, values) => { const row = Array(CATALOG_WORKBOOK_COLUMNS.length).fill(null); for (const [k, v] of Object.entries(values)) row[at(k)] = v; sheet.getRow(rowNumber).values = row }
    put(3, { sku_code: 'CIT-XL-1', sku_name: 'Excel one', master_code: 'CIT-CUPS', barcode: 'CIT-XL-BAR' })
    put(4, { sku_code: 'CIT-CUP-RED', master_code: 'CIT-CUPS', unit_conversions: 'CTN=48' })
    put(6, { sku_code: 'CIT-XL-3', master_code: 'CIT-CUPS', safety_stock: 'many' })
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const { items, correlationId } = await readCatalogWorkbook(buffer)
    const { intake } = await previewCatalogIntake(envelope(items, correlationId, 'EXCEL'), { viewer: owner })
    expect(intake.sourceChannel).toBe('EXCEL')
    expect(intake.plan.items.map((i) => [i.ref, i.decision])).toEqual([['แถว 3', 'CREATE'], ['แถว 4', 'MATCH'], ['แถว 6', 'INVALID']])
    expect(intake.plan.items[2].issues.map((i) => i.path)).toEqual(['sku.safetyStock'])
    // The same bytes preview idempotently.
    const again = await previewCatalogIntake(envelope((await readCatalogWorkbook(buffer)).items, correlationId, 'EXCEL'), { viewer: owner })
    expect(again.intake.id).toBe(intake.id)
  })

  it('AC-208.6 — the intake matches a merged duplicate\'s code to its survivor', async () => {
    const keep = await createProduct({ businessId: b(), code: 'CIT-KEEP', productMasterId: cups.id, name: 'Keeper' }, { viewer: owner })
    const dup = await createProduct({ businessId: b(), code: 'CIT-DUP', productMasterId: cups.id, name: 'Dup' }, { viewer: owner })
    await applyProductAction(dup.id, { action: 'MERGE', version: 1, into: keep.id }, { viewer: owner })
    const { intake } = await previewCatalogIntake(envelope([{ sku: { code: 'CIT-DUP' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'BARCODE', value: 'CIT-MERGED-BAR' }] }], 'ac-6'), { viewer: owner })
    expect(intake.plan.items[0]).toMatchObject({ decision: 'MATCH', product: { id: keep.id, code: 'CIT-KEEP' } })
    expect(intake.plan.items[0].warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['INTAKE_REDIRECTED_FROM_MERGED']))
    await commitCatalogIntake({ businessId: b(), intakeId: intake.id, planHash: intake.planHash }, { viewer: owner })
    expect((await listIdentifiers(keep.id, { viewer: member })).map((i) => i.value)).toContain('CIT-MERGED-BAR')
  })
})
