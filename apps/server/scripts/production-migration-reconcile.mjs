import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  assertOutsideRepository,
  assertMatchingArtifacts,
  canonicalJson,
  captureDatabaseBaseline,
  readHashedArtifact,
  sha256,
  verifyDependencyBackup,
} from './production-migration-evidence.mjs'
import {
  createDirectClientConfig,
  PRODUCTION_PROJECT_REF,
  resolveDirectTarget,
} from './production-migration-target.mjs'

// @req FR-051, FR-069, FR-094, FR-095, FR-268, FR-272 — reconcile a reviewed
// Supabase migration set against the live catalog without replaying destructive
// historical SQL or replacing the Docker application image.
// @spec ADR-057, ADR-058, ADR-102, ADR-103, ADR-104, SEC-001, SEC-018
// @tested tests/unit/production-migration-reconciliation.test.js

export { PRODUCTION_PROJECT_REF }

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const privateTables = ['MfaFactor', 'PasskeyCredential', 'ProjectExecutionRun', 'ProjectExecutionStep']

export const RECONCILIATION_PLAN = [
  {
    version: '20260907233000',
    name: 'execution_trace',
    relativePath: 'supabase/migrations/20260907233000_execution_trace.sql',
    sha256: 'bda1ddc0948eb830da5e8196433dfd961736288ab5eebd5620977c0292bb551c',
    mode: 'record',
    checks: {
      tables: ['AgentTraceEvent'],
      columns: [
        ['LineConversationJob', 'executionId'],
        ['AgentTraceEvent', 'tenantId'],
        ['AgentTraceEvent', 'businessId'],
        ['AgentTraceEvent', 'executionId'],
      ],
      indexes: [
        'AgentTraceEvent_scope_idempotency_key',
        'AgentTraceEvent_tenantId_businessId_turnId_occurredAt_idx',
        'AgentTraceEvent_tenantId_businessId_turnId_createdAt_idx',
      ],
      privateTables: ['AgentTraceEvent'],
    },
  },
  {
    version: '20260912120000',
    name: 'access_grant_lifecycle',
    relativePath: 'supabase/migrations/20260912120000_access_grant_lifecycle.sql',
    sha256: '0365bb9f5600f745f0ec7483712f441b0a6190f1bbdc26b9bed66073e303c0cb',
    mode: 'record',
    checks: {
      columns: [
        ['Membership', 'scopeType'],
        ['Membership', 'grantedByPersonId'],
        ['Membership', 'grantSource'],
        ['Membership', 'expiresAt'],
        ['Membership', 'revokedAt'],
        ['RoleBinding', 'cascadeOfMembershipId'],
        ['Person', 'accessDisabledAt'],
        ['Person', 'accessDisabledReason'],
      ],
      indexes: [
        'Membership_person_tenant_scope_key',
        'Membership_person_business_scope_key',
        'Membership_businessId_status_idx',
        'Membership_expiresAt_status_idx',
        'RoleBinding_cascadeOfMembershipId_idx',
        'Person_email_lower_key',
      ],
      constraints: [
        'Membership_scope_shape_check',
        'Membership_status_check',
        'Membership_role_check',
        'Membership_business_tenant_fkey',
        'Business_id_tenantId_key',
      ],
    },
  },
  {
    version: '20260912130000',
    name: 'org_employment_legal_entity',
    relativePath: 'supabase/migrations/20260912130000_org_employment_legal_entity.sql',
    sha256: '3bf7104839cd61f004ca47f1ceb00a7a83fd6d6dacd192c9e57b4c7dad48ddf9',
    mode: 'record',
    checks: {
      tables: ['TaxRegistrationBranch', 'Employment'],
      columns: [
        ['LegalEntity', 'tenantId'],
        ['LegalEntity', 'status'],
        ['Branch', 'kind'],
        ['Branch', 'taxRegistrationBranchId'],
        ['Employment', 'tenantId'],
        ['Employment', 'businessId'],
      ],
      absentColumns: [
        ['Branch', 'taxBranchCode'],
        ['Membership', 'employeeRef'],
        ['Membership', 'branchId'],
      ],
      indexes: [
        'TaxRegistrationBranch_legalEntityId_branchCode_key',
        'TaxRegistrationBranch_legalEntityId_idx',
        'Employment_person_business_open_key',
        'Employment_business_employeeNo_key',
      ],
      privateTables: ['TaxRegistrationBranch', 'Employment'],
      privateTableRoles: {
        TaxRegistrationBranch: ['zuri_app_runtime'],
        Employment: ['zuri_app_runtime'],
      },
    },
  },
  {
    version: '20260912140000',
    name: 'access_invite_sod_operator',
    relativePath: 'supabase/migrations/20260912140000_access_invite_sod_operator.sql',
    sha256: 'df51eb2dcfead1ca772873fb2e9ec4f6bfe723fc7253856591b1f041f334ed20',
    mode: 'record',
    checks: {
      tables: ['AccessInvite'],
      absentTables: ['WorkspaceInvite'],
      columns: [
        ['AccessInvite', 'scopeType'],
        ['AccessInvite', 'tenantId'],
        ['AccessInvite', 'businessId'],
        ['AccessInvite', 'invitedLineUserId'],
        ['AccessInvite', 'acceptedMembershipId'],
        ['RoleBinding', 'sodOverrideReason'],
        ['PlatformGrant', 'standing'],
        ['PlatformGrant', 'expiresAt'],
      ],
      indexes: [
        'AccessInvite_pending_email_key',
        'AccessInvite_tenantId_status_idx',
        'AccessInvite_businessId_status_idx',
        'RoleBinding_person_business_role_key',
        'RoleBinding_person_tenant_role_key',
        'PlatformGrant_person_capability_active_key',
      ],
      privateTables: ['AccessInvite'],
      privateTableRoles: { AccessInvite: ['zuri_app_runtime'] },
    },
  },
  {
    version: '20260912150000',
    name: 'audit_scope_and_evidence',
    relativePath: 'supabase/migrations/20260912150000_audit_scope_and_evidence.sql',
    sha256: '091b679257aaa6c94953eb6fd4ac71615e6ef5501e222d462321a9a6bc396754',
    mode: 'record',
    checks: {
      columns: [
        ['AuditEvent', 'tenantId'],
        ['AuditEvent', 'businessId'],
        ['AuditEvent', 'reason'],
        ['AuditEvent', 'beforeJson'],
        ['AuditEvent', 'afterJson'],
        ['AuditEvent', 'requestId'],
        ['AuditEvent', 'sessionId'],
      ],
      indexes: [
        'AuditEvent_tenantId_occurredAt_idx',
        'AuditEvent_businessId_occurredAt_idx',
        'AuditEvent_actorId_occurredAt_idx',
      ],
    },
  },
  {
    version: '20260912160000',
    name: 'p2_mfa_session_assurance',
    relativePath: 'supabase/migrations/20260912160000_p2_mfa_session_assurance.sql',
    sha256: '64172346381d0eff1a58964415189ee1feb7678aaf9144e8c5135811abb656b3',
    mode: 'record',
    checks: {
      tables: ['MfaFactor'],
      columns: [
        ['Session', 'assuranceLevel'],
        ['Session', 'elevatedUntil'],
        ['MfaFactor', 'personId'],
        ['MfaFactor', 'secret'],
        ['MfaFactor', 'status'],
      ],
      indexes: ['MfaFactor_personId_status_idx'],
    },
  },
  {
    version: '20260912170000',
    name: 'p2_webauthn_passkeys',
    relativePath: 'supabase/migrations/20260912170000_p2_webauthn_passkeys.sql',
    sha256: '2da3cfa14934e6fc274dac43ff2c5a25869891abbb444b5610ed0d16f0b98839',
    mode: 'apply',
    post: {
      tables: ['PasskeyCredential'],
      indexes: [
        'PasskeyCredential_credentialId_key',
        'PasskeyCredential_personId_status_idx',
        'PasskeyCredential_credentialId_idx',
      ],
    },
  },
  {
    version: '20260922120000',
    name: 'pm_execution_trace_replay',
    relativePath: 'supabase/migrations/20260922120000_pm_execution_trace_replay.sql',
    sha256: '7ae1116ed7fe966c5bdfd2dab9c5b74fadc4ff4fa1d7fb1ad9e69133de5337ec',
    mode: 'apply',
    post: {
      tables: ['ProjectExecutionRun', 'ProjectExecutionStep'],
    },
  },
  {
    version: '20260922130000',
    name: 'business_key_results',
    relativePath: 'supabase/migrations/20260922130000_business_key_results.sql',
    sha256: '46c20760a6f6a12ab8c5c791427034cdb08c5bcad851c32346992092b93cabb4',
    mode: 'apply',
    post: {
      tables: ['BusinessKeyResult', 'BusinessKeyResultCheckIn'],
      columns: [
        ['BusinessGoal', 'perspective'],
        ['BusinessGoal', 'isWig'],
      ],
      privateTables: ['BusinessKeyResult', 'BusinessKeyResultCheckIn'],
    },
  },
  {
    version: '20260923010000',
    name: 'pm_approval_gateway_admission',
    relativePath: 'supabase/migrations/20260923010000_pm_approval_gateway_admission.sql',
    sha256: 'a2edb856eb1a281cfad9ba37fa813c438716c4a23e72d02f7459a1b42d2e7d3c',
    mode: 'apply',
    post: {
      tables: ['ProjectApprovalRequest'],
      privateTables: ['ProjectApprovalRequest'],
    },
  },
  {
    version: '20260923020000',
    name: 'pm_trace_and_iam_rls_hardening',
    relativePath: 'supabase/migrations/20260923020000_pm_trace_and_iam_rls_hardening.sql',
    sha256: 'a9efd89d08f624da16f3785ae6bcc40274ec261c6d5d448eabd6ce3339506fcf',
    mode: 'apply',
    post: {
      privateTables,
    },
  },
  {
    version: '20261024010000',
    name: 'dependency_handoff',
    relativePath: 'supabase/migrations/20261024010000_dependency_handoff.sql',
    sha256: '7ebd65cccbb049f92a8e0c246b7866888f65e39958b855ae43ffbb704e965d19',
    mode: 'apply',
    pre: {
      tables: ['Dependency'],
      absentColumns: [['Dependency', 'contractJson']],
    },
    post: {
      columnDefinitions: [{
        table: 'Dependency',
        column: 'contractJson',
        dataType: 'text',
        isNullable: 'YES',
        columnDefault: null,
      }],
    },
  },
]

export const PIPELINE_BUILDER_PLAN = RECONCILIATION_PLAN.filter((item) => item.version === '20261024010000')
export const PRIOR_RECONCILIATION_PLAN = RECONCILIATION_PLAN.filter((item) => item.version !== '20261024010000')

export function assertPriorMigrationReceipts(ledger, priorPlan = PRIOR_RECONCILIATION_PLAN) {
  for (const item of priorPlan) {
    if (!ledger.has(item.version)) {
      throw new Error(`refuse: prior migration ${item.version} is missing from ledger; this operation cannot execute historical migrations`)
    }
    if (ledger.get(item.version) !== item.name) {
      throw new Error(`refuse: prior migration ledger name mismatch for ${item.version}`)
    }
  }
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    projectRef: null,
    preflightPath: null,
    preflightSha256: null,
    snapshotPath: null,
    snapshotSha256: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--apply') {
      options.apply = true
      continue
    }
    if (['--project-ref', '--preflight', '--preflight-sha256', '--snapshot', '--snapshot-sha256'].includes(token)) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`)
      if (token === '--project-ref') options.projectRef = value
      if (token === '--preflight') options.preflightPath = value
      if (token === '--preflight-sha256') options.preflightSha256 = value
      if (token === '--snapshot') options.snapshotPath = value
      if (token === '--snapshot-sha256') options.snapshotSha256 = value
      index += 1
      continue
    }
    throw new Error(`unknown option: ${token}`)
  }
  for (const key of ['preflightSha256', 'snapshotSha256']) {
    if (options[key] !== null && !/^[a-f0-9]{64}$/.test(options[key])) {
      throw new Error(`invalid SHA-256 value for ${key}`)
    }
  }
  return options
}

function migrationFile(item) {
  const filePath = path.join(SERVER_ROOT, item.relativePath)
  if (!fs.existsSync(filePath)) throw new Error(`migration file is missing: ${item.relativePath}`)
  const sql = fs.readFileSync(filePath, 'utf8')
  const sha256 = crypto.createHash('sha256').update(sql, 'utf8').digest('hex')
  if (sha256 !== item.sha256) throw new Error(`migration hash mismatch for ${item.relativePath}`)
  return {
    filePath,
    sql,
    sha256,
  }
}

export function withoutTransactionWrapper(sql) {
  return sql
    .replace(/\bBEGIN;\s*/i, '')
    .replace(/\s*COMMIT;\s*$/i, '')
}

async function queryRows(client, sql, values = []) {
  return (await client.query(sql, values)).rows
}

async function assertCatalog(client, checks = {}) {
  const tables = checks.tables ?? []
  const absentTables = checks.absentTables ?? []
  const columns = checks.columns ?? []
  const absentColumns = checks.absentColumns ?? []
  const indexes = checks.indexes ?? []
  const constraints = checks.constraints ?? []
  const columnDefinitions = checks.columnDefinitions ?? []
  const privateTableNames = checks.privateTables ?? []
  const privateTableRoles = checks.privateTableRoles ?? {}

  if (tables.length > 0) {
    const rows = await queryRows(client, `
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
    `, [tables])
    const found = new Set(rows.map((row) => row.table_name))
    const missing = tables.filter((table) => !found.has(table))
    if (missing.length > 0) throw new Error(`catalog precondition missing table(s): ${missing.join(',')}`)
  }

  if (absentTables.length > 0) {
    const rows = await queryRows(client, `
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
    `, [absentTables])
    if (rows.length > 0) throw new Error(`catalog precondition expected absent table(s): ${rows.map((row) => row.table_name).join(',')}`)
  }

  if (columns.length > 0) {
    const tableNames = [...new Set(columns.map(([table]) => table))]
    const rows = await queryRows(client, `
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[])
    `, [tableNames])
    const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`))
    const missing = columns.filter(([table, column]) => !found.has(`${table}.${column}`))
    if (missing.length > 0) throw new Error(`catalog precondition missing column(s): ${missing.map(([table, column]) => `${table}.${column}`).join(',')}`)
  }

  if (absentColumns.length > 0) {
    const tableNames = [...new Set(absentColumns.map(([table]) => table))]
    const rows = await queryRows(client, `
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[])
    `, [tableNames])
    const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`))
    const present = absentColumns.filter(([table, column]) => found.has(`${table}.${column}`))
    if (present.length > 0) throw new Error(`catalog precondition expected absent column(s): ${present.map(([table, column]) => `${table}.${column}`).join(',')}`)
  }

  for (const expected of columnDefinitions) {
    const rows = await queryRows(client, `
      select data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2
    `, [expected.table, expected.column])
    if (rows.length !== 1
        || rows[0].data_type !== expected.dataType
        || rows[0].is_nullable !== expected.isNullable
        || rows[0].column_default !== expected.columnDefault) {
      throw new Error(`catalog postcondition failed for ${expected.table}.${expected.column}: exact type, nullability and default are required`)
    }
  }

  if (indexes.length > 0) {
    const rows = await queryRows(client, `
      select indexname
      from pg_indexes
      where schemaname = 'public' and indexname = any($1::text[])
    `, [indexes])
    const found = new Set(rows.map((row) => row.indexname))
    const missing = indexes.filter((index) => !found.has(index))
    if (missing.length > 0) throw new Error(`catalog precondition missing index(es): ${missing.join(',')}`)
  }

  if (constraints.length > 0) {
    const rows = await queryRows(client, `
      select conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public' and con.conname = any($1::text[])
    `, [constraints])
    const found = new Set(rows.map((row) => row.conname))
    const missing = constraints.filter((constraint) => !found.has(constraint))
    if (missing.length > 0) throw new Error(`catalog precondition missing constraint(s): ${missing.join(',')}`)
  }

  for (const table of privateTableNames) await assertPrivateTable(client, table, privateTableRoles[table])
}

async function assertPrivateTable(client, table, requiredRoles = ['zuri_app_runtime', 'zuri_web_login']) {
  const rls = await queryRows(client, `
    select c.relrowsecurity as rls, c.relforcerowsecurity as forced
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = $1
  `, [table])
  if (rls.length !== 1 || !rls[0].rls || !rls[0].forced) throw new Error(`security precondition failed for ${table}: RLS must be enabled and forced`)

  const policy = await queryRows(client, `
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = $1 and policyname = 'zuri_app_runtime_all'
  `, [table])
  if (policy.length !== 1) throw new Error(`security precondition failed for ${table}: zuri_app_runtime_all is missing`)

  const badGrants = await queryRows(client, `
    select grantee
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = $1
      and grantee in ('anon', 'authenticated', 'service_role')
  `, [table])
  if (badGrants.length > 0) throw new Error(`security precondition failed for ${table}: forbidden table grant exists`)

  const runtimeGrants = await queryRows(client, `
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = $1
      and grantee in ('zuri_app_runtime', 'zuri_web_login')
  `, [table])
  const expected = new Set(requiredRoles.flatMap((role) => ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((privilege) => `${role}:${privilege}`)))
  const actual = new Set(runtimeGrants.map((row) => `${row.grantee}:${row.privilege_type}`))
  const missing = [...expected].filter((grant) => !actual.has(grant))
  if (missing.length > 0) throw new Error(`security precondition failed for ${table}: runtime grant(s) missing`)
}

async function readLedger(client, plan = RECONCILIATION_PLAN) {
  const rows = await queryRows(client, `
    select version, name
    from supabase_migrations.schema_migrations
    where version = any($1::text[])
  `, [plan.map((item) => item.version)])
  return new Map(rows.map((row) => [row.version, row.name]))
}

async function recordLedger(client, item) {
  const existing = await queryRows(client, `
    select name
    from supabase_migrations.schema_migrations
    where version = $1
  `, [item.version])
  if (existing.length > 0) {
    if (existing[0].name !== item.name) throw new Error(`ledger name mismatch for ${item.version}`)
    return 'ALREADY_APPLIED'
  }
  await client.query(`
    insert into supabase_migrations.schema_migrations (version, name)
    values ($1, $2)
  `, [item.version, item.name])
  return 'RECORDED'
}

async function assertPriorMigrationsReconciled(client) {
  const ledger = await readLedger(client, PRIOR_RECONCILIATION_PLAN)
  assertPriorMigrationReceipts(ledger)
  for (const item of PRIOR_RECONCILIATION_PLAN) {
    await assertCatalog(client, item.mode === 'record' ? item.checks : item.post)
  }
}

async function applyPlan(client, apply, target, expectedBaseline, plan = PIPELINE_BUILDER_PLAN, {
  requirePriorReconciliation = false,
} = {}) {
  const results = []

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  await client.query("SET LOCAL lock_timeout = '5s'")
  await client.query("SET LOCAL statement_timeout = '120s'")
  try {
    // Acquire write-blocking locks before the first MVCC snapshot. A writer
    // committed while these locks are being acquired must be visible to the
    // baseline comparison; later writers wait until this transaction ends.
    await client.query('LOCK TABLE public."Dependency" IN SHARE MODE')
    await client.query('LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE')
    const before = await captureDatabaseBaseline(client, target)
    if (before.baselineId !== expectedBaseline.baselineId
        || canonicalJson(before.baseline) !== canonicalJson(expectedBaseline.baseline)) {
      throw new Error('refuse: live database baseline differs from the verified preflight and snapshot')
    }

    if (requirePriorReconciliation) await assertPriorMigrationsReconciled(client)

    const ledger = await readLedger(client, plan)
    for (const item of plan) {
      const file = migrationFile(item)
      const hasReceipt = ledger.has(item.version)
      if (hasReceipt && ledger.get(item.version) !== item.name) throw new Error(`ledger name mismatch for ${item.version}`)

      if (item.mode === 'record') {
        await assertCatalog(client, item.checks)
        const status = await recordLedger(client, item)
        results.push({ version: item.version, name: item.name, mode: item.mode, status, sha256: file.sha256 })
        continue
      }

      if (!hasReceipt) {
        await assertCatalog(client, item.pre)
        await client.query(withoutTransactionWrapper(file.sql))
        await assertCatalog(client, item.post)
        const status = await recordLedger(client, item)
        results.push({ version: item.version, name: item.name, mode: item.mode, status, sha256: file.sha256 })
        continue
      }

      await assertCatalog(client, item.post)
      results.push({ version: item.version, name: item.name, mode: item.mode, status: 'ALREADY_APPLIED', sha256: file.sha256 })
    }

    const after = await captureDatabaseBaseline(client, target)
    const beforeDependency = expectedBaseline.baseline.dependency
    const afterDependency = after.baseline.dependency
    if (afterDependency.rowsSha256 !== beforeDependency.rowsSha256
        || afterDependency.rowCount !== beforeDependency.rowCount) {
      throw new Error('refuse: Dependency rows changed during the migration transaction')
    }
    if (canonicalJson(afterDependency.security) !== canonicalJson(beforeDependency.security)) {
      throw new Error('refuse: Dependency RLS, policies or grants changed during the migration transaction')
    }
    for (const item of plan) {
      const recorded = after.migrationHistory.filter((row) => row.version === item.version)
      if (recorded.length !== 1 || recorded[0].name !== item.name) {
        throw new Error(`refuse: migration ledger postcondition failed for ${item.version}`)
      }
    }

    if (apply) await client.query('COMMIT')
    else await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }

  if (!apply) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    let restored
    try {
      restored = await captureDatabaseBaseline(client, target)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    }
    if (restored.baselineId !== expectedBaseline.baselineId
        || canonicalJson(restored.baseline) !== canonicalJson(expectedBaseline.baseline)) {
      throw new Error('refuse: dry-run rollback did not restore the accepted database baseline')
    }
  }

  return results
}

export async function runReconciliationPlan(client, {
  apply = false,
  target,
  expectedBaseline,
  plan = PIPELINE_BUILDER_PLAN,
  requirePriorReconciliation = false,
}) {
  if (!target || !expectedBaseline?.baselineId || !expectedBaseline?.baseline) {
    throw new Error('refuse: a verified target and baseline are required')
  }
  return applyPlan(client, apply, target, expectedBaseline, plan, { requirePriorReconciliation })
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv)
  if (options.projectRef !== PRODUCTION_PROJECT_REF) throw new Error(`refuse: pass --project-ref ${PRODUCTION_PROJECT_REF}`)
  if (!options.preflightPath || !options.preflightSha256
      || !options.snapshotPath || !options.snapshotSha256) {
    throw new Error('refuse: preflight and snapshot paths with externally verified SHA-256 values are required')
  }

  const connectionString = dependencies.connectionString ?? process.env.DIRECT_URL
  const target = resolveDirectTarget(connectionString, PRODUCTION_PROJECT_REF)
  const repositoryRoot = path.resolve(SERVER_ROOT, '../..')
  assertOutsideRepository(options.preflightPath, repositoryRoot)
  assertOutsideRepository(options.snapshotPath, repositoryRoot)
  const preflight = readHashedArtifact(options.preflightPath, options.preflightSha256, 'READ_ONLY')
  const snapshot = readHashedArtifact(options.snapshotPath, options.snapshotSha256, 'READ_ONLY_LOGICAL_BACKUP')
  const expectedEndpoint = {
    projectRef: target.projectRef,
    host: target.host,
    port: target.port,
    database: target.database,
  }
  for (const artifact of [preflight, snapshot]) {
    if (artifact.projectRef !== PRODUCTION_PROJECT_REF
        || !artifact.target
        || artifact.target.projectRef !== expectedEndpoint.projectRef
        || artifact.target.host !== expectedEndpoint.host
        || artifact.target.port !== expectedEndpoint.port
        || artifact.target.database !== expectedEndpoint.database) {
      throw new Error('refuse: evidence artifact endpoint does not match DIRECT_URL')
    }
  }
  assertMatchingArtifacts(preflight, snapshot, preflight.target)
  if (!preflight.baseline || preflight.baselineId !== sha256(canonicalJson(preflight.baseline))
      || preflight.baseline.target?.user !== 'postgres'
      || preflight.baseline.target?.schema !== 'public') {
    throw new Error('refuse: preflight baseline identity or digest is invalid')
  }
  if (canonicalJson(preflight.baseline.target) !== canonicalJson(preflight.target)) {
    throw new Error('refuse: artifact target does not match its baseline identity')
  }
  const snapshotLedger = snapshot.tables?.migrations
  if (!Array.isArray(snapshotLedger)
      || snapshotLedger.length !== snapshot.baseline?.migrationLedger?.rowCount
      || sha256(canonicalJson(snapshotLedger)) !== snapshot.baseline?.migrationLedger?.sha256) {
    throw new Error('refuse: snapshot migration ledger rows do not match the baseline')
  }
  await verifyDependencyBackup(snapshot, options.snapshotPath, repositoryRoot)
  if (snapshot.dependencyBackup.rowCount !== snapshot.baseline?.dependency?.rowCount
      || snapshot.dependencyBackup.sha256 !== snapshot.baseline?.dependency?.fullRowsSha256) {
    throw new Error('refuse: Dependency backup rows do not match the baseline evidence')
  }

  const client = dependencies.client ?? new pg.Client(createDirectClientConfig(connectionString, PRODUCTION_PROJECT_REF))
  await client.connect()
  try {
    const results = await runReconciliationPlan(client, {
      apply: options.apply,
      target,
      expectedBaseline: preflight,
      plan: PIPELINE_BUILDER_PLAN,
      requirePriorReconciliation: true,
    })
    const output = {
      status: options.apply ? 'APPLIED' : 'DRY_RUN_ROLLED_BACK',
      projectRef: PRODUCTION_PROJECT_REF,
      target: preflight.target,
      baselineId: preflight.baselineId,
      migrationCount: results.length,
      results,
    }
    ;(dependencies.log ?? console.log)(JSON.stringify(output, null, 2))
    return output
  } finally {
    await client.end().catch(() => {})
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(`PRODUCTION_MIGRATION_RECONCILE_FAILED: ${error.message}`)
    process.exitCode = 1
  })
}
