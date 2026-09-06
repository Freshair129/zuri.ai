import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  LINE_OA_LIFF_APP_ENTITY,
  initialLiffStatus,
  liffUrl,
  parseScopes,
  zLiffAppAction,
  zRegisterLiffApp,
} from '../domain/line-oa-liff-app'
import { assertMayPublish, assertMayView, notFound } from './line-oa-account-authority'

// @req FR-153 — the only writer of LineOaLiffApp: register an app for an
//   account (DRAFT until its liffId is recorded, ACTIVE from then), list and
//   read the registry, and apply the versioned actions — UPDATE the fields,
//   RECORD_LIFF_ID (the id LINE Developers issued; activates the app), ARCHIVE.
//   Every write is one transaction, bumps `version` and appends an audit row.
//   Nothing here calls LINE: creating the app on LINE Login is a console step
//   today and a transport job later (SRS LOS-RQ-070); the registry records
//   what exists so the Studio's LIFF actions can resolve to it.
// @spec SRS LOS-RQ-070; BR-002 (liffId is an attribute, unique per account,
//   never a key); ADR-060 D11 (404-shaped refusals, publisher writes); SEC-001
// @tested tests/integration/fr153-line-oa-liff-app.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })

const SELECT = {
  id: true, code: true, tenantId: true, businessId: true, lineOaAccountId: true, name: true, description: true,
  viewSize: true, endpointUrl: true, scopesJson: true, botPrompt: true, status: true, externalLiffId: true,
  archivedAt: true, createdAt: true, updatedAt: true, version: true,
}

function toDto(row) {
  return {
    id: row.id, code: row.code, tenantId: row.tenantId, businessId: row.businessId, accountId: row.lineOaAccountId,
    name: row.name, description: row.description, viewSize: row.viewSize, endpointUrl: row.endpointUrl,
    scopes: parseScopes(row.scopesJson), botPrompt: row.botPrompt, status: row.status,
    liffId: row.externalLiffId, liffUrl: row.externalLiffId ? liffUrl(row.externalLiffId) : null,
    archivedAt: row.archivedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version,
  }
}

async function loadAccount(tx, accountId) {
  const id = typeof accountId === 'string' ? accountId.trim() : ''
  if (!id) throw notFound()
  const account = await tx.lineOaAccount.findUnique({ where: { id }, select: { id: true, tenantId: true, businessId: true, status: true } })
  if (!account) throw notFound()
  return account
}

function fieldColumns(fields) {
  const out = {}
  if (fields.name !== undefined) out.name = fields.name
  if (fields.description !== undefined) out.description = fields.description
  if (fields.viewSize !== undefined) out.viewSize = fields.viewSize
  if (fields.endpointUrl !== undefined) out.endpointUrl = fields.endpointUrl
  if (fields.scopes !== undefined) out.scopesJson = JSON.stringify(fields.scopes)
  if (fields.botPrompt !== undefined) out.botPrompt = fields.botPrompt
  return out
}

async function assertLiffIdFree(tx, accountId, liffId, exceptId = null) {
  const taken = await tx.lineOaLiffApp.findFirst({ where: { lineOaAccountId: accountId, externalLiffId: liffId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })
  if (taken) throw failure(409, 'LINE_OA_LIFF_ID_TAKEN')
}

/** Register a LIFF app for an account; ACTIVE at once when the liffId is known. */
export async function registerLiffApp(input, { viewer, db = prisma } = {}) {
  const data = zRegisterLiffApp.parse(input)
  const row = await db.$transaction(async (tx) => {
    const account = await loadAccount(tx, data.accountId)
    assertMayPublish(viewer, account.businessId)
    if (account.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
    const codeTaken = await tx.lineOaLiffApp.findUnique({ where: { tenantId_code: { tenantId: account.tenantId, code: data.code } }, select: { id: true } })
    if (codeTaken) throw failure(409, 'LINE_OA_LIFF_APP_CODE_TAKEN')
    if (data.liffId) await assertLiffIdFree(tx, account.id, data.liffId)
    const created = await tx.lineOaLiffApp.create({
      data: {
        code: data.code, tenantId: account.tenantId, businessId: account.businessId, lineOaAccountId: account.id,
        ...fieldColumns(data), scopesJson: JSON.stringify(data.scopes ?? []),
        status: initialLiffStatus({ liffId: data.liffId }), externalLiffId: data.liffId ?? null,
      },
      select: SELECT,
    })
    await recordAudit(tx, {
      entityType: LINE_OA_LIFF_APP_ENTITY, entityId: created.id, action: 'LINE_OA_LIFF_APP_REGISTERED',
      actorId: viewer?.principal?.id ?? null,
      payload: { businessId: created.businessId, accountId: created.lineOaAccountId, code: created.code, status: created.status, liffId: created.externalLiffId, viewSize: created.viewSize },
    })
    return created
  })
  return toDto(row)
}

/** The registry of one account the viewer may see; archived rows on request only. */
export async function listLiffApps({ accountId, includeArchived = false, viewer, db = prisma } = {}) {
  const account = await loadAccount(db, accountId)
  assertMayView(viewer, account.businessId)
  const rows = await db.lineOaLiffApp.findMany({
    where: { lineOaAccountId: account.id, ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
    orderBy: [{ createdAt: 'asc' }],
    select: SELECT,
  })
  return { accountId: account.id, liffApps: rows.map(toDto) }
}

export async function getLiffApp(id, { viewer, db = prisma } = {}) {
  const appId = typeof id === 'string' ? id.trim() : ''
  if (!appId) throw notFound()
  const row = await db.lineOaLiffApp.findUnique({ where: { id: appId }, select: SELECT })
  if (!row) throw notFound()
  assertMayView(viewer, row.businessId)
  return toDto(row)
}

const ACTIONS = Object.freeze({
  UPDATE: 'LINE_OA_LIFF_APP_UPDATED',
  RECORD_LIFF_ID: 'LINE_OA_LIFF_APP_ID_RECORDED',
  ARCHIVE: 'LINE_OA_LIFF_APP_ARCHIVED',
})

/** Apply one versioned action; compare-and-swap on (id, version). */
export async function applyLiffAppAction(id, input, { viewer, db = prisma } = {}) {
  const appId = typeof id === 'string' ? id.trim() : ''
  if (!appId) throw notFound()
  const data = zLiffAppAction.parse(input)
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.lineOaLiffApp.findUnique({ where: { id: appId }, select: SELECT })
    if (!row) throw notFound()
    assertMayPublish(viewer, row.businessId)
    if (row.version !== data.version) throw failure(409, 'LINE_OA_LIFF_APP_VERSION_CONFLICT')
    if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_LIFF_APP_ARCHIVED')

    const change = {}
    const payload = { businessId: row.businessId, accountId: row.lineOaAccountId, code: row.code }
    switch (data.action) {
      case 'UPDATE':
        Object.assign(change, fieldColumns(data.fields))
        payload.fields = Object.keys(change)
        break
      case 'RECORD_LIFF_ID':
        await assertLiffIdFree(tx, row.lineOaAccountId, data.liffId, row.id)
        change.externalLiffId = data.liffId
        change.status = 'ACTIVE'
        payload.from = { status: row.status, liffId: row.externalLiffId }
        payload.to = { status: 'ACTIVE', liffId: data.liffId }
        break
      case 'ARCHIVE':
        change.status = 'ARCHIVED'
        change.archivedAt = new Date()
        payload.from = { status: row.status }
        payload.to = { status: 'ARCHIVED' }
        break
      default:
        throw failure(400, 'LINE_OA_LIFF_APP_ACTION_UNKNOWN')
    }
    const result = await tx.lineOaLiffApp.updateMany({ where: { id: row.id, version: row.version }, data: { ...change, version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'LINE_OA_LIFF_APP_VERSION_CONFLICT')
    await recordAudit(tx, {
      entityType: LINE_OA_LIFF_APP_ENTITY, entityId: row.id, action: ACTIONS[data.action],
      actorId: viewer?.principal?.id ?? null, payload: { ...payload, version: row.version + 1 },
    })
    return tx.lineOaLiffApp.findUnique({ where: { id: row.id }, select: SELECT })
  })
  return toDto(updated)
}
