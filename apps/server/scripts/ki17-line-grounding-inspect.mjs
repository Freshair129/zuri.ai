#!/usr/bin/env node
// @req FR-235 — read-only inspection for an explicitly authorized target:
//   lists every LineOaAccount's current `knowledgeGrounding` mode, runtime owner,
//   shadow state, Business identity, a best-effort
//   DIRECT-traffic signal, and latest mode/shadow audit events per account.
//   Requires the approved direct `DIRECT_URL`; incomplete required queries are
//   reported and return a failing exit code. Executes SELECT-only database
//   queries; an optional JSON report is create-once outside the repository.
// @spec ADR-090 D1, ADR-057, ADR-119 D1/D3 — use an explicit DIRECT_URL,
//   reject known Supabase poolers, verify TLS, and do not revive the retired
//   SmartGift pilot or infer authority from a customer name.
// @tested tests/unit/ki17-line-grounding-inspect-lib.test.js (the shaping
//   logic and Zod report contract), tests/unit/ki17-line-grounding-inspect-script.test.js
//   (read-only SQL, DIRECT_URL requirement, and an executed incomplete-query path).
//
// Usage: DIRECT_URL=... node scripts/ki17-line-grounding-inspect.mjs [/protected/evidence/report.json]
// Historical context: docs/runbooks/TASK-ZAI-095-LINE-GROUNDING-SWITCH.md.
// That superseded pilot is not an operative switch authorization.

import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOutsideRepository } from './production-migration-evidence.mjs'
import {
  buildGroundingInspectionReport,
  GroundingInspectionReportSchema,
  KNOWLEDGE_GROUNDING_AUDIT_ACTION,
  KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION,
  resolveGroundingInspectionTarget,
} from './ki17-line-grounding-inspect-lib.mjs'

const { Pool } = pg
// @spec ADR-057 — require DIRECT_URL. DATABASE_URL may be a pooler and is not
//   an approved source for the required AuditEvent and cross-table queries.
const connectionString = process.env.DIRECT_URL || null
const connectionSource = connectionString ? 'DIRECT_URL' : null
const outputPath = process.argv[2] || null
// How far back to look for job audienceKind evidence (the DIRECT/GROUP/ROOM
// heuristic — see DIRECT_ACCOUNT_NOTE in the lib module). Configurable because
// a quiet account needs a wider window to show any signal at all.
const audienceWindowDays = Number(process.env.KI17_GROUNDING_INSPECT_WINDOW_DAYS || 30)

if (!connectionString) {
  console.error('READ_ONLY_GROUNDING_INSPECT_FAILED: DIRECT_URL is required; DATABASE_URL/pooler is not an approved source')
  process.exit(1)
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const reportPath = outputPath ? assertOutsideRepository(outputPath, repositoryRoot) : null
if (reportPath && fs.existsSync(reportPath)) throw new Error('refuse: report already exists; refusing to overwrite it')
if (!Number.isInteger(audienceWindowDays) || audienceWindowDays <= 0) throw new Error('audience window must be a positive integer')
const caPath = process.env.KI17_GROUNDING_INSPECT_CA_FILE
const { clientConfig, connectionTarget } = resolveGroundingInspectionTarget(connectionString, {
  ...(caPath ? { ca: fs.readFileSync(caPath, 'utf8') } : {}),
})

const pool = new Pool({
  ...clientConfig,
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
    queryFailures[name] = error?.code || 'QUERY_FAILED'
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
           a."transportMode", a."knowledgeGrounding", a."runtimeOwner", a."executionMode",
           a."serverEnabled", a."knowledgeGroundingShadow",
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

  // The latest event for each account/action is enough to verify the current
  // switch and shadow state. Partitioning before selecting avoids a global row
  // cap that could silently omit an account and still call the report complete.
  const auditRows = await query('knowledge_grounding_audit_latest_by_action', `
    select "entityId", "action", "occurredAt", "actorId", "actorType", "reason",
           "payloadJson", "beforeJson", "afterJson"
    from (
      select "entityId", "action", "occurredAt", "actorId", "actorType", "reason",
             "payloadJson", "beforeJson", "afterJson",
             row_number() over (
               partition by "entityId", "action"
               order by "occurredAt" desc, "id" desc
             ) as action_rank
      from public."AuditEvent"
      where "entityType" = 'LINE_OA_ACCOUNT'
        and "action" in ('${KNOWLEDGE_GROUNDING_AUDIT_ACTION}', '${KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION}')
    ) latest
    where action_rank = 1
    order by "entityId", "action"
  `)

  const report = GroundingInspectionReportSchema.parse({
    ...buildGroundingInspectionReport({ accountRows, jobAudienceRows, auditRows, queryFailures }),
    connectionSource,
    connectionTarget,
    audienceWindowDays,
  })

  const serialized = JSON.stringify(report, null, 2) + '\n'
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(reportPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  }
  console.log(serialized)
  const failedQueries = Object.keys(queryFailures)
  if (failedQueries.length > 0) {
    console.error(`READ_ONLY_GROUNDING_INSPECT_FAILED: required query set is incomplete: ${failedQueries.join(', ')}`)
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
