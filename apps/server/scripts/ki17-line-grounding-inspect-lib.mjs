// @req FR-235 — read-only inspection support for the per-account
//   `LineOaAccount.knowledgeGrounding` mode (ADR-090 D1) for an explicitly
//   authorized target. This module holds the pure, DB-free shaping
//   logic; `ki17-line-grounding-inspect.mjs` is the thin script that queries
//   Postgres and calls it.
// @spec ADR-090 D1, ADR-119 D1/D3 — retain generic inspection, without the
//   superseded SmartGift pilot or an implicit production authorization.
// @tested tests/unit/ki17-line-grounding-inspect-lib.test.js

import { z } from 'zod'
import { isIP } from 'node:net'

/**
 * Parse one explicit target without passing URL parameters through pg's TLS parser.
 * Known Supabase poolers are rejected. A custom hostname can still be a proxy;
 * the operator must verify that endpoint's directness and authorization separately.
 * Only an explicit loopback sslmode=disable permits plaintext fixture operation.
 */
export function resolveGroundingInspectionTarget(connectionString, { ca } = {}) {
  let url
  try { url = new URL(connectionString) } catch { throw new Error('DIRECT_URL must be an explicit PostgreSQL URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error('DIRECT_URL must be an explicit PostgreSQL URL without a fragment')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (/(?:^|\.)pooler\.supabase\.com$/i.test(host)) {
    throw new Error('DIRECT_URL must not use a Supabase pooler endpoint')
  }
  let user, password, database
  try {
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
    database = decodeURIComponent(url.pathname.slice(1))
  } catch { throw new Error('DIRECT_URL contains invalid URL encoding') }
  if (!user || !database) throw new Error('DIRECT_URL must explicitly name a database user and database')
  const port = Number(url.port || 5432)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DIRECT_URL has an invalid port')
  const modes = url.searchParams.getAll('sslmode')
  if (modes.length > 1 || [...url.searchParams.keys()].some((key) => key !== 'sslmode')) {
    throw new Error('DIRECT_URL only accepts one sslmode option; use KI17_GROUNDING_INSPECT_CA_FILE for a custom CA')
  }
  const sslmode = modes[0] || 'verify-full'
  const loopback = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'))
  if (!['require', 'verify-ca', 'verify-full'].includes(sslmode) && !(sslmode === 'disable' && loopback)) {
    throw new Error('DIRECT_URL TLS certificate verification is required; sslmode=disable is only allowed on loopback')
  }
  const ssl = sslmode === 'disable' ? false : {
    rejectUnauthorized: true,
    ...(isIP(host) ? {} : { servername: host }),
    ...(ca ? { ca } : {}),
  }
  return {
    clientConfig: { host, port, user, password, database, ssl },
    connectionTarget: { host, port, user, database, tlsMode: ssl ? 'VERIFY_FULL' : 'DISABLED_LOOPBACK' },
  }
}

/** The entity type and actions recorded by the mode and shadow writers
 * (`line-oa-account-service.js` `ACTIONS.CONFIGURE_KNOWLEDGE_GROUNDING` and
 * `CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW`). Matching `AuditEvent` rows use
 * `entityId = account.id`. */
export const KNOWLEDGE_GROUNDING_AUDIT_ENTITY_TYPE = 'LINE_OA_ACCOUNT'
export const KNOWLEDGE_GROUNDING_AUDIT_ACTION = 'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED'
export const KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION = 'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_SHADOW_CONFIGURED'
export const KNOWLEDGE_GROUNDING_AUDIT_ACTIONS = Object.freeze([
  KNOWLEDGE_GROUNDING_AUDIT_ACTION,
  KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION,
])

/**
 * `LineOaAccount` carries no stored "DIRECT account" flag. The design doc
 * (docs/plans/LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md §10.1
 * Phase 3, "switch one DIRECT LINE OA account") and ADR-090 D5 use "DIRECT" in
 * the `audienceKind` sense already recorded per `LineConversationJob`
 * (`DIRECT` | `GROUP` | `ROOM` — one-to-one chat vs. a LINE group/room), never
 * an account-level column. This constant documents that fact so a caller does
 * not go looking for a field that does not exist.
 */
export const DIRECT_ACCOUNT_NOTE =
  'LineOaAccount has no stored "DIRECT account" flag. "DIRECT" (ADR-090 D5, ' +
  'the design doc §10.1 Phase 3) names the audienceKind recorded per ' +
  'LineConversationJob (DIRECT | GROUP | ROOM — a 1:1 chat vs. a LINE group ' +
  'or room), not an account column. recentAudienceKindCounts / ' +
  'recentDirectJobShare below are a best-effort signal from recent job ' +
  'history, not an authoritative flag — an account with zero recent jobs ' +
  'reports null and needs a human judgment call, not a default.'

export const ACCOUNT_SELECTION_NOTE =
  'Business identities and DIRECT audience counts are descriptive evidence only. ' +
  'The operator must explicitly select the Business and account and verify authority; ' +
  'neither a name nor a traffic ratio grants permission or selects a target.'

const GroundingAuditEntrySchema = z.object({
  action: z.enum(KNOWLEDGE_GROUNDING_AUDIT_ACTIONS),
  occurredAt: z.union([z.string(), z.date()]).nullable(),
  actorId: z.string().nullable(),
  actorType: z.string().nullable(),
  reason: z.string().nullable(),
  from: z.union([z.string(), z.boolean()]).nullable(),
  to: z.union([z.string(), z.boolean()]).nullable(),
}).strict()

const GroundingInspectionAccountSchema = z.object({
  id: z.string(),
  code: z.string().nullish(),
  displayName: z.string().nullish(),
  status: z.string().nullish(),
  businessId: z.string().nullish(),
  businessCode: z.string().nullable(),
  businessName: z.string().nullable(),
  transportMode: z.string().nullable(),
  knowledgeGrounding: z.string().nullish(),
  runtimeOwner: z.string().nullable(),
  executionMode: z.string().nullable(),
  serverEnabled: z.boolean().nullable(),
  knowledgeGroundingShadow: z.boolean().nullable(),
  isDefaultForBusiness: z.boolean().nullable(),
  version: z.number().nullable(),
  updatedAt: z.union([z.string(), z.date()]).nullable(),
  recentAudienceKindCounts: z.record(z.number()),
  recentDirectJobShare: z.number().nullable(),
  knowledgeGroundingAuditLatestByAction: z.array(GroundingAuditEntrySchema),
}).strict()

/** Structured, versioned-by-fields contract for the read-only preflight JSON. */
export const GroundingInspectionReportSchema = z.object({
  mode: z.literal('READ_ONLY'),
  inspectionStatus: z.enum(['COMPLETE', 'INCOMPLETE']),
  generatedAt: z.string(),
  knowledgeGroundingAuditActions: z.tuple([
    z.literal(KNOWLEDGE_GROUNDING_AUDIT_ACTION),
    z.literal(KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION),
  ]),
  notes: z.array(z.string()),
  accounts: z.array(GroundingInspectionAccountSchema),
  queryFailures: z.record(z.string()).optional(),
  connectionSource: z.literal('DIRECT_URL').optional(),
  connectionTarget: z.object({
    host: z.string(), port: z.number().int().min(1).max(65535), user: z.string(), database: z.string(),
    tlsMode: z.enum(['VERIFY_FULL', 'DISABLED_LOOPBACK']),
  }).strict().optional(),
  audienceWindowDays: z.number().int().positive().optional(),
}).strict().superRefine((report, context) => {
  const hasQueryFailures = Object.keys(report.queryFailures ?? {}).length > 0
  if (report.inspectionStatus === 'INCOMPLETE' && !hasQueryFailures) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['queryFailures'], message: 'Incomplete reports must identify at least one failed required query' })
  }
  if (report.inspectionStatus === 'COMPLETE' && hasQueryFailures) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['inspectionStatus'], message: 'Reports with failed required queries cannot be complete' })
  }
})

/**
 * Rolls up `{accountId, audienceKind, count}` rows (one row per distinct
 * audienceKind per account, as the script's grouped query returns) into
 * `{[accountId]: {counts, totalJobs, directShare}}`. `directShare` is
 * `counts.DIRECT / totalJobs`, or `null` when there is no recent job at all —
 * never `0`, so a caller can tell "no evidence" apart from "measured zero".
 */
export function summarizeAudienceKindCounts(jobAudienceRows) {
  const byAccount = {}
  for (const row of jobAudienceRows ?? []) {
    const accountId = row?.accountId
    if (!accountId) continue
    const kind = typeof row.audienceKind === 'string' && row.audienceKind ? row.audienceKind : 'UNKNOWN'
    const count = Number.isFinite(row.count) ? row.count : Number(row.count) || 0
    if (!byAccount[accountId]) byAccount[accountId] = { counts: {}, totalJobs: 0 }
    byAccount[accountId].counts[kind] = (byAccount[accountId].counts[kind] ?? 0) + count
    byAccount[accountId].totalJobs += count
  }
  for (const summary of Object.values(byAccount)) {
    summary.directShare = summary.totalJobs > 0 ? (summary.counts.DIRECT ?? 0) / summary.totalJobs : null
  }
  return byAccount
}

function safeJsonParse(value) {
  if (value == null) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Shapes one `AuditEvent` row (already filtered by the caller's SQL to
 * `entityType = 'LINE_OA_ACCOUNT'` and one of the grounding action constants)
 * into an action-tagged entry, reading the matching mode or shadow field from
 * the `payloadJson.from` / `payloadJson.to` values written by
 * line-oa-account-service.js. Historical before/after snapshots remain a
 * fallback. Malformed JSON reads as `null` rather than throwing — this is an
 * inspection report.
 */
export function shapeGroundingAuditRow(row) {
  const payload = safeJsonParse(row?.payloadJson)
  const before = safeJsonParse(row?.beforeJson)
  const after = safeJsonParse(row?.afterJson)
  const field = row?.action === KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION
    ? 'knowledgeGroundingShadow'
    : 'knowledgeGrounding'
  return {
    action: row?.action,
    occurredAt: row?.occurredAt ?? null,
    actorId: row?.actorId ?? null,
    actorType: row?.actorType ?? null,
    reason: row?.reason ?? null,
    from: payload?.from?.[field] ?? before?.from?.[field] ?? before?.[field] ?? null,
    to: payload?.to?.[field] ?? after?.to?.[field] ?? after?.[field] ?? null,
  }
}

/**
 * Keeps the latest row per account/action pair. SQL ranks all matching rows
 * without a global limit; this defensive shaping also handles unsorted input.
 */
export function groupLatestGroundingAuditByAccount(auditRows) {
  const byAccount = {}
  const epoch = (value) => {
    const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
  }
  const sortedRows = [...(auditRows ?? [])].sort((a, b) =>
    (epoch(b?.occurredAt) - epoch(a?.occurredAt))
      || String(b?.id).localeCompare(String(a?.id)))
  for (const row of sortedRows) {
    const accountId = row?.entityId
    const action = row?.action
    if (!accountId || !KNOWLEDGE_GROUNDING_AUDIT_ACTIONS.includes(action)) continue
    if (!byAccount[accountId]) byAccount[accountId] = []
    if (!byAccount[accountId].some((entry) => entry.action === action)) {
      byAccount[accountId].push(shapeGroundingAuditRow(row))
    }
  }
  return byAccount
}

/**
 * Assembles the final read-only report from the three raw query result sets.
 * The descriptive inspection fields are on
 * one row per account: current mode, runtime owner and shadow state, the
 * account version, descriptive Business/audience evidence, and latest
 * mode/shadow audit events. Any failed required query marks the report
 * incomplete.
 */
export function buildGroundingInspectionReport({ accountRows, jobAudienceRows, auditRows, generatedAt, queryFailures = {} }) {
  const audienceByAccount = summarizeAudienceKindCounts(jobAudienceRows)
  const auditByAccount = groupLatestGroundingAuditByAccount(auditRows)
  const failures = queryFailures && typeof queryFailures === 'object' ? queryFailures : {}
  const failedQueryNames = Object.keys(failures)
  const accounts = (accountRows ?? []).map((row) => {
    const audience = audienceByAccount[row.id] ?? { counts: {}, totalJobs: 0, directShare: null }
    return {
      id: row.id,
      code: row.code,
      displayName: row.displayName,
      status: row.status,
      businessId: row.businessId,
      businessCode: row.businessCode ?? null,
      businessName: row.businessName ?? null,
      transportMode: row.transportMode ?? null,
      knowledgeGrounding: row.knowledgeGrounding,
      runtimeOwner: row.runtimeOwner ?? null,
      executionMode: row.executionMode ?? null,
      serverEnabled: row.serverEnabled ?? null,
      knowledgeGroundingShadow: row.knowledgeGroundingShadow ?? null,
      isDefaultForBusiness: row.isDefaultForBusiness ?? null,
      version: row.version ?? null,
      updatedAt: row.updatedAt ?? null,
      recentAudienceKindCounts: audience.counts,
      recentDirectJobShare: audience.directShare,
      knowledgeGroundingAuditLatestByAction: auditByAccount[row.id] ?? [],
    }
  })
  return GroundingInspectionReportSchema.parse({
    mode: 'READ_ONLY',
    inspectionStatus: failedQueryNames.length ? 'INCOMPLETE' : 'COMPLETE',
    generatedAt: generatedAt ?? new Date().toISOString(),
    knowledgeGroundingAuditActions: KNOWLEDGE_GROUNDING_AUDIT_ACTIONS,
    notes: [DIRECT_ACCOUNT_NOTE, ACCOUNT_SELECTION_NOTE,
      'COMPLETE means only that all required SELECT queries succeeded. It does not authorize a target, certify production readiness, or record a switch.',
      'connectionTarget describes the configured endpoint without credentials. Known Supabase poolers are rejected; custom endpoint directness remains an operator-verified fact.'],
    accounts,
    ...(failedQueryNames.length ? { queryFailures: failures } : {}),
  })
}
