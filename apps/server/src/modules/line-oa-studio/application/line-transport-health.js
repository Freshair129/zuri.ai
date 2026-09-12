import prisma from '@/lib/db'
import { assertMayView, notFound } from './line-oa-account-authority'
import { resolvePublicBaseUrl } from '@/lib/public-base-url'
import {
  createServerLineSecretManagerFromEnv,
  resolveServerLineAccount,
} from '@/platform/integrations/providers/line/server-line-transport'
import {
  classifySilence, classifyEndpoint, expectedWebhookEndpoint, monitoringExclusion,
  QUIET_AFTER_MS, SILENT_AFTER_MS, ENDPOINT_PROBE_TTL_MS,
} from '../domain/transport-health'

// @req FR-190 — a serverEnabled LINE account reports how long it has been silent
//   and whether LINE still delivers to this deployment's own route. Read-only:
//   states, timestamps and durations, never channel credentials and never the
//   contents of whatever other endpoint LINE is configured with.
// @spec ADR-061, SEC-001 — observes the server-owned transport; never rewrites
//   provider configuration, because taking a channel back is an owner action.
// @tested tests/unit/fr190-line-transport-health.test.js

const LINE_ENDPOINT_URL = 'https://api.line.me/v2/bot/channel/webhook/endpoint'
const PROBE_TIMEOUT_MS = 10_000

/** Process-local, so an hourly probe stays hourly per container and needs no table. */
const probeCache = new Map()

/**
 * Read one account's transport health.
 *
 * The endpoint probe is the expensive half — it leaves the building and LINE
 * rate-limits per channel — so it is cached for an hour (owner decision
 * 2026-09-12) and every failure degrades to UNKNOWN rather than failing the read.
 * Silence is derived from rows that already exist; nothing here writes.
 */
export async function readLineTransportHealth(accountId, {
  viewer,
  db = prisma,
  env = process.env,
  now = new Date(),
  fetchImpl = globalThis.fetch,
  cache = probeCache,
  ttlMs = ENDPOINT_PROBE_TTL_MS,
  quietAfterMs = QUIET_AFTER_MS,
  silentAfterMs = SILENT_AFTER_MS,
} = {}) {
  const account = await db.lineOaAccount.findUnique({ where: { id: accountId } })
  if (!account) throw notFound()
  assertMayView(viewer, account.businessId)

  const exclusion = monitoringExclusion(account)
  if (exclusion) {
    return {
      accountId: account.id,
      monitored: false,
      reason: exclusion,
      accountStatus: account.status,
      serverEnabled: account.serverEnabled === true,
      checkedAt: now.toISOString(),
    }
  }

  const [silence, endpoint] = await Promise.all([
    readSilence({ account, db, now, quietAfterMs, silentAfterMs }),
    readEndpoint({ account, db, env, now, fetchImpl, cache, ttlMs }),
  ])

  return {
    accountId: account.id,
    monitored: true,
    checkedAt: now.toISOString(),
    transportEnabled: env.ZURI_LINE_SERVER_ENABLED === 'true',
    silence,
    endpoint,
  }
}

/**
 * Sweep every monitored account, log one line per account that is not OK.
 *
 * The worker tick calls this at most hourly. It returns counts rather than the
 * findings themselves: the caller is a bounded operational endpoint, not a
 * reporting surface, and the detail belongs in the log line an operator greps.
 */
export async function sweepLineTransportHealth({
  db = prisma,
  env = process.env,
  now = new Date(),
  fetchImpl = globalThis.fetch,
  cache = probeCache,
  ttlMs = ENDPOINT_PROBE_TTL_MS,
  log = line => console.log(JSON.stringify(line)),
} = {}) {
  const accounts = await db.lineOaAccount.findMany({
    where: { serverEnabled: true, status: 'CONNECTED', archivedAt: null },
    select: { id: true, businessId: true, status: true, serverEnabled: true, archivedAt: true, createdAt: true, updatedAt: true },
  })
  let warned = 0
  for (const account of accounts) {
    let silence, endpoint
    try {
      ;[silence, endpoint] = await Promise.all([
        readSilence({ account, db, now }),
        readEndpoint({ account, db, env, now, fetchImpl, cache, ttlMs }),
      ])
    } catch {
      // One unreadable account must not end the sweep for the others.
      continue
    }
    if (silence.state === 'OK' && endpoint.state === 'MATCHED') continue
    warned += 1
    log({
      event: 'line.transport.health',
      level: 'warning',
      accountId: account.id,
      silence: silence.state,
      silentForMinutes: silence.ageMs == null ? null : Math.round(silence.ageMs / 60000),
      endpoint: endpoint.state,
      ...(endpoint.reason ? { endpointReason: endpoint.reason } : {}),
      transportEnabled: env.ZURI_LINE_SERVER_ENABLED === 'true',
    })
  }
  return { scanned: accounts.length, warned }
}

async function readSilence({ account, db, now, quietAfterMs = QUIET_AFTER_MS, silentAfterMs = SILENT_AFTER_MS }) {
  // Inbound deliveries are already durable as raw external records — the write
  // FR-149 acknowledges LINE with — so silence needs no new column and no
  // migration. The newest one, by the time the provider event arrived.
  const newest = await db.rawExternalRecord.aggregate({
    _max: { receivedAt: true },
    where: { connectionId: account.integrationConnectionId },
  })
  const silence = classifySilence({
    lastInboundAt: newest?._max?.receivedAt ?? null,
    activeSince: account.updatedAt ?? account.createdAt ?? null,
    now,
    quietAfterMs,
    silentAfterMs,
  })
  return {
    ...silence,
    ageMinutes: silence.ageMs == null ? null : Math.round(silence.ageMs / 60000),
    thresholds: { quietMinutes: Math.round(quietAfterMs / 60000), silentMinutes: Math.round(silentAfterMs / 60000) },
  }
}

async function readEndpoint({ account, db, env, now, fetchImpl, cache, ttlMs }) {
  const expected = expectedWebhookEndpoint({ baseUrl: resolvePublicBaseUrl(env), accountId: account.id })
  const cached = cache.get(account.id)
  const fresh = cached && now.getTime() - cached.at < ttlMs ? cached.probe : null
  const probe = fresh ?? (await probeConfiguredEndpoint({ account, db, env, fetchImpl }))
  if (!fresh) cache.set(account.id, { at: now.getTime(), probe })

  const state = classifyEndpoint({
    configured: probe.configured,
    expected,
    active: probe.active,
    probeFailed: probe.failed === true,
  })
  return {
    state,
    expectedEndpoint: expected,
    checkedAt: new Date(fresh ? cached.at : now.getTime()).toISOString(),
    ...(probe.reason ? { reason: probe.reason } : {}),
  }
}

/**
 * Ask LINE which endpoint it has for this channel.
 *
 * Every failure is a reason string, never an exception: an unreachable provider
 * is a fact about the check, not about the account, and it must not turn a
 * health read into a 500. The token is used and dropped — it never enters the
 * returned value, the cache or the log.
 */
async function probeConfiguredEndpoint({ account, db, env, fetchImpl }) {
  if (env.ZURI_LINE_SERVER_ENABLED !== 'true') return { failed: true, reason: 'TRANSPORT_DISABLED' }
  if (typeof fetchImpl !== 'function') return { failed: true, reason: 'FETCH_UNAVAILABLE' }
  let token
  try {
    const secretManager = createServerLineSecretManagerFromEnv(env)
    const resolved = await resolveServerLineAccount({ accountId: account.id, db, secretManager })
    token = resolved.channelAccessToken
  } catch {
    return { failed: true, reason: 'CREDENTIAL_UNAVAILABLE' }
  }
  try {
    const response = await fetchImpl(LINE_ENDPOINT_URL, {
      method: 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) return { failed: true, reason: `PROVIDER_${response.status}` }
    const body = await response.json()
    return { configured: typeof body?.endpoint === 'string' ? body.endpoint : null, active: body?.active === true }
  } catch {
    return { failed: true, reason: 'PROVIDER_UNREACHABLE' }
  }
}
