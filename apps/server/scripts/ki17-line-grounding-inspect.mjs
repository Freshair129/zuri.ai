#!/usr/bin/env node
// @req FR-235 — read-only preflight for the TASK-ZAI-095 production switch:
//   lists every LineOaAccount's current `knowledgeGrounding` mode, its
//   Business, whether that Business is SmartGift, a best-effort DIRECT-traffic
//   signal, and any prior CONFIGURE_KNOWLEDGE_GROUNDING switch/rollback
//   history. Performs no write of any kind — modelled on
//   `scripts/readonly-supabase-preflight.mjs` (same connection convention, same
//   named-query-with-per-query-failure report shape).
// @spec ADR-090 D5 — SmartGift goes first, after ADR-075 Phase 3; ADR-057 —
//   production reads/writes go through DIRECT_URL, never the pooler role,
//   which this repo's migration notes record as missing some grants.
// @tested tests/unit/ki17-line-grounding-inspect-lib.test.js (the shaping
//   logic), tests/unit/ki17-line-grounding-inspect-script.test.js (this
//   script's shape: read-only, DIRECT_URL-first, no mutation).
//
// Usage: DIRECT_URL=... node scripts/ki17-line-grounding-inspect.mjs [output.json]
// Docs: docs/runbooks/TASK-ZAI-095-GROUNDING-SWITCH.md — the operator runbook
//   this script is the pre-flight step of. Run this before touching any
//   account's grounding mode, not only before the eventual production switch.

import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { buildGroundingInspectionReport } from './ki17-line-grounding-inspect-lib.mjs'

const { Pool } = pg
// @spec ADR-057 — DIRECT_URL first, DATABASE_URL (the pooler) only as a
//   fallback; docs/DB-MIGRATION-NOTES.md and readonly-supabase-preflight.mjs
//   both key production reads off DIRECT_URL because the pooler role lacks
//   some grants this script's queries need (AuditEvent, cross-table joins).
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
const connectionSource = process.env.DIRECT_URL ? 'DIRECT_URL' : process.env.DATABASE_URL ? 'DATABASE_URL' : null
const outputPath = process.argv[2] || null
// How far back to look for job audienceKind evidence (the DIRECT/GROUP/ROOM
// heuristic — see DIRECT_ACCOUNT_NOTE in the lib module). Configurable because
// a quiet account needs a wider window to show any signal at all.
const audienceWindowDays = Number(process.env.KI17_GROUNDING_INSPECT_WINDOW_DAYS || 30)

if (!connectionString) {
  console.error('READ_ONLY_GROUNDING_INSPECT_FAILED: missing DIRECT_URL/DATABASE_URL environment')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  max: 1,
  connectionTimeoutMillis: 10_000,
  query_timeout: 20_000,
})

const queryFailures = {}

async function query(name, text, values = []) {
  try {
    const result = await pool.query(text, values)
    return result.rows
  } catch (error) {
    queryFailures[name] = error?.code || error?.message || 'UNKNOWN'
    return []
  }
}

try {
  // Every LineOaAccount with its Business identity. No status filter — an
  // ARCHIVED account still needs to be visible so the operator does not
  // mistake "not listed" for "not switched".
  const accountRows = await query('line_oa_accounts', `
    select a."id", a."code", a."displayName", a."status", a."businessId",
           b."code" as "businessCode", b."name" as "businessName",
           a."knowledgeGrounding", a."executionMode", a."serverEnabled",
           a."isDefaultForBusiness", a."version", a."updatedAt"
    from public."LineOaAccount" a
    join public."Business" b on b."id" = a."businessId"
    order by b."name", a."code"
  `)

  // Best-effort DIRECT-traffic signal (see DIRECT_ACCOUNT_NOTE): LineOaAccount
  // itself carries no such flag, only LineConversationJob.audienceKind does.
  const jobAudienceRows = await query('recent_job_audience_kinds', `
    select "accountId", "audienceKind", count(*)::int as "count"
    from public."LineConversationJob"
    where "createdAt" >= now() - ($1 || ' days')::interval
    group by "accountId", "audienceKind"
  `, [String(audienceWindowDays)])

  // Every prior CONFIGURE_KNOWLEDGE_GROUNDING switch or rollback (a rollback
  // is just a later row here whose `to` is BUSINESS_KNOWLEDGE again).
  const auditRows = await query('knowledge_grounding_audit_history', `
    select "entityId", "occurredAt", "actorId", "actorType", "reason",
           "beforeJson", "afterJson"
    from public."AuditEvent"
    where "entityType" = 'LINE_OA_ACCOUNT'
      and "action" = 'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED'
    order by "occurredAt" desc
    limit 500
  `)

  const report = buildGroundingInspectionReport({ accountRows, jobAudienceRows, auditRows })
  report.connectionSource = connectionSource
  report.audienceWindowDays = audienceWindowDays
  if (Object.keys(queryFailures).length > 0) report.queryFailures = queryFailures

  const serialized = JSON.stringify(report, null, 2) + '\n'
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, serialized, 'utf8')
  }
  console.log(serialized)
} finally {
  await pool.end()
}
