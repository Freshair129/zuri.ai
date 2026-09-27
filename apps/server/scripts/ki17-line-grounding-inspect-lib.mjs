// @req FR-235 — read-only inspection support for the per-account
//   `LineOaAccount.knowledgeGrounding` mode (ADR-090 D1) ahead of the
//   TASK-ZAI-095 production switch. This module holds the pure, DB-free shaping
//   logic; `ki17-line-grounding-inspect.mjs` is the thin script that queries
//   Postgres and calls it.
// @spec ADR-090 D5 — SmartGift goes first; ADR-075 Phase 3 — the production
//   gate this inspection precedes, never performs.
// @tested tests/unit/ki17-line-grounding-inspect-lib.test.js

/**
 * The Business identity `readonly-supabase-preflight.mjs` already keys SmartGift
 * evidence on (`scripts/readonly-supabase-preflight.mjs` query `business_identity`).
 * Kept as a named export so a caller can override or extend the match without
 * editing this file.
 */
export const SMARTGIFT_BUSINESS_CODE = 'BUS-SMARTGIFT'
export const SMARTGIFT_BUSINESS_ID = '834fa869-62f3-431c-a287-e9a95e91175b'

/** entityType/action the CONFIGURE_KNOWLEDGE_GROUNDING writer records
 * (`line-oa-account-service.js` `ACTIONS.CONFIGURE_KNOWLEDGE_GROUNDING`,
 * `LINE_OA_ACCOUNT_ENTITY`). Any prior switch or rollback for an account is an
 * `AuditEvent` row matching these two fields with `entityId = account.id`. */
export const KNOWLEDGE_GROUNDING_AUDIT_ENTITY_TYPE = 'LINE_OA_ACCOUNT'
export const KNOWLEDGE_GROUNDING_AUDIT_ACTION = 'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED'

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

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * True when the account's Business is SmartGift, matched on `businessCode`
 * first (the stable identifier), falling back to `businessId` and then a
 * case-insensitive `businessName` match so the script still classifies
 * correctly if the code or id were ever reassigned. Never throws on missing
 * fields.
 */
export function isSmartGiftAccountRow(accountRow) {
  if (!accountRow || typeof accountRow !== 'object') return false
  if (accountRow.businessCode === SMARTGIFT_BUSINESS_CODE) return true
  if (accountRow.businessId === SMARTGIFT_BUSINESS_ID) return true
  return normalize(accountRow.businessName) === 'smartgift'
}

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
 * `entityType = 'LINE_OA_ACCOUNT'` and `action = KNOWLEDGE_GROUNDING_AUDIT_ACTION`)
 * into `{occurredAt, actorId, actorType, reason, from, to}`, reading the
 * `from.knowledgeGrounding` / `to.knowledgeGrounding` the service writes into
 * `beforeJson` / `afterJson` (`line-oa-account-service.js` `payload.from` /
 * `payload.to`). Malformed JSON reads as `null` rather than throwing — this is
 * a read-only report, not a correctness gate.
 */
export function shapeGroundingAuditRow(row) {
  const before = safeJsonParse(row?.beforeJson)
  const after = safeJsonParse(row?.afterJson)
  return {
    occurredAt: row?.occurredAt ?? null,
    actorId: row?.actorId ?? null,
    actorType: row?.actorType ?? null,
    reason: row?.reason ?? null,
    from: before?.from?.knowledgeGrounding ?? before?.knowledgeGrounding ?? null,
    to: after?.to?.knowledgeGrounding ?? after?.knowledgeGrounding ?? null,
  }
}

/**
 * Groups shaped audit rows by `entityId` (the account id), newest first. The
 * caller's SQL is expected to already sort by `occurredAt desc`; this function
 * re-sorts defensively so a caller passing unsorted rows still gets a correct
 * report.
 */
export function groupGroundingAuditHistoryByAccount(auditRows) {
  const byAccount = {}
  for (const row of auditRows ?? []) {
    const accountId = row?.entityId
    if (!accountId) continue
    if (!byAccount[accountId]) byAccount[accountId] = []
    byAccount[accountId].push(shapeGroundingAuditRow(row))
  }
  for (const history of Object.values(byAccount)) {
    history.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
  }
  return byAccount
}

/**
 * Assembles the final read-only report from the three raw query result sets.
 * Every field a human operator needs for the TASK-ZAI-095 preflight step is on
 * one row per account: current mode, which Business it belongs to, whether
 * that Business is SmartGift, a DIRECT-traffic heuristic, and any prior
 * CONFIGURE_KNOWLEDGE_GROUNDING switch (a rollback shows up here as a second
 * row whose `to` is `BUSINESS_KNOWLEDGE`).
 */
export function buildGroundingInspectionReport({ accountRows, jobAudienceRows, auditRows, generatedAt }) {
  const audienceByAccount = summarizeAudienceKindCounts(jobAudienceRows)
  const auditByAccount = groupGroundingAuditHistoryByAccount(auditRows)
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
      isSmartGiftBusiness: isSmartGiftAccountRow(row),
      knowledgeGrounding: row.knowledgeGrounding,
      executionMode: row.executionMode ?? null,
      serverEnabled: row.serverEnabled ?? null,
      isDefaultForBusiness: row.isDefaultForBusiness ?? null,
      version: row.version ?? null,
      updatedAt: row.updatedAt ?? null,
      recentAudienceKindCounts: audience.counts,
      recentDirectJobShare: audience.directShare,
      knowledgeGroundingAuditHistory: auditByAccount[row.id] ?? [],
    }
  })
  return {
    mode: 'READ_ONLY',
    generatedAt: generatedAt ?? new Date().toISOString(),
    smartGiftBusinessCode: SMARTGIFT_BUSINESS_CODE,
    knowledgeGroundingAuditAction: KNOWLEDGE_GROUNDING_AUDIT_ACTION,
    notes: [DIRECT_ACCOUNT_NOTE],
    accounts,
  }
}
