import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOutsideRepository, buildHashedArtifact, captureDatabaseBaseline, sha256 } from './production-migration-evidence.mjs'
import { createDirectClientConfig, resolveDirectTarget } from './production-migration-target.mjs'

// @req FR-051, FR-071 — remote migration preflight inventories scope, schema,
// grants, RLS and current destination evidence without performing a write.
// @spec ADR-018 D7/D8 — read-only evidence precedes any Supabase mutation.

const connectionString = process.env.DIRECT_URL
const outputPath = process.argv[2] || null
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '../../..')

const target = resolveDirectTarget(connectionString)
const resolvedOutputPath = outputPath ? assertOutsideRepository(outputPath, REPOSITORY_ROOT) : null
if (!resolvedOutputPath) throw new Error('READ_ONLY_PREFLIGHT_FAILED: output path is required')
if (fs.existsSync(resolvedOutputPath)) throw new Error('READ_ONLY_PREFLIGHT_FAILED: output path already exists')

const client = new pg.Client({ ...createDirectClientConfig(connectionString), query_timeout: 20_000 })

const report = {
  mode: 'READ_ONLY',
  generatedAt: new Date().toISOString(),
  backupEvidence: 'UNAVAILABLE_FROM_DATABASE_ONLY',
  queries: {},
}

async function query(name, text, values = []) {
  try {
    const result = await client.query(text, values)
    report.queries[name] = { status: 'OK', rows: result.rows }
  } catch (error) {
    report.queries[name] = { status: 'UNAVAILABLE', code: error?.code || 'UNKNOWN' }
  }
}

try {
  await client.connect()
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const evidence = await captureDatabaseBaseline(client, target)
  report.projectRef = target.projectRef
  report.target = evidence.identity
  report.baseline = evidence.baseline
  report.baselineId = evidence.baselineId
  report.timing = evidence.timing
  report.queries.connection = { status: 'OK', rows: [evidence.identity] }
  await query('schemas', `
    select nspname as schema
    from pg_namespace
    where nspname in ('public', 'zuri_core', 'zuri_api', 'supabase_migrations')
    order by nspname
  `)
  await query('tables', `
    select table_schema as schema, table_name as table
    from information_schema.tables
    where table_schema in ('public', 'zuri_core', 'zuri_api', 'supabase_migrations')
    order by table_schema, table_name
  `)
  await query('migration_history', `
    select version, name
    from supabase_migrations.schema_migrations
    order by version
  `)
  await query('portfolio_identity', `
    select id, code, name, status
    from zuri_core.portfolio
    where code in ('PF-ZURI-OWNER', 'PF-WANNAPA-WORKSPACE')
       or id in ('dfeaa9d2-7c65-48bc-9c30-ba083eac8439', '5c621811-7e7a-42dd-ac39-ea9e8416ba98')
    order by code
  `)
  await query('tenant_identity', `
    select id, portfolio_id, code, name, status
    from zuri_core.tenant
    where code in ('TNT-SMARTGIFT', 'TNT-ETOHGROUP')
       or id in ('77cdbe70-3111-4a04-922a-8059be99a8b0', 'f477c41a-c8d4-4c89-8612-372265907089')
    order by code
  `)
  await query('business_identity', `
    select id, tenant_id, code, name, status
    from zuri_core.business
    where code in ('BUS-SMARTGIFT', 'BUS-ETOH-MUKU', 'BUS-MUJEEN', 'BUS-EMC')
       or id in (
         '834fa869-62f3-431c-a287-e9a95e91175b',
         '2dfb89a9-206a-4f32-aff5-8ca4d00a28fe',
         'ad6627eb-cc3c-4465-8d55-10ef68786fa3',
         'dc84f828-df37-4417-84e0-63b863bedb34',
         '161c1acf-7c0a-44bc-875c-39bee1628685'
       )
    order by code
  `)
  await query('knowledge_scope_counts', `
    select tenant_id,
           business_id,
           count(*)::int as rows,
           count(distinct product_code)::int as distinct_product_codes,
           count(*) filter (where sell_price is not null)::int as priced_rows,
           count(*) filter (where sensitivity <> 'PUBLIC')::int as non_public_rows,
           min(source_sha256) as min_source_sha256,
           max(source_sha256) as max_source_sha256
    from zuri_core.business_knowledge
    group by tenant_id, business_id
    order by tenant_id, business_id
  `)
  await query('bootstrap_audit_scope', `
    select id, code, tenant_id, business_id, migration_id, operation,
           artifact_sha256, row_count, correlation_id
    from zuri_core.bootstrap_audit_event
    where tenant_id in ('77cdbe70-3111-4a04-922a-8059be99a8b0', 'f477c41a-c8d4-4c89-8612-372265907089')
       or business_id in ('834fa869-62f3-431c-a287-e9a95e91175b', '2dfb89a9-206a-4f32-aff5-8ca4d00a28fe')
    order by occurred_at desc
  `)
  await query('line_binding_scope', `
    select id, code, provider, tenant_id, business_id, status,
           external_channel_id_hash, credential_hash
    from zuri_core.line_channel_binding
    where tenant_id in ('77cdbe70-3111-4a04-922a-8059be99a8b0', 'f477c41a-c8d4-4c89-8612-372265907089')
       or business_id in ('834fa869-62f3-431c-a287-e9a95e91175b', '2dfb89a9-206a-4f32-aff5-8ca4d00a28fe')
    order by code
  `)
  await query('rls_tables', `
    select n.nspname as schema,
           c.relname as table,
           c.relrowsecurity as rowsecurity,
           c.relforcerowsecurity as forcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('zuri_core', 'public')
      and c.relkind = 'r'
    order by n.nspname, c.relname
  `)
  await query('rls_policies', `
    select schemaname as schema, tablename as table, policyname,
           permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname in ('zuri_core', 'public')
    order by schemaname, tablename, policyname
  `)
  await query('roles', `
    select rolname, rolsuper, rolcreaterole, rolbypassrls, rolcanlogin
    from pg_roles
    where rolname like 'zuri_%'
       or rolname in ('anon', 'authenticated', 'service_role')
    order by rolname
  `)
  await query('current_user_table_grants', `
    select grantee, table_schema as schema, table_name as table,
           privilege_type, is_grantable
    from information_schema.role_table_grants
    where grantee = current_user
      and table_schema in ('zuri_core', 'public')
    order by table_schema, table_name, privilege_type
  `)
  await query('extensions', `
    select extname, extversion
    from pg_extension
    order by extname
  `)
  const unavailable = Object.entries(report.queries)
    .filter(([, result]) => result.status !== 'OK')
    .map(([name]) => name)
  if (unavailable.length > 0) throw new Error(`preflight query unavailable: ${unavailable.join(',')}`)
  await client.query('COMMIT')
  const artifact = buildHashedArtifact(report)
  const serialized = JSON.stringify(artifact, null, 2) + '\n'
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true })
  fs.writeFileSync(resolvedOutputPath, serialized, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({
    status: 'VERIFIED_READ_ONLY_PREFLIGHT',
    outputPath: resolvedOutputPath,
    fileSha256: sha256(Buffer.from(serialized, 'utf8')),
    baselineId: evidence.baselineId,
    target: evidence.identity,
  }, null, 2))
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(`READ_ONLY_PREFLIGHT_FAILED: ${error?.code || 'TARGET_OR_QUERY_REJECTED'}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
