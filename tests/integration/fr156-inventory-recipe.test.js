// @req FR-156 — recipes (bills of materials at a batch size) against a real
//   database: identity and same-Business rules, explosion to a quantity with
//   shortages and the maximum buildable quantity from the ledger, versioned
//   actions, and the atomic build that issues components FEFO and receives
//   the output — or nothing.
// @spec BR-002; SEC-001; FR-072
// @tested tests/integration/fr156-inventory-recipe.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { listLots, recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { applyRecipeAction, buildRecipe, createRecipe, getRecipe, listRecipes } from '@/modules/inventory/application/inventory-recipe-service'
import { pickRecipeForQuantity } from '@/modules/inventory/domain/inventory'

const DOMAINS = ['projects', 'platform', 'inventory']
let tenant, business, otherBusiness, owner, manager, member, master, box, ribbon, tea, card, crate, gadget, blend, foreignProduct, recipe10
const b = () => business.id

describe('FR-156 Inventory recipes (bill of materials)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-INV-RCP', name: 'Recipe Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-INV-RCP', name: 'Recipe Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-INV-RCP', name: 'Gift Box Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-INV-RCP-2', name: 'Other' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    const foreignOwner = makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: DOMAINS })
    const category = await createCategory({ businessId: b(), code: 'executive', nameTh: 'ผู้บริหาร', nameEn: 'Executive' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-GIFT', categoryId: category.id, nameTh: 'ชุดของขวัญ', nameEn: 'Gift set' }, { viewer: owner })
    const sku = (code, over = {}) => createProduct({ businessId: b(), code, productMasterId: master.id, name: code, ...over }, { viewer: owner })
    box = await sku('BOX-EXEC')
    ribbon = await sku('RIBBON', { unit: 'm' })
    tea = await sku('TEA-LEAF', { trackingMode: 'LOT', unit: 'g' })
    card = await sku('CARD-PRINT', { stockPolicy: 'UNTRACKED' })
    crate = await sku('CRATE')
    gadget = await sku('GADGET', { trackingMode: 'SERIAL' })
    blend = await sku('TEA-BLEND', { trackingMode: 'LOT', unit: 'g' })
    const foreignCategory = await createCategory({ businessId: otherBusiness.id, code: 'other', nameTh: 'อื่น', nameEn: 'Other' }, { viewer: foreignOwner })
    const foreignMaster = await createProductMaster({ businessId: otherBusiness.id, code: 'PM-OTHER', categoryId: foreignCategory.id, nameTh: 'x', nameEn: 'x' }, { viewer: foreignOwner })
    foreignProduct = await createProduct({ businessId: otherBusiness.id, code: 'OTHER-SKU', productMasterId: foreignMaster.id }, { viewer: foreignOwner })
  })

  it('AC-156.1 — a recipe belongs to one output SKU at one batch size, with same-Business components that are not itself', async () => {
    const lines = [
      { componentProductId: ribbon.id, qty: 5, unit: 'm' },
      { componentProductId: tea.id, qty: 200, unit: 'g' },
      { componentProductId: card.id, qty: 10 },
      { componentProductId: crate.id, qty: 1, fixed: true, note: 'one shipping crate per batch' },
    ]
    recipe10 = await createRecipe({ businessId: b(), code: 'RCP-BOX-10', productId: box.id, name: 'Executive box × 10', batchSize: 10, lines }, { viewer: manager })
    expect(recipe10).toMatchObject({ code: 'RCP-BOX-10', productId: box.id, batchSize: 10, yieldQty: 10, unit: 'EA', status: 'ACTIVE', version: 1 })
    expect(recipe10.lines).toHaveLength(4)
    expect(recipe10.lines.find((l) => l.componentProductId === crate.id)).toMatchObject({ fixed: true, qty: 1 })

    await expect(createRecipe({ businessId: b(), code: 'RCP-BOX-10', productId: box.id, name: 'dup', batchSize: 50, lines }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_RECIPE_CODE_TAKEN' })
    await expect(createRecipe({ businessId: b(), code: 'RCP-BOX-10B', productId: box.id, name: 'dup batch', batchSize: 10, lines }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_RECIPE_BATCH_TAKEN' })
    await expect(createRecipe({ businessId: b(), code: 'RCP-SELF', productId: box.id, name: 'self', batchSize: 1, lines: [{ componentProductId: box.id, qty: 1 }] }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PRODUCT_RECIPE_SELF_REFERENCE' })
    await expect(createRecipe({ businessId: b(), code: 'RCP-FOREIGN', productId: box.id, name: 'foreign', batchSize: 1, lines: [{ componentProductId: foreignProduct.id, qty: 1 }] }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PRODUCT_NOT_FOUND' })
    await expect(createRecipe({ businessId: b(), code: 'RCP-MEMBER', productId: box.id, name: 'x', batchSize: 1, lines }, { viewer: member })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PRODUCT_RECIPE', entityId: recipe10.id } })
    expect(audits.map((a) => a.action)).toEqual(['PRODUCT_RECIPE_CREATED'])
  })

  it('AC-156.2 — the recipe for a quantity is the largest batch size that fits; explosion scales every line but a fixed one and reports shortages against the ledger', async () => {
    const recipe50 = await createRecipe({ businessId: b(), code: 'RCP-BOX-50', productId: box.id, name: 'Executive box × 50', batchSize: 50, lines: [{ componentProductId: ribbon.id, qty: 20 }, { componentProductId: crate.id, qty: 2, fixed: true }] }, { viewer: owner })
    const recipes = await listRecipes({ businessId: b(), productId: box.id, viewer: member })
    expect(recipes.map((r) => r.batchSize)).toEqual([10, 50])
    expect(pickRecipeForQuantity(recipes, 25).id).toBe(recipe10.id)
    expect(pickRecipeForQuantity(recipes, 60).id).toBe(recipe50.id)
    expect(pickRecipeForQuantity(recipes, 3).id).toBe(recipe10.id)

    const exploded = await getRecipe(recipe10.id, { quantity: 25, viewer: member })
    expect(exploded.requirements).toMatchObject({ quantity: 25, factor: 2.5, producedQty: 25, canBuild: false })
    const line = (id) => exploded.requirements.lines.find((l) => l.componentProductId === id)
    expect(line(ribbon.id)).toMatchObject({ required: 12.5, issueQty: 13, onHand: 0, shortage: 13 })
    expect(line(tea.id)).toMatchObject({ required: 500, issueQty: 500, onHand: 0, shortage: 500 })
    expect(line(card.id)).toMatchObject({ required: 25, onHand: null, shortage: 0 })
    expect(line(crate.id)).toMatchObject({ required: 1, fixed: true, onHand: 0, shortage: 1 })
    expect(exploded.maxBuildableQuantity).toBe(0)
    await expect(getRecipe('no-such-recipe', { viewer: owner })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-156.3 — once stock arrives the explosion is buildable and the ledger says how many', async () => {
    await recordMovement({ businessId: b(), productId: ribbon.id, kind: 'RECEIPT', quantity: 20 }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: crate.id, kind: 'RECEIPT', quantity: 2 }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: tea.id, kind: 'RECEIPT', quantity: 300, lotCode: 'TEA-A' }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: tea.id, kind: 'RECEIPT', quantity: 300, lotCode: 'TEA-B' }, { viewer: owner })
    await prisma.productLot.updateMany({ where: { productId: tea.id, code: 'TEA-A' }, data: { expiresAt: new Date('2027-01-01T00:00:00Z') } })
    await prisma.productLot.updateMany({ where: { productId: tea.id, code: 'TEA-B' }, data: { expiresAt: new Date('2026-12-01T00:00:00Z') } })

    const ready = await getRecipe(recipe10.id, { quantity: 25, viewer: member })
    expect(ready.requirements.canBuild).toBe(true)
    // ribbon allows floor(20/5)*10 = 40, tea floor(600/200)*10 = 30, the crate is fixed and present.
    expect(ready.maxBuildableQuantity).toBe(30)
  })

  it('AC-156.4 — a build issues every counted component (FEFO for lots), receives the output, and is refused whole when short', async () => {
    const built = await buildRecipe(recipe10.id, { businessId: b(), quantity: 25, reference: 'ORD-001' }, { viewer: manager })
    expect(built).toMatchObject({ quantity: 25, factor: 2.5, producedQty: 25, reference: 'ORD-001' })
    expect(built.produced).toMatchObject({ productId: box.id, quantity: 25, onHandAfter: 25 })
    const consumed = Object.fromEntries(built.consumed.map((c) => [c.componentProductId, c]))
    expect(consumed[ribbon.id]).toMatchObject({ quantity: 13, onHandAfter: 7 })
    expect(consumed[crate.id]).toMatchObject({ quantity: 1, onHandAfter: 1 })
    expect(consumed[tea.id]).toMatchObject({ quantity: 500, onHandAfter: 100 })
    expect(consumed[card.id]).toBeUndefined()
    // FEFO: TEA-B expires first, so its 300 go before 200 of TEA-A.
    const lots = Object.fromEntries((await listLots({ businessId: b(), productId: tea.id, viewer: member })).map((l) => [l.code, l.onHand]))
    expect(lots).toEqual({ 'TEA-A': 100, 'TEA-B': 0 })
    const ledger = await prisma.stockMovement.findMany({ where: { reference: 'ORD-001' } })
    expect(ledger.filter((m) => m.kind === 'ISSUE').reduce((s, m) => s + m.quantity, 0)).toBe(-(13 + 1 + 500))
    expect(ledger.find((m) => m.kind === 'RECEIPT')).toMatchObject({ productId: box.id, quantity: 25 })

    const error = await buildRecipe(recipe10.id, { businessId: b(), quantity: 25 }, { viewer: owner }).catch((e) => e)
    expect(error).toMatchObject({ status: 409, message: 'INVENTORY_RECIPE_SHORTAGE' })
    expect(error.details.map((d) => d.code).sort()).toEqual(['RIBBON', 'TEA-LEAF'])
    expect(error.details.find((d) => d.code === 'RIBBON')).toMatchObject({ required: 13, onHand: 7, shortage: 6 })
    // Nothing moved on the refused build.
    expect((await getRecipe(recipe10.id, { viewer: member })).requirements.lines.find((l) => l.componentProductId === ribbon.id).onHand).toBe(7)
    await expect(buildRecipe(recipe10.id, { businessId: b(), quantity: 1 }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PRODUCT_RECIPE', entityId: recipe10.id, action: 'PRODUCT_RECIPE_BUILT' } })
    expect(audits).toHaveLength(1)
    expect(JSON.parse(audits[0].payloadJson)).toMatchObject({ quantity: 25, producedQty: 25 })
  })

  it('AC-156.5 — serial components and outputs are refused, a lot-tracked output needs its lot, UPDATE replaces lines and ARCHIVE closes', async () => {
    const withGadget = await createRecipe({ businessId: b(), code: 'RCP-GADGET', productId: box.id, name: 'x', batchSize: 1, lines: [{ componentProductId: gadget.id, qty: 1 }] }, { viewer: owner })
    await expect(buildRecipe(withGadget.id, { businessId: b(), quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_RECIPE_SERIAL_COMPONENT' })
    const serialOutput = await createRecipe({ businessId: b(), code: 'RCP-SERIAL-OUT', productId: gadget.id, name: 'x', batchSize: 1, lines: [{ componentProductId: crate.id, qty: 1 }] }, { viewer: owner })
    await expect(buildRecipe(serialOutput.id, { businessId: b(), quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_RECIPE_SERIAL_OUTPUT' })

    const blendRecipe = await createRecipe({ businessId: b(), code: 'RCP-BLEND', productId: blend.id, name: 'Blend × 100 g', batchSize: 100, lines: [{ componentProductId: tea.id, qty: 100 }] }, { viewer: owner })
    await expect(buildRecipe(blendRecipe.id, { businessId: b(), quantity: 50 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_LOT_REQUIRED' })
    const blended = await buildRecipe(blendRecipe.id, { businessId: b(), quantity: 50, outputLotCode: 'BLEND-1' }, { viewer: owner })
    expect(blended.produced).toMatchObject({ productId: blend.id, quantity: 50, onHandAfter: 50 })
    expect(blended.produced.lotId).toBeTruthy()
    expect(blended.consumed[0]).toMatchObject({ componentProductId: tea.id, quantity: 50, onHandAfter: 50 })

    const updated = await applyRecipeAction(recipe10.id, { action: 'UPDATE', version: 1, fields: { name: 'Executive box × 10 (v2)', lines: [{ componentProductId: ribbon.id, qty: 4 }] } }, { viewer: manager })
    expect(updated).toMatchObject({ name: 'Executive box × 10 (v2)', version: 2 })
    expect(updated.lines).toHaveLength(1)
    await expect(applyRecipeAction(recipe10.id, { action: 'ARCHIVE', version: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_RECIPE_VERSION_CONFLICT' })
    const archived = await applyRecipeAction(recipe10.id, { action: 'ARCHIVE', version: 2 }, { viewer: owner })
    expect(archived).toMatchObject({ status: 'ARCHIVED', version: 3 })
    await expect(buildRecipe(recipe10.id, { businessId: b(), quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_RECIPE_ARCHIVED' })
    expect((await listRecipes({ businessId: b(), productId: box.id, viewer: member })).map((r) => r.code)).not.toContain('RCP-BOX-10')
    expect((await listRecipes({ businessId: b(), productId: box.id, includeArchived: true, viewer: member })).map((r) => r.code)).toContain('RCP-BOX-10')
  })
})
