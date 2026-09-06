import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  LINE_OA_RICH_MENU_ENTITY,
  LINE_OA_RICH_MENU_VERSION_ENTITY,
  RICH_MENU_IMAGE_MAX_BYTES,
  RICH_MENU_IMAGE_MIMES,
  freezeBlockers,
  parseAreas,
  validateRichMenuDraft,
  zCreateRichMenu,
  zRichMenuActionInput,
} from '../domain/line-oa-rich-menu'
import { assertMayPublish, assertMayView, notFound } from './line-oa-account-authority'

// @req FR-148 — the only writer of LineOaRichMenu and LineOaRichMenuVersion:
//   create a menu with its first draft, list and read menus with their
//   versions, save a draft (in place while editable, or as the next numbered
//   version once the last one is frozen), freeze a draft into an immutable
//   version, and archive. Every write is one transaction, bumps the menu's
//   `version`, and appends an audit row with no secret and no customer content.
//   Publishing — queueing the transport job that carries a frozen version to
//   LINE and records the external richMenuId — is the transport lane's slice,
//   not this one; this service never talks to LINE.
// @spec ADR-060 D3, D6, D11; SEC-001; BR-002; BR-012; FR-072; FR-045
// @tested tests/integration/fr148-line-oa-rich-menu.test.js

function failure(status, message, details) {
  const error = new Error(message)
  error.status = status
  if (details) error.details = details
  return error
}

const MENU_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, lineOaAccountId: true, name: true, alias: true,
  status: true, isDefault: true, archivedAt: true, createdAt: true, updatedAt: true, version: true,
}
const VERSION_SELECT = {
  id: true, richMenuId: true, versionNumber: true, status: true, layout: true, chatBarText: true, selected: true,
  imageFileAssetId: true, imageWidth: true, imageHeight: true, areasJson: true, externalRichMenuId: true,
  frozenAt: true, publishedAt: true, createdAt: true, updatedAt: true,
}

function versionDto(row) {
  const areas = parseAreas(row.areasJson)
  const body = { layout: row.layout, chatBarText: row.chatBarText, selected: row.selected, imageFileAssetId: row.imageFileAssetId, imageWidth: row.imageWidth, imageHeight: row.imageHeight, areas }
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    status: row.status,
    ...body,
    // What still blocks a freeze — empty on a frozen version by construction.
    issues: row.status === 'DRAFT' ? freezeBlockers(body) : [],
    externalRichMenuId: row.externalRichMenuId,
    frozenAt: row.frozenAt,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function menuDto(row, versions = []) {
  const sorted = [...versions].sort((a, b) => a.versionNumber - b.versionNumber)
  return {
    id: row.id,
    code: row.code,
    tenantId: row.tenantId,
    businessId: row.businessId,
    accountId: row.lineOaAccountId,
    name: row.name,
    alias: row.alias,
    status: row.status,
    isDefault: row.isDefault,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    latestVersionNumber: sorted.length ? sorted[sorted.length - 1].versionNumber : 0,
    versions: sorted.map(versionDto),
  }
}

async function loadAccount(tx, accountId) {
  const id = typeof accountId === 'string' ? accountId.trim() : ''
  if (!id) throw notFound()
  const account = await tx.lineOaAccount.findUnique({ where: { id }, select: { id: true, tenantId: true, businessId: true, status: true } })
  if (!account) throw notFound()
  return account
}

/**
 * The image must be a FileAsset of the same Tenant and Business, alive, an
 * image LINE accepts and within LINE's byte limit (LOS-RQ-016). Bytes are
 * never read here; the metadata the file lane recorded on upload is trusted.
 */
async function assertImageUsable(tx, account, imageFileAssetId) {
  if (!imageFileAssetId) return
  const file = await tx.fileAsset.findUnique({ where: { id: imageFileAssetId }, select: { id: true, tenantId: true, businessId: true, mime: true, size: true, deletedAt: true, status: true } })
  if (!file || file.tenantId !== account.tenantId || file.businessId !== account.businessId || file.deletedAt) {
    throw failure(404, 'Image file not found')
  }
  if (!RICH_MENU_IMAGE_MIMES.includes(file.mime)) throw failure(422, 'LINE_OA_RICH_MENU_IMAGE_MIME_UNSUPPORTED')
  if (file.size > RICH_MENU_IMAGE_MAX_BYTES) throw failure(422, 'LINE_OA_RICH_MENU_IMAGE_TOO_LARGE')
}

function draftColumns(draft) {
  return {
    layout: draft.layout,
    chatBarText: draft.chatBarText,
    selected: draft.selected ?? false,
    imageFileAssetId: draft.imageFileAssetId ?? null,
    imageWidth: draft.imageWidth,
    imageHeight: draft.imageHeight,
    areasJson: JSON.stringify(draft.areas),
  }
}

/** Create a rich menu for an account with its first draft version. */
export async function createRichMenu(input, { viewer, db = prisma } = {}) {
  const data = zCreateRichMenu.parse(input)
  const created = await db.$transaction(async (tx) => {
    const account = await loadAccount(tx, data.accountId)
    // Authority before existence of anything else (SEC-001): a caller outside
    // the account's Business learns only that it is not there.
    assertMayPublish(viewer, account.businessId)
    if (account.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')

    const codeTaken = await tx.lineOaRichMenu.findUnique({ where: { tenantId_code: { tenantId: account.tenantId, code: data.code } }, select: { id: true } })
    if (codeTaken) throw failure(409, 'LINE_OA_RICH_MENU_CODE_TAKEN')
    if (data.alias) {
      const aliasTaken = await tx.lineOaRichMenu.findFirst({ where: { lineOaAccountId: account.id, alias: data.alias }, select: { id: true } })
      if (aliasTaken) throw failure(409, 'LINE_OA_RICH_MENU_ALIAS_TAKEN')
    }
    await assertImageUsable(tx, account, data.draft.imageFileAssetId)

    const menu = await tx.lineOaRichMenu.create({
      data: {
        code: data.code,
        tenantId: account.tenantId,
        businessId: account.businessId,
        lineOaAccountId: account.id,
        name: data.name,
        alias: data.alias ?? null,
      },
      select: MENU_SELECT,
    })
    const version = await tx.lineOaRichMenuVersion.create({
      data: {
        richMenuId: menu.id,
        tenantId: account.tenantId,
        businessId: account.businessId,
        lineOaAccountId: account.id,
        versionNumber: 1,
        status: 'DRAFT',
        ...draftColumns(data.draft),
      },
      select: VERSION_SELECT,
    })
    await recordAudit(tx, {
      entityType: LINE_OA_RICH_MENU_ENTITY,
      entityId: menu.id,
      action: 'LINE_OA_RICH_MENU_CREATED',
      actorId: viewer?.principal?.id ?? null,
      payload: { businessId: menu.businessId, accountId: menu.lineOaAccountId, code: menu.code, alias: menu.alias, versionNumber: 1, layout: version.layout, areas: data.draft.areas.length, issues: validateRichMenuDraft(data.draft).length },
    })
    return { menu, versions: [version] }
  })
  return menuDto(created.menu, created.versions)
}

/** The rich menus of one account the viewer may see, archived ones on request only. */
export async function listRichMenus({ accountId, includeArchived = false, viewer, db = prisma } = {}) {
  const account = await loadAccount(db, accountId)
  assertMayView(viewer, account.businessId)
  const rows = await db.lineOaRichMenu.findMany({
    where: { lineOaAccountId: account.id, ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { ...MENU_SELECT, versions: { select: VERSION_SELECT } },
  })
  return { accountId: account.id, richMenus: rows.map((row) => menuDto(row, row.versions)) }
}

export async function getRichMenu(id, { viewer, db = prisma } = {}) {
  const menuId = typeof id === 'string' ? id.trim() : ''
  if (!menuId) throw notFound()
  const row = await db.lineOaRichMenu.findUnique({ where: { id: menuId }, select: { ...MENU_SELECT, versions: { select: VERSION_SELECT } } })
  // Read first only to learn the Business; "not there" and "not yours" answer alike.
  if (!row) throw notFound()
  assertMayView(viewer, row.businessId)
  return menuDto(row, row.versions)
}

const ACTIONS = Object.freeze({
  SAVE_DRAFT: 'LINE_OA_RICH_MENU_DRAFT_SAVED',
  FREEZE: 'LINE_OA_RICH_MENU_VERSION_FROZEN',
  ARCHIVE: 'LINE_OA_RICH_MENU_ARCHIVED',
})

/**
 * Apply one versioned action. The caller's `version` must equal the menu row's;
 * the update is a compare-and-swap on (id, version), so two editors acting at
 * once produce one success and one 409.
 */
export async function applyRichMenuAction(id, input, { viewer, db = prisma } = {}) {
  const menuId = typeof id === 'string' ? id.trim() : ''
  if (!menuId) throw notFound()
  const data = zRichMenuActionInput.parse(input)

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.lineOaRichMenu.findUnique({ where: { id: menuId }, select: { ...MENU_SELECT, versions: { select: VERSION_SELECT } } })
    if (!row) throw notFound()
    assertMayPublish(viewer, row.businessId)
    if (row.version !== data.version) throw failure(409, 'LINE_OA_RICH_MENU_VERSION_CONFLICT')
    if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_RICH_MENU_ARCHIVED')

    const versions = [...row.versions].sort((a, b) => a.versionNumber - b.versionNumber)
    const latest = versions[versions.length - 1] ?? null
    const change = {}
    const payload = { businessId: row.businessId, accountId: row.lineOaAccountId, code: row.code }

    switch (data.action) {
      case 'SAVE_DRAFT': {
        const account = await loadAccount(tx, row.lineOaAccountId)
        await assertImageUsable(tx, account, data.draft.imageFileAssetId)
        if (data.name !== undefined) change.name = data.name
        if (data.alias !== undefined) {
          if (data.alias) {
            const aliasTaken = await tx.lineOaRichMenu.findFirst({ where: { lineOaAccountId: row.lineOaAccountId, alias: data.alias, id: { not: row.id } }, select: { id: true } })
            if (aliasTaken) throw failure(409, 'LINE_OA_RICH_MENU_ALIAS_TAKEN')
          }
          change.alias = data.alias
        }
        const columns = draftColumns(data.draft)
        if (latest && latest.status === 'DRAFT') {
          // Editable: the body changes in place; the number does not.
          await tx.lineOaRichMenuVersion.update({ where: { id: latest.id }, data: columns })
          payload.versionNumber = latest.versionNumber
          payload.newVersion = false
        } else {
          // Frozen (or published): the draft becomes the next numbered version
          // and the frozen one stays exactly as it was (LOS-RQ-041).
          const versionNumber = (latest?.versionNumber ?? 0) + 1
          await tx.lineOaRichMenuVersion.create({
            data: { richMenuId: row.id, tenantId: row.tenantId, businessId: row.businessId, lineOaAccountId: row.lineOaAccountId, versionNumber, status: 'DRAFT', ...columns },
          })
          payload.versionNumber = versionNumber
          payload.newVersion = true
        }
        payload.issues = validateRichMenuDraft(data.draft).length
        break
      }
      case 'FREEZE': {
        if (!latest || latest.status !== 'DRAFT') throw failure(409, 'LINE_OA_RICH_MENU_NO_DRAFT')
        const body = { layout: latest.layout, chatBarText: latest.chatBarText, selected: latest.selected, imageFileAssetId: latest.imageFileAssetId, imageWidth: latest.imageWidth, imageHeight: latest.imageHeight, areas: parseAreas(latest.areasJson) }
        const blockers = freezeBlockers(body)
        if (blockers.length) throw failure(422, 'LINE_OA_RICH_MENU_NOT_FREEZABLE', blockers)
        const frozenAt = new Date()
        await tx.lineOaRichMenuVersion.update({ where: { id: latest.id }, data: { status: 'FROZEN', frozenAt } })
        await recordAudit(tx, {
          entityType: LINE_OA_RICH_MENU_VERSION_ENTITY,
          entityId: latest.id,
          action: 'LINE_OA_RICH_MENU_VERSION_FROZEN',
          actorId: viewer?.principal?.id ?? null,
          payload: { richMenuId: row.id, versionNumber: latest.versionNumber, layout: latest.layout, areas: body.areas.length },
        })
        if (row.status === 'DRAFT') { change.status = 'READY'; payload.from = { status: 'DRAFT' }; payload.to = { status: 'READY' } }
        payload.versionNumber = latest.versionNumber
        break
      }
      case 'ARCHIVE': {
        change.status = 'ARCHIVED'
        change.archivedAt = new Date()
        change.isDefault = false
        // An unfrozen draft has no history worth keeping open; a frozen version stays.
        await tx.lineOaRichMenuVersion.updateMany({ where: { richMenuId: row.id, status: 'DRAFT' }, data: { status: 'RETIRED' } })
        payload.from = { status: row.status }
        payload.to = { status: 'ARCHIVED' }
        break
      }
      default:
        throw failure(400, 'LINE_OA_RICH_MENU_ACTION_UNKNOWN')
    }

    const result = await tx.lineOaRichMenu.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...change, version: { increment: 1 } },
    })
    if (result.count !== 1) throw failure(409, 'LINE_OA_RICH_MENU_VERSION_CONFLICT')

    await recordAudit(tx, {
      entityType: LINE_OA_RICH_MENU_ENTITY,
      entityId: row.id,
      action: ACTIONS[data.action],
      actorId: viewer?.principal?.id ?? null,
      payload: { ...payload, version: row.version + 1 },
    })
    return tx.lineOaRichMenu.findUnique({ where: { id: row.id }, select: { ...MENU_SELECT, versions: { select: VERSION_SELECT } } })
  })

  return menuDto(updated, updated.versions)
}
