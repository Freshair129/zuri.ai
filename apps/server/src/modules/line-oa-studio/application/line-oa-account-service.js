import prisma from '@/lib/db'
import { LINE_OA_ACCOUNT_ACTIONS, LINE_OA_ACCOUNT_STATUSES } from '@/lib/validation/enums'
import { resolveServerLineAccount } from '@/platform/integrations/providers/line/server-line-transport'
import { createLineChannelAdminPort } from '@/platform/integrations/providers/line/line-channel-admin-port'
import { createLineSecretManagerFromEnv } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import { createPrismaRoleSql } from '@/platform/integrations/core/secret-store/supabase-vault-secret-store'
import { isPublicBaseUrlConfigured, resolvePublicBaseUrl } from '@/lib/public-base-url'
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
// @req FR-227, FR-228 — reuse FR-190's own pure webhook-URL and endpoint-match
// rules rather than a second copy: the account's expected native URL and a
// tolerant (trailing-slash/case) comparison are exactly what both REGISTER_WEBHOOK
// and ENABLE_SERVER's derived quiescence need.
import { expectedWebhookEndpoint, normalizeEndpoint } from '../domain/transport-health'
import { assertMayPublish, assertMayView, notFound } from './line-oa-account-authority'
import {
  admitLineStudioDescription,
  composeBotProfileDescription,
  lineStudioDescriptionSourceKey,
  withdrawLineStudioDescription,
} from './line-oa-studio-description-admission'

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
// @req FR-225 — `toHealth` also surfaces the credential's store, version and
//   last-validated time (metadata only) so the Studio card can offer the
//   mount-to-vault migration and a truthful credential status line.
// @req FR-238 — CONNECT admits the bot profile's composed description as a
//   LINE_STUDIO_DESCRIPTION TEXT source (ADR-090 D7); ARCHIVE withdraws it.
//   Both calls are best-effort through line-oa-studio-description-admission.js
//   and never fail this service's own write.
// @req FR-227 — REGISTER_WEBHOOK: set, read back and test the account's LINE
//   webhook endpoint through the LINE channel-admin port, storing the outcome
//   as computed health (`webhookStateJson`). Idempotent and retryable — it
//   resolves its own credential through the dispatching secret manager, so a
//   retry needs no secret re-entry. LINE's own refusals (URL rejected,
//   inactive toggle, failed test, signature mismatch) are recorded as health,
//   never thrown; only a call this port could not attempt at all throws.
// @req FR-228 — ENABLE_SERVER's legacy handoff is typed for a mount-backed
//   credential (unchanged) and derived for a vault-backed one (ADR-089 D8):
//   LINE's own last-registered webhook endpoint must equal this account's URL
//   and be active, no raw LINE evidence for the connection may have arrived
//   in the 120 s window ending at (and excluding) that registration's own
//   timestamp, and the registration itself must be at least 120 s old — or it
//   refuses 409 LINE_LEGACY_TRANSPORT_ACTIVE naming the last pre-cutover
//   receipt time. Evidence at or after the registration is proof the cutover
//   worked and never blocks — anchoring to "now" instead would let a busy,
//   already-cutover account's own traffic block it forever (fixed on
//   review). The epoch fence, the SENDING/UNKNOWN refusal and the version
//   check are unchanged (ADR-061 D3, D7).
// @spec ADR-089 D5, D7, D8; SEC-030
// @tested tests/integration/fr146-line-oa-account.test.js, tests/integration/fr225-line-oa-self-serve-onboarding.test.js, tests/integration/fr238-line-studio-description-admission.test.js,
//   tests/integration/fr227-line-oa-webhook-registration.test.js, tests/integration/fr228-line-oa-legacy-quiescence.test.js

const ACTIONS = Object.freeze({
  ENABLE_SERVER: 'LINE_OA_SERVER_ENABLED',
  DISABLE_SERVER: 'LINE_OA_SERVER_DISABLED',
  CONFIGURE_EXECUTION: 'LINE_OA_EXECUTION_CONFIGURED',
  PAUSE: 'LINE_OA_ACCOUNT_PAUSED',
  RESUME: 'LINE_OA_ACCOUNT_RESUMED',
  ARCHIVE: 'LINE_OA_ACCOUNT_ARCHIVED',
  SET_DEFAULT: 'LINE_OA_ACCOUNT_DEFAULT_SET',
  CONFIGURE_KNOWLEDGE_GROUNDING: 'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED',
  REGISTER_WEBHOOK: 'LINE_OA_ACCOUNT_WEBHOOK_REGISTERED',
  // @req FR-243 — the conversation session idle timeout (ADR-094 D3).
  CONFIGURE_SESSION_TIMEOUT: 'LINE_OA_ACCOUNT_SESSION_TIMEOUT_CONFIGURED',
  // @req FR-244 — business hours and the out-of-hours reply (ADR-094 D6 option A).
  CONFIGURE_BUSINESS_HOURS: 'LINE_OA_ACCOUNT_BUSINESS_HOURS_CONFIGURED',
})

function failure(status, message, extra = {}) {
  const error = new Error(message)
  error.status = status
  Object.assign(error, extra)
  return error
}

/**
 * The account's own webhook health, or `null` on any doubt (FR-227, SEC-030).
 * The column is TEXT rather than a database JSON type, so this is the read-side
 * security boundary: a restore or repair must not turn arbitrary persisted keys
 * into health-response fields.
 */
function parseWebhookState(json) {
  if (typeof json !== 'string' || !json) return null
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

    const allowed = ['endpoint', 'active', 'lastTestAt', 'lastTestReason', 'lastTestStatusCode']
    if (Object.keys(parsed).some(key => !allowed.includes(key))) return null
    if (typeof parsed.endpoint !== 'string' || !parsed.endpoint) return null
    if (typeof parsed.active !== 'boolean') return null
    if (typeof parsed.lastTestAt !== 'string' || !parsed.lastTestAt) return null
    if (typeof parsed.lastTestReason !== 'string' || !parsed.lastTestReason) return null
    if (parsed.lastTestStatusCode !== null && !Number.isInteger(parsed.lastTestStatusCode)) return null

    return {
      endpoint: parsed.endpoint,
      active: parsed.active,
      lastTestAt: parsed.lastTestAt,
      lastTestReason: parsed.lastTestReason,
      lastTestStatusCode: parsed.lastTestStatusCode,
    }
  } catch {
    return null
  }
}

/**
 * Set, read back and test the account's LINE webhook endpoint (FR-227, design
 * §5.1, §5.5). Never throws for an outcome LINE itself reported — a refused
 * URL, an inactive toggle, a failed test and a signature mismatch are all
 * answers, not exceptions — so the caller can always persist what actually
 * happened; only a LINE call this port could not attempt at all throws, via
 * the same admin-port error codes callers already know (LINE_UNAVAILABLE,
 * LINE_CREDENTIALS_REJECTED).
 *
 * @returns {Promise<{endpoint: string, active: boolean, lastTestAt: string,
 *   lastTestReason: string, lastTestStatusCode: number|null}>}
 */
async function registerWebhookOutcome({ accountId, accessToken, endpoint, lineAdmin, now }) {
  const nowIso = () => now().toISOString()
  try {
    await lineAdmin.setWebhookEndpoint({ accessToken, endpoint })
  } catch (error) {
    // The PUT itself was refused — nothing to read back or test yet, but the
    // endpoint we tried is exactly what the manual card needs (design §5.4).
    if (error?.code === 'LINE_WEBHOOK_SET_FAILED') {
      return { endpoint, active: false, lastTestAt: nowIso(), lastTestReason: 'LINE_WEBHOOK_SET_FAILED', lastTestStatusCode: null }
    }
    throw error
  }

  const read = await lineAdmin.getWebhookEndpoint({ accessToken })
  if (!read.active) {
    return { endpoint: read.endpoint ?? endpoint, active: false, lastTestAt: nowIso(), lastTestReason: 'LINE_WEBHOOK_INACTIVE', lastTestStatusCode: null }
  }

  const test = await lineAdmin.testWebhookEndpoint({ accessToken, endpoint })
  return {
    endpoint: read.endpoint ?? endpoint,
    active: true,
    lastTestAt: test.testedAt ?? nowIso(),
    lastTestReason: test.code,
    lastTestStatusCode: test.statusCode,
  }
}

/** The credentials needed to call LINE's admin API for one account (FR-227). No
 * secret ever leaves this function — only the minted, short-lived access token
 * `resolveServerLineAccount` already exposes non-enumerably for one call.
 */
async function defaultResolveWebhookCredential(row, { db }) {
  const secretManager = createLineSecretManagerFromEnv(process.env, { db, sql: createPrismaRoleSql(db) })
  const account = await resolveServerLineAccount({ accountId: row.id, db, requireEnabled: false, secretManager })
  return account.channelAccessToken
}

/**
 * ADR-089 D8: whether a vault-backed account may enable server ownership with
 * no typed confirmation.
 *
 * Once REGISTER_WEBHOOK's `PUT` succeeds, LINE only ever delivers to the
 * newly-registered URL from that instant on — the cutover is structural, not
 * probabilistic. So `RawExternalRecord` evidence timestamped **at or after**
 * that registration is proof the cutover worked (native traffic), never a
 * reason to refuse; only evidence strictly **before** it can be a straggler
 * from whatever owned the webhook previously. An earlier version of this
 * function anchored its 120 s window to "now" instead of to the
 * registration, which meant a busy, already-cutover account kept producing
 * exactly the evidence that blocked it — the busier (more genuinely
 * quiesced-from-legacy) the account, the less likely it could ever enable.
 * Fixed 2026-09-14 on review.
 *
 * Three facts, all required:
 *
 *   1. LINE's own webhook endpoint (as REGISTER_WEBHOOK last read it back,
 *      FR-227) equals this server's account URL, and was reported active.
 *   2. No raw evidence for this account's connection arrived in the 120 s
 *      window ending at (and excluding) that registration's own timestamp.
 *   3. The registration itself is at least 120 s old by wall clock — a
 *      message already in flight before the `PUT` can still land a moment
 *      after it succeeds, so a same-instant retry must not race that
 *      straggler by trusting a registration that just happened.
 *
 * Caveat honestly recorded here, not only in the report: `RawExternalRecord`
 * does not carry a field naming which ingress seam captured it (the legacy
 * `/api/agent/line-webhook` route and the native
 * `/api/line-oa/accounts/{id}/webhook` route write through the identical
 * recorder). Fact 2 is therefore "no evidence at all in the pre-registration
 * window", stricter than "no *legacy* evidence" there — but bounded to
 * before the cutover, so it no longer double-counts the account's own later
 * success as a reason to refuse it.
 */
async function defaultDeriveLegacyQuiescence(row, { db, env = process.env, now = () => new Date() } = {}) {
  const webhookState = parseWebhookState(row.webhookStateJson)
  const expectedEndpoint = expectedWebhookEndpoint({ baseUrl: resolvePublicBaseUrl(env), accountId: row.id })
  const endpointMatches = Boolean(webhookState) && webhookState.active === true
    && normalizeEndpoint(webhookState.endpoint) === normalizeEndpoint(expectedEndpoint)

  if (!endpointMatches) {
    // No successful registration to anchor a cutover on: any evidence at all
    // for this connection is unexplained by this account's own traffic, so
    // the most recent is reported as the last legacy receipt time.
    const recent = await db.rawExternalRecord.findFirst({
      where: { connectionId: row.integrationConnectionId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    return { quiesced: false, lastLegacyReceiptAt: recent?.createdAt ? recent.createdAt.toISOString() : null }
  }

  const registeredAt = new Date(webhookState.lastTestAt)
  if (!Number.isFinite(registeredAt.getTime())) {
    // A malformed timestamp proves nothing (fail closed).
    return { quiesced: false, lastLegacyReceiptAt: null }
  }

  const windowStart = new Date(registeredAt.getTime() - 120_000)
  const priorEvidence = await db.rawExternalRecord.findFirst({
    where: { connectionId: row.integrationConnectionId, createdAt: { gte: windowStart, lt: registeredAt } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (priorEvidence) return { quiesced: false, lastLegacyReceiptAt: priorEvidence.createdAt.toISOString() }

  if (now().getTime() - registeredAt.getTime() < 120_000) {
    // The registration has not yet stood for a full quiescence window — no
    // evidence names a specific straggler, so none is reported.
    return { quiesced: false, lastLegacyReceiptAt: null }
  }

  return { quiesced: true, lastLegacyReceiptAt: null }
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
  modelAccess: true, allowDelayedPush: true, transportEpoch: true, knowledgeGrounding: true,
  webhookStateJson: true, sessionIdleTimeoutMinutes: true,
  businessHoursOpen: true, businessHoursClose: true, outOfHoursReplyText: true,
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
        // @req FR-225 — carried through so the account card can offer "move into
        // Vault" only for a DEPLOYMENT_MOUNT-backed credential, and can show the
        // credential status line (version, last validated) without a second read
        // of the integration lane's tables (SEC-030: no material, metadata only).
        secretStore: connection.secretStore ?? null,
        credentialVersion: connection.credentialVersion ?? null,
        displayHint: connection.displayHint ?? null,
        lastValidatedAt: connection.lastValidatedAt ?? null,
      }
      : null,
    binding: {
      code: row.bindingCode,
      status: bindingStatus ?? 'UNKNOWN',
    },
    // @req FR-227 — the account's own computed webhook health, from the last
    // REGISTER_WEBHOOK run. `null` (never a guessed default) until a
    // publisher has run it at least once for this account.
    webhook: parseWebhookState(row.webhookStateJson),
    transportJobs,
    quota: null,
    sources: {
      connection: 'integration read model (FR-080) — computed, never stored',
      binding: BINDING_SOURCES[bindingStatus ?? 'UNKNOWN'] ?? BINDING_SOURCES.UNKNOWN,
      webhook: 'LineOaAccount.webhookStateJson — written only by REGISTER_WEBHOOK, from what LINE reported (FR-227)',
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
    knowledgeGrounding: row.knowledgeGrounding,
    sessionIdleTimeoutMinutes: row.sessionIdleTimeoutMinutes,
    // @req FR-244 — null on all three reads as "no declared hours".
    businessHoursOpen: row.businessHoursOpen,
    businessHoursClose: row.businessHoursClose,
    outOfHoursReplyText: row.outOfHoursReplyText,
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

  // @req FR-238 — the bot profile has no separate "publish" verb of its own
  // (it is written once, at connect); CONNECT is the publisher action ADR-090
  // D7 means for it. Best-effort and after the account's own transaction has
  // committed, exactly like FR-236's candidate admission call.
  await admitLineStudioDescription({
    businessId: created.businessId,
    sourceKey: lineStudioDescriptionSourceKey.botProfile(created.id),
    version: created.version,
    title: `Bot profile: ${created.displayName}`,
    content: composeBotProfileDescription(data.botProfile ?? {}),
  }, { db })

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
      // @req FR-265 — `SWITCH_TRANSPORT_MODE` is withdrawn (ADR-100 D1); the
      // action no longer exists in the vocabulary, so there is no case for it.
      // @req FR-265 — `CONFIGURE_EXECUTION` writes only the delivery choice now.
      // It still fences queued work, exactly as it did when it also carried the
      // execution placement: `allowDelayedPush` decides whether a job whose reply
      // token died may still be pushed, so a job already waiting on the old
      // answer must not be completed under the new policy.
      case 'CONFIGURE_EXECUTION': {
        if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
        change.allowDelayedPush = data.allowDelayedPush
        payload.from.allowDelayedPush = row.allowDelayedPush
        payload.to.allowDelayedPush = data.allowDelayedPush
        break
      }
      // @req FR-235 — the publisher's grounding-mode switch (ADR-090 D1).
      // Nothing reads a corpus until this write happens; the row default
      // (BUSINESS_KNOWLEDGE) is set at account creation and never overridden here.
      case 'CONFIGURE_KNOWLEDGE_GROUNDING': {
        if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
        if (row.knowledgeGrounding === data.knowledgeGrounding) throw failure(409, 'LINE_OA_KNOWLEDGE_GROUNDING_UNCHANGED')
        change.knowledgeGrounding = data.knowledgeGrounding
        payload.from.knowledgeGrounding = row.knowledgeGrounding
        payload.to.knowledgeGrounding = data.knowledgeGrounding
        break
      }
      // @req FR-243 — the conversation session idle timeout (ADR-094 D3). It decides
      // only where the next message's session starts, so it is health-only like the
      // grounding switch and never fences queued work.
      case 'CONFIGURE_SESSION_TIMEOUT': {
        if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
        if (row.sessionIdleTimeoutMinutes === data.sessionIdleTimeoutMinutes) throw failure(409, 'LINE_OA_SESSION_TIMEOUT_UNCHANGED')
        change.sessionIdleTimeoutMinutes = data.sessionIdleTimeoutMinutes
        payload.from.sessionIdleTimeoutMinutes = row.sessionIdleTimeoutMinutes
        payload.to.sessionIdleTimeoutMinutes = data.sessionIdleTimeoutMinutes
        break
      }
      // @req FR-244 — business hours and the out-of-hours reply (ADR-094 D6 option
      // A). Health-only like the timeout and grounding switches above: it decides
      // whether the *next* message gets a model answer or the canned one, and
      // never touches work already queued.
      case 'CONFIGURE_BUSINESS_HOURS': {
        if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
        const next = data.clearBusinessHours
          ? { businessHoursOpen: null, businessHoursClose: null, outOfHoursReplyText: null }
          : { businessHoursOpen: data.businessHoursOpen, businessHoursClose: data.businessHoursClose, outOfHoursReplyText: data.outOfHoursReplyText }
        const unchanged = row.businessHoursOpen === next.businessHoursOpen
          && row.businessHoursClose === next.businessHoursClose
          && row.outOfHoursReplyText === next.outOfHoursReplyText
        if (unchanged) throw failure(409, 'LINE_OA_BUSINESS_HOURS_UNCHANGED')
        Object.assign(change, next)
        payload.from.businessHours = { open: row.businessHoursOpen, close: row.businessHoursClose }
        payload.to.businessHours = { open: next.businessHoursOpen, close: next.businessHoursClose }
        break
      }
      case 'ENABLE_SERVER': {
        if (row.serverEnabled) throw failure(409, 'LINE_OA_SERVER_ALREADY_ENABLED')
        // @req FR-265 — the `transportMode !== 'CLOUD'` half of this guard can no
        // longer be false through any supported path (ADR-100 D1). It is kept
        // rather than deleted because a row restored from a pre-ADR-100 snapshot
        // or a hand-edited database can still carry EDGE, and activation is the
        // one place that must refuse it rather than assume it away.
        if (!LINE_OA_ACCOUNT_STATUSES.filter(status => status !== 'ARCHIVED').includes(row.status) || row.transportMode !== 'CLOUD') throw failure(409, 'LINE_OA_SERVER_ACTIVATION_INVALID')

        // @req FR-228 — whether the legacy handoff is typed or derived depends on
        // where this account's credential lives (ADR-089 D8): a mount-backed
        // account keeps the exact behaviour it always had (D7 unchanged); a
        // vault-backed account derives it instead of asking a person to type it,
        // because automatic webhook replacement (FR-227) already did the one
        // thing the typed checkbox used to stand in for.
        const credential = await tx.integrationCredential.findUnique({
          where: { connectionId: row.integrationConnectionId },
          select: { secretStore: true },
        })
        const mountBacked = (credential?.secretStore ?? 'DEPLOYMENT_MOUNT') === 'DEPLOYMENT_MOUNT'
        if (mountBacked) {
          if (data.legacyQuiesced !== true) throw failure(409, 'LINE_OA_LEGACY_CONFIRMATION_REQUIRED')
          payload.legacyQuiescenceSource = 'TYPED_CONFIRMATION'
        } else {
          const deriveQuiescence = ports?.deriveLegacyQuiescence ?? defaultDeriveLegacyQuiescence
          const quiescence = await deriveQuiescence(row, { db: tx, now: ports?.now ?? (() => new Date()) })
          if (!quiescence.quiesced) throw failure(409, 'LINE_LEGACY_TRANSPORT_ACTIVE', { lastLegacyReceiptAt: quiescence.lastLegacyReceiptAt })
          payload.legacyQuiescenceSource = 'DERIVED'
          payload.lastLegacyReceiptAt = quiescence.lastLegacyReceiptAt
        }

        // SDD-097: validation resolves through the dispatching secret manager, so a
        // vault-backed credential validates the same way a mounted one does.
        const validate = ports?.validateServerCredentials ?? (async () => {
          // Envelope reads join this transaction (SQLite has one connection); a Vault
          // call opens its own role-scoped transaction on the shared client.
          const sm = createLineSecretManagerFromEnv(process.env, { db: tx, sql: createPrismaRoleSql(db) })
          return resolveServerLineAccount({
            accountId: row.id, db: tx, requireEnabled: false,
            secretManager: sm,
          })
        })
        await validate(row, { db: tx })
        change.serverEnabled = true
        change.status = 'CONNECTED'
        payload.to.serverEnabled = true
        payload.legacyQuiesced = true
        break
      }
      // @req FR-227 — set, read back and test the account's LINE webhook
      // endpoint; store the outcome as computed health. Idempotent and
      // retryable: it re-derives the credential and re-calls LINE every time,
      // so a retry needs no secret re-entry (ADR-089 D7). Never fences work:
      // it changes no credential, transport owner or execution policy.
      case 'REGISTER_WEBHOOK': {
        if (row.status === 'ARCHIVED') throw failure(409, 'LINE_OA_ACCOUNT_ARCHIVED')
        if (!isPublicBaseUrlConfigured(process.env)) throw failure(503, 'PUBLIC_BASE_URL_NOT_CONFIGURED')

        const resolveCredential = ports?.resolveWebhookCredential ?? defaultResolveWebhookCredential
        const accessToken = await resolveCredential(row, { db: tx })
        const endpoint = expectedWebhookEndpoint({ baseUrl: resolvePublicBaseUrl(process.env), accountId: row.id })
        const lineAdmin = ports?.lineAdmin ?? createLineChannelAdminPort()
        const now = ports?.now ?? (() => new Date())

        const outcome = await registerWebhookOutcome({ accountId: row.id, accessToken, endpoint, lineAdmin, now })
        change.webhookStateJson = JSON.stringify(outcome)
        payload.webhook = outcome
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
    // @req FR-235 — CONFIGURE_KNOWLEDGE_GROUNDING never fences. It changes
    // neither the transport, the credential nor execution permission (the
    // things the epoch fence protects, by cancelling QUEUED/CLAIMED/READY
    // jobs so an old owner cannot deliver after a handoff) — it only changes
    // which evidence source the NEXT answer reads. Fencing it would silently
    // cancel replies customers are already waiting for on every mode switch;
    // the mode a job answered with is read live and recorded on that job's
    // own EVIDENCE_SELECTED trace instead (line-knowledge-grounding.js).
    // @req FR-227 — REGISTER_WEBHOOK joins CONFIGURE_KNOWLEDGE_GROUNDING as a
    // health-only write: it changes no credential, transport owner or
    // execution policy, so fencing it would cancel replies customers are
    // already waiting for every time a publisher re-checks webhook health.
    const fencesWork = LINE_OA_ACCOUNT_ACTIONS.filter(action => action !== 'RESUME' && action !== 'SET_DEFAULT' && action !== 'CONFIGURE_KNOWLEDGE_GROUNDING' && action !== 'REGISTER_WEBHOOK' && action !== 'CONFIGURE_SESSION_TIMEOUT' && action !== 'CONFIGURE_BUSINESS_HOURS').includes(data.action)
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
        data: { status: 'CANCELLED', sealedReplyToken: null, claimantId: null, leaseExpiresAt: null, version: { increment: 1 } },
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

  // @req FR-238 — ARCHIVE is the bot profile's unpublish: withdraw whatever
  // description was admitted at CONNECT. Best-effort, after commit; a no-op
  // when nothing was ever admitted (knowledge disabled at connect time).
  if (data.action === 'ARCHIVE') {
    await withdrawLineStudioDescription({
      businessId: updated.businessId,
      sourceKey: lineStudioDescriptionSourceKey.botProfile(updated.id),
    }, { db })
  }

  const [dto] = await describe([updated], db, ports)
  return dto
}

/**
 * @req FR-223 — revoking a credential fences the account it serves (ADR-089 D5,
 *   ADR-061 D7): server ownership ends, the transport epoch moves so every lease
 *   already issued is stale, and queued work is cancelled. A send already in
 *   flight is not recalled; it fails closed at its next resolution, because the
 *   credential no longer resolves. The Integration lane calls this before it
 *   revokes, so a store failure afterwards leaves the account stopped, not live.
 * @tested tests/integration/credential-vault-lifecycle.test.js
 */
export async function fenceLineOaAccountForCredentialRevocation({ tenantId, businessId, connectionId, actorId = null, db = prisma } = {}) {
  return db.$transaction(async (tx) => {
    const row = await tx.lineOaAccount.findFirst({
      where: { integrationConnectionId: connectionId, tenantId, businessId },
      select: { id: true, version: true, transportEpoch: true, serverEnabled: true },
    })
    if (!row) return { fenced: false }
    const moved = await tx.lineOaAccount.updateMany({
      where: { id: row.id, version: row.version },
      data: { serverEnabled: false, transportEpoch: { increment: 1 }, version: { increment: 1 } },
    })
    if (moved.count !== 1) throw failure(409, 'LINE_OA_ACCOUNT_VERSION_CONFLICT')
    const cancelled = await tx.lineConversationJob.updateMany({
      where: { accountId: row.id, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
      data: { status: 'CANCELLED', sealedReplyToken: null, claimantId: null, leaseExpiresAt: null, version: { increment: 1 } },
    })
    await recordAudit(tx, {
      entityType: LINE_OA_ACCOUNT_ENTITY,
      entityId: row.id,
      action: 'LINE_OA_ACCOUNT_CREDENTIAL_REVOKED_FENCED',
      actorId,
      businessId,
      payload: {
        from: { serverEnabled: row.serverEnabled, transportEpoch: row.transportEpoch },
        to: { serverEnabled: false, transportEpoch: row.transportEpoch + 1 },
        cancelledTransportJobs: cancelled.count,
        version: row.version + 1,
      },
    })
    return { fenced: true, accountId: row.id, transportEpoch: row.transportEpoch + 1, cancelledTransportJobs: cancelled.count }
  }, { timeout: 15000, maxWait: 5000 })
}
