import prisma from '@/lib/db'
import { LINE_OA_ACCOUNT_ACTIONS, LINE_OA_ACCOUNT_STATUSES } from '@/lib/validation/enums'
import { resolveServerLineAccount, createServerLineSecretManagerFromEnv } from '@/platform/integrations/providers/line/server-line-transport'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { readLineOaConnectionHealth } from '@/modules/integration/application/integration-management-service'
import { LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createLineBindingStatusReaderFromEnv, readLineBindingStatusLabel } from '@/modules/agent/line-binding-status'
import {
  LINE_OA_ACCOUNT_ENTITY,
  defaultTransportMode,
  deriveEffectiveStatus,
  initialStoredStatus,
  nextStoredStatus,
  parseBotProfile,
  zConnectLineOaAccount,
  zLineOaAccountAction,
} from '../domain/line-oa-account'
import { assertMayPublish, assertMayView, notFound } from './line-oa-account-authority'

// @req FR-149 — server activation and execution policy fenced against delivery jobs.
// @spec ADR-061
// @req FR-146 — the only writer of LineOaAccount: connect an existing LINE_OA
//   connection as an account, list and read accounts with computed health, and
//   apply the versioned actions (pause, resume, archive, set default, switch
//   transport mode). Every write is one transaction, bumps `version`, and
//   appends an audit row that carries no secret and no customer content.
// @spec ADR-060 D2 (N per Business, one Business per account), D3 (the account
//   references the connection and the binding; health is computed, never
//   stored; server transport is the ADR-061 default), D5 (an audited,
//   versioned switch changes the transport owner), D11 (refusals 404-shaped).
// @spec SEC-001, BR-002, BR-012, FR-072, FR-080, FR-144
// @tested tests/integration/fr146-line-oa-account.test.js

const ACTIONS = Object.freeze({
  ENABLE_SERVER: 'LINE_OA_SERVER_ENABLED',
  DISABLE_SERVER: 'LINE_OA_SERVER_DISABLED',
  CONFIGURE_EXECUTION: 'LINE_OA_EXECUTION_CONFIGURED',
  PAUSE: 'LINE_OA_ACCOUNT_PAUSED',
  RESUME: 'LINE_OA_ACCOUNT_RESUMED',
  ARCHIVE: 'LINE_OA_ACCOUNT_ARCHIVED',
  SET_DEFAULT: 'LINE_OA_ACCOUNT_DEFAULT_SET',
  SWITCH_TRANSPORT_MODE: 'LINE_OA_ACCOUNT_TRANSPORT_MODE_SWITCHED',
})

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * The ports this service reads through. Each has a default that is the real
 * thing this repository can answer today, and each is replaceable so the health
 * sources stay honest:
 *
 * - `connectionHealth(connectionIds)` — the integration lane's redacted
 *   connection read model (FR-080): status, secret readiness, last webhook
 *   receipt. The Studio never reads the credential table itself.
 * - `bindingStatus(account)` — the agent lane's FR-147 read contract over
 *   `zuri_core.line_channel_binding`, which lives in the production Postgres
 *   runtime rather than the shared Prisma schema. The default reader exists
 *   only when that runtime is configured (`ZURI_LINE_BUSINESS_AGENT_ENABLED`
 *   and `ZURI_LINE_DB_URL`); otherwise the label is UNKNOWN, which the DTO
 *   reports as such rather than pretending. The four labels are the contract's
 *   own: ACTIVE, NOT_ACTIVE, NO_BINDING, UNKNOWN.
 */
function portsOf(db, ports = {}) {
  return {
    connectionHealth: ports.connectionHealth
      ?? ((connectionIds) => readLineOaConnectionHealth({ db, connectionIds })),
    bindingStatus: ports.bindingStatus ?? defaultBindingStatus,
  }
}

async function defaultBindingStatus(row) {
  const reader = createLineBindingStatusReaderFromEnv()
  return readLineBindingStatusLabel(reader, { tenantId: row.tenantId, businessId: row.businessId, code: row.bindingCode })
}

const BINDING_SOURCES = Object.freeze({
  ACTIVE: 'agent binding read contract (FR-147): an ACTIVE, in-window binding is visible to the read role',
  NOT_ACTIVE: 'agent binding read contract (FR-147): no ACTIVE, in-window binding is visible to the read role — pending, inactive, expired, rotated, absent and out-of-policy are indistinguishable by design',
  NO_BINDING: 'this account carries no binding code yet',
  UNKNOWN: 'agent binding read contract (FR-147) not configured in this process — LINE runtime database unset',
})

const SELECT = {
  id: true, code: true, tenantId: true, businessId: true, integrationConnectionId: true,
  bindingCode: true, displayName: true, basicId: true, status: true, transportMode: true,
  isDefaultForBusiness: true, botProfileJson: true, archivedAt: true, createdAt: true,
  updatedAt: true, version: true, serverEnabled: true, executionMode: true,
  modelAccess: true, allowDelayedPush: true, transportEpoch: true,
}

function toHealth(row, { connection, bindingStatus, transportJobs }) {
  return {
    connection: connection
      ? {
        status: connection.status,
        secretStatus: connection.secretStatus,
        secretConfigured: connection.secretConfigured,
        health: connection.health,
        lastWebhookAt: connection.lastEventAt ?? null,
      }
      : null,
    binding: {
      code: row.bindingCode,
      status: bindingStatus ?? 'UNKNOWN',
    },
    transportJobs,
    quota: null,
    sources: {
      connection: 'integration read model (FR-080) — computed, never stored',
      binding: BINDING_SOURCES[bindingStatus ?? 'UNKNOWN'] ?? BINDING_SOURCES.UNKNOWN,
      transportJobs: 'persistent LineConversationJob status counts (FR-149)',
      quota: 'not built (ADR-060 Phase 4)',
    },
    computedAt: new Date().toISOString(),
  }
}

function toDto(row, health) {
  return {
    id: row.id,
    code: row.code,
    tenantId: row.tenantId,
    businessId: row.businessId,
    displayName: row.displayName,
    basicId: row.basicId,
    integrationConnectionId: row.integrationConnectionId,
    bindingCode: row.bindingCode,
    status: row.status,
    effectiveStatus: deriveEffectiveStatus(row.status, health?.binding?.status ?? null, row),
    transportMode: row.transportMode,
    serverEnabled: row.serverEnabled,
    executionMode: row.executionMode,
    modelAccess: row.modelAccess,
    allowDelayedPush: row.allowDelayedPush,
    transportEpoch: row.transportEpoch,
    isDefaultForBusiness: row.isDefaultForBusiness,
    botProfile: parseBotProfile(row.botProfileJson),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    health,
  }
}

async function describe(rows, db, ports) {
  const p = portsOf(db, ports)
  const connections = await p.connectionHealth(rows.map((row) => row.integrationConnectionId))
  const groups = await db.lineConversationJob.groupBy({ by: ['accountId', 'status'], where: { accountId: { in: rows.map(row => row.id) } }, _count: { _all: true } })
  const result = []
  for (const row of rows) {
    const bindingStatus = await p.bindingStatus(row)
    result.push(toDto(row, toHealth(row, { connection: connections.get(row.integrationConnectionId) ?? null, bindingStatus, transportJobs: Object.fromEntries(groups.filter(group => group.accountId === row.id).map(group => [group.status, group._count._all])) })))
  }
  return result
}

async function clearDefault(tx, businessId, exceptId = null) {
  await tx.lineOaAccount.updateMany({
    where: { businessId, isDefaultForBusiness: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefaultForBusiness: false, version: { increment: 1 } },
  })
}

/**
 * Connect an existing LINE_OA connection as an account of the Business.
 *
 * The connection is the integration lane's row (FR-080); this never creates,
 * reads or returns credential material, and never touches the agent lane's
 * binding — it records the binding *code* it is told, as a reference (D3).
 */
export async function connectLineOaAccount(input, { viewer, db = prisma, ports } = {}) {
  const data = zConnectLineOaAccount.parse(input)
  // Authority before existence (SEC-001): an unauthorized caller learns nothing.
  assertMayPublish(viewer, data.businessId)
  const created = await db.$transaction(async (tx) => {
    const business = await tx.business.findUnique({ where: { id: data.businessId }, select: { id: true, tenantId: true } })
    if (!business) throw notFound()

    const connection = await tx.integrationConnection.findUnique({
      where: { id: data.integrationConnectionId },
      include: { provider: true, lineOaAccount: { select: { id: true } } },
    })
    // Unknown, foreign-tenant and non-LINE connections answer alike: the caller
    // is told the connection is not there, not which of the three it is.
    if (!connection || connection.tenantId !== business.tenantId || connection.provider?.code !== LINE_OA_PROVIDER_CODE) {
      throw failure(404, 'Integration connection not found')
    }
    if ((connection.businessId ?? null) !== business.id) throw failure(409, 'LINE_OA_CONNECTION_OUTSIDE_BUSINESS')
    if (connection.lineOaAccount) throw failure(409, 'LINE_OA_CONNECTION_ALREADY_BOUND')

    const codeTaken = await tx.lineOaAccount.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code: data.code } }, select: { id: true } })
    if (codeTaken) throw failure(409, 'LINE_OA_ACCOUNT_CODE_TAKEN')
    if (data.bindingCode) {
      const bindingTaken = await tx.lineOaAccount.findFirst({ where: { tenantId: business.tenantId, bindingCode: data.bindingCode }, select: { id: true } })
      if (bindingTaken) throw failure(409, 'LINE_OA_BINDING_CODE_TAKEN')
    }

    let transportModeSource = 'OVERRIDE'
    let transportMode = data.transportMode
    if (!transportMode) {
      transportMode = defaultTransportMode()
      transportModeSource = 'SERVER_DEFAULT'
    }

    // The first live account of a Business is its default unless the caller
    // says otherwise; a later one is default only when asked, and asking
    // clears the previous holder inside this same transaction.
    const existing = await tx.lineOaAccount.count({ where: { businessId: business.id, status: { not: 'ARCHIVED' } } })
    const isDefault = data.isDefaultForBusiness ?? existing === 0
    if (isDefault) await clearDefault(tx, business.id)

    const row = await tx.lineOaAccount.create({
      data: {
        code: data.code,
        tenantId: business.tenantId,
        businessId: business.id,
        integrationConnectionId: connection.id,
        bindingCode: data.bindingCode ?? null,
        displayName: data.displayName,
        basicId: data.basicId ?? null,
        status: initialStoredStatus({ bindingCode: data.bindingCode }),
        transportMode,
        isDefaultForBusiness: isDefault,
        botProfileJson: JSON.stringify(data.botProfile ?? {}),
      },
      select: SELECT,
    })
    await recordAudit(tx, {
      entityType: LINE_OA_ACCOUNT_ENTITY,
      entityId: row.id,
      action: 'LINE_OA_ACCOUNT_CONNECTED',
      actorId: viewer?.principal?.id ?? null,
      payload: {
        businessId: row.businessId,
        code: row.code,
        integrationConnectionId: row.integrationConnectionId,
        bindingCode: row.bindingCode,
        status: row.status,
        transportMode: row.transportMode,
        transportModeSource,
        isDefaultForBusiness: row.isDefaultForBusiness,
      },
    })
    return row
  })

  const [dto] = await describe([created], db, ports)
  return dto
}

/** The accounts of one Business the viewer may see, archived ones on request only. */
export async function listLineOaAccounts({ businessId, includeArchived = false, viewer, db = prisma, ports } = {}) {
  const business = typeof businessId === 'string' ? businessId.trim() : ''
  if (!business) throw failure(400, 'LINE_OA_BUSINESS_REQUIRED')
  assertMayView(viewer, business)
  const rows = await db.lineOaAccount.findMany({
    where: { businessId: business, ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
    orderBy: [{ isDefaultForBusiness: 'desc' }, { createdAt: 'asc' }],
    select: SELECT,
  })
  return { businessId: business, accounts: await describe(rows, db, ports) }
}

export async function getLineOaAccount(id, { viewer, db = prisma, ports } = {}) {
  const accountId = typeof id === 'string' ? id.trim() : ''
  if (!accountId) throw notFound()
  const row = await db.lineOaAccount.findUnique({ where: { id: accountId }, select: SELECT })
  // The row is read before the authority check only to learn which Business it
  // belongs to; nothing about it is disclosed unless the viewer may see that
  // Business, and "not there" and "not yours" are the same answer.
  if (!row) throw notFound()
  assertMayView(viewer, row.businessId)
  const [dto] = await describe([row], db, ports)
  return dto
}

/**
 * Apply one versioned action. The caller's `version` must equal the row's;
 * the update is a compare-and-swap on (id, version), so two publishers acting
 * at once produce one success and one 409, never two overlapping writes.
 */
export async function applyLineOaAccountAction(id, input, { viewer, db = prisma, ports } = {}) {
  const accountId = typeof id === 'string' ? id.trim() : ''
  if (!accountId) throw notFound()
  const data = zLineOaAccountAction.parse(input)

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.lineOaAccount.findUnique({ where: { id: accountId }, select: SELECT })
    if (!row) throw notFound()
    assertMayPublish(viewer, row.businessId)
    if (row.version !== data.version) throw failure(409, 'LINE_OA_ACCOUNT_VERSION_CONFLICT')

    const change = {}
    const payload = { businessId: row.businessId, code: row.code, from: {}, to: {} }
    switch (data.action) {
      case 'PAUSE':
      case 'RESUME':
      case 'ARCHIVE': {
        const to = nextStoredStatus(row.status, data.action)
        if (!to) throw failure(409, 'LINE_OA_ACCOUNT_TRANSITION_INVALID')
        change.status = to
        payload.from.status = row.status
        payload.to.status = to
        if (to === 'ARCHIVED') {
          change.archivedAt = new Date()
          change.isDefaultForBusiness = false
        }
        break
      }
      case 'SET_DEFAULT': {
        if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
        if (row.isDefaultForBusiness) throw failure(409, 'LINE_OA_ACCOUNT_ALREADY_DEFAULT')
        await clearDefault(tx, row.businessId, row.id)
        change.isDefaultForBusiness = true
        payload.from.isDefaultForBusiness = false
        payload.to.isDefaultForBusiness = true
        break
      }
      case 'SWITCH_TRANSPORT_MODE': {
        if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
        if (row.transportMode === data.transportMode) throw failure(409, 'LINE_OA_TRANSPORT_MODE_UNCHANGED')
        change.transportMode = data.transportMode
        payload.from.transportMode = row.transportMode
        payload.to.transportMode = data.transportMode
        // The shared epoch fence below cancels work issued to the old owner.
        if (data.transportMode === 'EDGE') change.serverEnabled = false
        break
      }
      case 'CONFIGURE_EXECUTION': {
        if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
        for (const key of ['executionMode', 'modelAccess', 'allowDelayedPush']) {
          change[key] = data[key]
          payload.from[key] = row[key]
          payload.to[key] = data[key]
        }
        break
      }
      case 'ENABLE_SERVER': {
        if (row.serverEnabled) throw failure(409, 'LINE_OA_SERVER_ALREADY_ENABLED')
        const validate = ports?.validateServerCredentials ?? (async () => {
          const sm = createServerLineSecretManagerFromEnv()
          return resolveServerLineAccount({
            accountId: row.id, db: tx, requireEnabled: false,
            secretManager: sm,
          })
        })
        if (!LINE_OA_ACCOUNT_STATUSES.filter(status => status !== 'ARCHIVED').includes(row.status) || row.transportMode !== 'CLOUD') throw failure(409, 'LINE_OA_SERVER_ACTIVATION_INVALID')
        await validate(row, { db: tx })
        change.serverEnabled = true
        change.status = 'CONNECTED'
        payload.to.serverEnabled = true
        payload.legacyQuiesced = data.legacyQuiesced
        break
      }
      case 'DISABLE_SERVER': {
        if (!row.serverEnabled) throw failure(409, 'LINE_OA_SERVER_ALREADY_DISABLED')
        change.serverEnabled = false
        payload.to.serverEnabled = false
        break
      }
      default:
        throw failure(400, 'LINE_OA_ACCOUNT_ACTION_UNKNOWN')
    }

    // An external send cannot be recalled. Resolve uncertain delivery before
    // handing ownership away; in-flight generation is cancelled by an epoch fence.
    const fencesWork = LINE_OA_ACCOUNT_ACTIONS.filter(action => action !== 'RESUME' && action !== 'SET_DEFAULT').includes(data.action)
    if (fencesWork) {
      change.transportEpoch = { increment: 1 }
      if (data.action === 'ARCHIVE') change.serverEnabled = false
    }
    const result = await tx.lineOaAccount.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...change, version: { increment: 1 } },
    })
    if (result.count !== 1) throw failure(409, 'LINE_OA_ACCOUNT_VERSION_CONFLICT')
    if (fencesWork) {
      // The account CAS above holds its row lock until commit. Send leases
      // lock this same row first, so the active-send check cannot race a send.
      const sending = await tx.lineConversationJob.count({ where: { accountId: row.id, OR: [{ status: { in: ['SENDING', 'UNKNOWN'] } }, { status: 'READY', firstSendAt: { not: null } }] } })
      if (sending) throw failure(409, 'LINE_OA_DELIVERY_RECONCILIATION_REQUIRED')
      const cancelled = await tx.lineConversationJob.updateMany({
        where: { accountId: row.id, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
        data: { status: 'CANCELLED', sealedReplyToken: null, claimantId: null, leaseExpiresAt: null },
      })
      payload.cancelledTransportJobs = cancelled.count
      payload.to.transportEpoch = row.transportEpoch + 1
    }

    await recordAudit(tx, {
      entityType: LINE_OA_ACCOUNT_ENTITY,
      entityId: row.id,
      action: ACTIONS[data.action],
      actorId: viewer?.principal?.id ?? null,
      payload: { ...payload, version: row.version + 1 },
    })
    return tx.lineOaAccount.findUnique({ where: { id: row.id }, select: SELECT })
  })

  const [dto] = await describe([updated], db, ports)
  return dto
}
