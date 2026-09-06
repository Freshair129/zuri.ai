// @req FR-148 — the rich menu designer against a real database: create with a
//   first draft, identity rules, image FileAsset validation, draft-in-place
//   versus next-numbered-version, the freeze gate and immutability, archive,
//   the authority ladder, compare-and-swap, and audit without secrets.
// @spec ADR-060 D3, D6, D11; SEC-001; BR-002; FR-072; FR-045
// @tested tests/integration/fr148-line-oa-rich-menu.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  LINE_OA_PROVIDER_CODE,
  createIntegrationConnection,
  registerIntegrationProvider,
} from '@/platform/integrations/core/integration-registry'
import { ROLE_LINE_OA_PUBLISHER } from '@/modules/identity/rbac'
import { connectLineOaAccount, applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import {
  applyRichMenuAction,
  createRichMenu,
  getRichMenu,
  listRichMenus,
} from '@/modules/line-oa-studio/application/line-oa-rich-menu-service'

const DOMAINS_WITH_STUDIO = ['projects', 'people', 'platform', 'line-oa']

let tenant, business, otherBusiness, provider, account
let owner, publisher, member, blindMember, foreignOwner
let pngFile, bigFile, pdfFile, foreignFile
let seq = 0

const area = (x, y, width, height, action = { type: 'MESSAGE', text: 'สวัสดี' }) => ({ bounds: { x, y, width, height }, action })
const draft = (overrides = {}) => ({
  layout: '2x1', chatBarText: 'เมนูหลัก', imageFileAssetId: pngFile.id, imageWidth: 2500, imageHeight: 843,
  areas: [area(0, 0, 1250, 843), area(1250, 0, 1250, 843, { type: 'URI', uri: 'https://shop.example/th' })],
  ...overrides,
})

async function fileAsset(target, { mime = 'image/png', size = 200_000 } = {}) {
  const n = ++seq
  return prisma.fileAsset.create({
    data: {
      code: `FIL-RM-${n}`, tenantId: tenant.id, businessId: target.id, storageKind: 'MANAGED_BLOB', blobRef: `blob-rm-${n}`,
      name: `menu-${n}.png`, mime, size, sha256: `sha-rm-${n}`, status: 'ACTIVE',
    },
  })
}

async function audits(entityId) {
  return prisma.auditEvent.findMany({ where: { entityId }, orderBy: { occurredAt: 'asc' } })
}

describe('FR-148 LineOaRichMenu', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-LINE-RM', name: 'Rich Menu Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-LINE-RM', name: 'Rich Menu Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-RM', name: 'Menu Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-RM-2', name: 'Other Business' })
    provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })

    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS_WITH_STUDIO })
    publisher = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS_WITH_STUDIO, rolesByBusinessId: { [business.id]: [ROLE_LINE_OA_PUBLISHER] } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS_WITH_STUDIO })
    blindMember = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['projects'] })
    foreignOwner = ownsElsewhere({ owns: otherBusiness.id, sees: business.id, seesDomains: DOMAINS_WITH_STUDIO, visibleDomains: DOMAINS_WITH_STUDIO })

    const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'LINE OA menus', externalAccountId: 'U-rm', purpose: 'GENERAL', status: 'ACTIVE' })
    account = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: connection.id, code: 'oa-rm-main', displayName: 'Menu Main' }, { viewer: owner })

    pngFile = await fileAsset(business)
    bigFile = await fileAsset(business, { size: 1024 * 1024 + 1 })
    pdfFile = await fileAsset(business, { mime: 'application/pdf' })
    foreignFile = await fileAsset(otherBusiness)
  })

  it('AC-148.1 — creates a menu with its first draft version and reports freeze readiness', async () => {
    const menu = await createRichMenu({ accountId: account.id, code: 'main-menu', name: 'Main menu', alias: 'main', draft: draft() }, { viewer: owner })
    expect(menu).toMatchObject({ code: 'main-menu', accountId: account.id, businessId: business.id, tenantId: tenant.id, alias: 'main', status: 'DRAFT', isDefault: false, version: 1, latestVersionNumber: 1 })
    expect(menu.versions).toHaveLength(1)
    expect(menu.versions[0]).toMatchObject({ versionNumber: 1, status: 'DRAFT', layout: '2x1', chatBarText: 'เมนูหลัก', imageFileAssetId: pngFile.id, imageWidth: 2500, imageHeight: 843, externalRichMenuId: null, frozenAt: null, issues: [] })
    expect(menu.versions[0].areas).toHaveLength(2)

    const [created] = await audits(menu.id)
    expect(created).toMatchObject({ entityType: 'LINE_OA_RICH_MENU', action: 'LINE_OA_RICH_MENU_CREATED' })
    expect(JSON.parse(created.payloadJson)).toMatchObject({ code: 'main-menu', versionNumber: 1, areas: 2, issues: 0 })
  })

  it('AC-148.2 — a draft may be saved with issues, and the version reports them; a publisher may do it', async () => {
    const menu = await createRichMenu({ accountId: account.id, code: 'wip-menu', name: 'Work in progress', draft: draft({ imageFileAssetId: null, imageWidth: 2500, imageHeight: 1000, areas: [area(0, 0, 2600, 1000)] }) }, { viewer: publisher })
    expect(menu.versions[0].issues.map((i) => i.code).sort()).toEqual(['AREA_OUT_OF_BOUNDS', 'IMAGE_REQUIRED', 'IMAGE_SIZE_UNSUPPORTED'])
    await expect(applyRichMenuAction(menu.id, { action: 'FREEZE', version: 1 }, { viewer: publisher })).rejects.toMatchObject({ status: 422, message: 'LINE_OA_RICH_MENU_NOT_FREEZABLE' })
  })

  it('AC-148.3 — the image must be a same-Business image FileAsset within LINE\'s limits', async () => {
    const base = { accountId: account.id, name: 'Image rules' }
    await expect(createRichMenu({ ...base, code: 'img-foreign', draft: draft({ imageFileAssetId: foreignFile.id }) }, { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Image file not found' })
    await expect(createRichMenu({ ...base, code: 'img-missing', draft: draft({ imageFileAssetId: 'no-such-file' }) }, { viewer: owner })).rejects.toMatchObject({ status: 404 })
    await expect(createRichMenu({ ...base, code: 'img-pdf', draft: draft({ imageFileAssetId: pdfFile.id }) }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'LINE_OA_RICH_MENU_IMAGE_MIME_UNSUPPORTED' })
    await expect(createRichMenu({ ...base, code: 'img-big', draft: draft({ imageFileAssetId: bigFile.id }) }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'LINE_OA_RICH_MENU_IMAGE_TOO_LARGE' })
  })

  it('AC-148.4 — identity rules: one code per Tenant, one alias per account, no menu on an archived account', async () => {
    await expect(createRichMenu({ accountId: account.id, code: 'main-menu', name: 'dup', draft: draft() }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_CODE_TAKEN' })
    await expect(createRichMenu({ accountId: account.id, code: 'alias-dup', name: 'dup', alias: 'main', draft: draft() }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_ALIAS_TAKEN' })

    const conn = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'LINE OA archived', externalAccountId: 'U-rm-arch', purpose: 'GENERAL', status: 'ACTIVE' })
    const archived = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: conn.id, code: 'oa-rm-archived', displayName: 'Gone' }, { viewer: owner })
    await applyLineOaAccountAction(archived.id, { action: 'ARCHIVE', version: archived.version }, { viewer: owner })
    await expect(createRichMenu({ accountId: archived.id, code: 'on-archived', name: 'x', draft: draft() }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_ARCHIVED' })
  })

  it('AC-148.5 — the authority ladder: view needs the domain, write needs OWNER or LINE_OA_PUBLISHER, everything else is one 404', async () => {
    const menu = await createRichMenu({ accountId: account.id, code: 'auth-menu', name: 'Auth', draft: draft() }, { viewer: owner })
    await expect(listRichMenus({ accountId: account.id, viewer: member })).resolves.toMatchObject({ accountId: account.id })
    await expect(getRichMenu(menu.id, { viewer: member })).resolves.toMatchObject({ id: menu.id })
    await expect(createRichMenu({ accountId: account.id, code: 'member-menu', name: 'x', draft: draft() }, { viewer: member })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(applyRichMenuAction(menu.id, { action: 'FREEZE', version: menu.version }, { viewer: member })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(getRichMenu(menu.id, { viewer: blindMember })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(listRichMenus({ accountId: account.id, viewer: blindMember })).rejects.toMatchObject({ status: 404 })
    await expect(createRichMenu({ accountId: account.id, code: 'foreign-menu', name: 'x', draft: draft() }, { viewer: foreignOwner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(getRichMenu('no-such-menu', { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(listRichMenus({ accountId: 'no-such-account', viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
  })

  it('AC-148.6 — save edits the draft in place; freeze makes it immutable and the next save opens version 2', async () => {
    const menu = await createRichMenu({ accountId: account.id, code: 'versioned-menu', name: 'Versioned', draft: draft() }, { viewer: owner })

    const edited = await applyRichMenuAction(menu.id, { action: 'SAVE_DRAFT', version: 1, name: 'Versioned v1', draft: draft({ chatBarText: 'แก้แล้ว' }) }, { viewer: owner })
    expect(edited).toMatchObject({ name: 'Versioned v1', version: 2, latestVersionNumber: 1 })
    expect(edited.versions).toHaveLength(1)
    expect(edited.versions[0]).toMatchObject({ versionNumber: 1, status: 'DRAFT', chatBarText: 'แก้แล้ว' })

    // A stale version is a conflict, never a silent overwrite.
    await expect(applyRichMenuAction(menu.id, { action: 'FREEZE', version: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_VERSION_CONFLICT' })

    const frozen = await applyRichMenuAction(menu.id, { action: 'FREEZE', version: 2 }, { viewer: owner })
    expect(frozen).toMatchObject({ status: 'READY', version: 3 })
    expect(frozen.versions[0]).toMatchObject({ versionNumber: 1, status: 'FROZEN', issues: [] })
    expect(frozen.versions[0].frozenAt).toBeTruthy()
    await expect(applyRichMenuAction(menu.id, { action: 'FREEZE', version: 3 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_NO_DRAFT' })

    const next = await applyRichMenuAction(menu.id, { action: 'SAVE_DRAFT', version: 3, draft: draft({ chatBarText: 'รุ่นสอง' }) }, { viewer: owner })
    expect(next).toMatchObject({ version: 4, latestVersionNumber: 2 })
    expect(next.versions.map((v) => [v.versionNumber, v.status, v.chatBarText])).toEqual([[1, 'FROZEN', 'แก้แล้ว'], [2, 'DRAFT', 'รุ่นสอง']])

    const versionAudits = await prisma.auditEvent.findMany({ where: { entityType: 'LINE_OA_RICH_MENU_VERSION', action: 'LINE_OA_RICH_MENU_VERSION_FROZEN' } })
    expect(versionAudits.some((row) => JSON.parse(row.payloadJson).richMenuId === menu.id)).toBe(true)
    const menuAudits = await audits(menu.id)
    expect(menuAudits.map((row) => row.action)).toEqual(['LINE_OA_RICH_MENU_CREATED', 'LINE_OA_RICH_MENU_DRAFT_SAVED', 'LINE_OA_RICH_MENU_VERSION_FROZEN', 'LINE_OA_RICH_MENU_DRAFT_SAVED'])
    for (const row of menuAudits) expect(row.payloadJson).not.toMatch(/secret|token/i)
  })

  it('AC-148.7 — archive retires the open draft, keeps frozen versions, and closes the menu to further actions', async () => {
    const menu = await createRichMenu({ accountId: account.id, code: 'archive-menu', name: 'Archive', draft: draft() }, { viewer: owner })
    const frozen = await applyRichMenuAction(menu.id, { action: 'FREEZE', version: 1 }, { viewer: owner })
    const reopened = await applyRichMenuAction(menu.id, { action: 'SAVE_DRAFT', version: frozen.version, draft: draft() }, { viewer: owner })
    const archived = await applyRichMenuAction(menu.id, { action: 'ARCHIVE', version: reopened.version }, { viewer: owner })
    expect(archived).toMatchObject({ status: 'ARCHIVED', isDefault: false })
    expect(archived.archivedAt).toBeTruthy()
    expect(archived.versions.map((v) => [v.versionNumber, v.status])).toEqual([[1, 'FROZEN'], [2, 'RETIRED']])
    await expect(applyRichMenuAction(menu.id, { action: 'SAVE_DRAFT', version: archived.version, draft: draft() }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_ARCHIVED' })

    const visible = await listRichMenus({ accountId: account.id, viewer: owner })
    expect(visible.richMenus.map((m) => m.code)).not.toContain('archive-menu')
    const all = await listRichMenus({ accountId: account.id, includeArchived: true, viewer: owner })
    expect(all.richMenus.map((m) => m.code)).toContain('archive-menu')
  })
})
