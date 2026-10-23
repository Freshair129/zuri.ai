// @req FR-252 — disposable actual-role PostgreSQL qualification for Feature authority.
// @spec ADR-097, ADR-057
// @tested tests/postgres/phase-b-runtime-role.test.js
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { PrismaClient } from '@zuri/prisma-postgres'
import { startEmbeddedPostgres } from './embedded-postgres'
import { loadFrozenSchemaInventory } from '../../scripts/phase-b-recovery.mjs'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { makeViewer } from '../factories/viewer'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PM_TABLES = ['GovernanceSnapshot', 'ProjectFeature', 'FeatureContribution', 'FeatureWorkLink', 'RequirementBinding', 'ProjectFeatureMutationReceipt']

// No URL argument and no environment target: every client and CLI endpoint is
// derived from this newly created cluster. Admin is arrangement/recovery only.
export async function startPmRoleTarget() {
  const server = await startEmbeddedPostgres({ label: 'pm-role', database: 'pm_role_test' })
  const clients = []
  let bootstrap
  try {
    bootstrap = new pg.Client({ connectionString: server.url })
    await bootstrap.connect()
    const ddl = execFileSync(process.execPath, [path.join(ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    await bootstrap.query(ddl)
    // Prisma cannot represent the provider CHECK/policy contract. Recreate only
    // the six empty new tables with the issued migration, retaining the full
    // current application schema around them. Never alter the issued SQL.
    await bootstrap.query(`DROP TABLE ${PM_TABLES.map(name => `"${name}"`).join(',')} CASCADE`)
    const password = randomBytes(24).toString('hex')
    await bootstrap.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE ROLE zuri_app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE zuri_web_login LOGIN INHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}';
      GRANT zuri_app_runtime TO zuri_web_login;
      GRANT USAGE ON SCHEMA public TO zuri_app_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zuri_app_runtime`)
    // Existing-table privileges above model the app adapter prerequisite, not
    // the six-table authority. The issued migration revokes and bounds those.
    await bootstrap.query(readFileSync(path.join(ROOT, 'supabase/migrations/20260917041000_add_phase_b_feature_authority.sql'), 'utf8'))
    const client = url => {
      const db = new PrismaClient({ datasources: { db: { url } } })
      clients.push(db)
      return db
    }
    const runtimeUrl = new URL(server.url)
    runtimeUrl.username = 'zuri_web_login'
    runtimeUrl.password = password
    runtimeUrl.searchParams.set('connection_limit', '1')
    const inventory = await loadFrozenSchemaInventory()
    if (!inventory) throw new Error('PM_ROLE_INVENTORY_UNVERIFIED')
    const admin = client(server.url)
    const runtime = client(runtimeUrl.href)
    const otherRuntime = client(runtimeUrl.href)
    return { admin, runtime, otherRuntime, inventory,
      // Only an owned target URL is exposed for child-process recovery CLIs.
      recoveryUrl: server.url,
      runtimeRecoveryUrl: runtimeUrl.href,
      async stop() {
        try { await Promise.all(clients.map(db => db.$disconnect())) }
        finally { try { await bootstrap.end() } finally { await server.stop() } }
      },
    }
  } catch (error) {
    try { await Promise.all(clients.map(db => db.$disconnect())) }
    finally { try { await bootstrap?.end() } finally { await server.stop() } }
    // Driver/bootstrap errors can contain connection material; retain a bounded
    // diagnostic and SQL error code, never a URL or random password.
    throw new Error(`PM_ROLE_BOOTSTRAP_FAILED: ${error.code || error.message?.split('\n')[0]}`)
  }
}

export async function createPmRoleFixture(db, { tenant: existingTenant = null } = {}) {
  const identity = () => ({ code: randomUUID(), name: 'Synthetic B2' })
  let tenant = existingTenant
  if (!tenant) {
    const portfolio = await db.portfolio.create({ data: identity() })
    tenant = await db.tenant.create({ data: { ...identity(), portfolioId: portfolio.id } })
  }
  const business = await db.business.create({ data: { ...identity(), tenantId: tenant.id } })
  const workspace = await db.workspace.create({ data: { ...identity(), scopeType: 'BUSINESS', businessId: business.id, tenantId: tenant.id } })
  const project = await db.project.create({ data: { ...identity(), businessId: business.id, workspaceId: workspace.id } })
  const person = await db.person.create({ data: { code: randomUUID(), displayName: 'Synthetic retained name' } })
  const membership = await db.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER', domainKeysJson: '["projects"]' } })
  const session = await db.session.create({ data: { personId: person.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } })
  const viewer = makeViewer(await resolveViewer({ principalId: person.id, db }))
  const workstream = await db.workstream.create({ data: { ...identity(), projectId: project.id, executionMode: 'SOFTWARE_SPRINT', progressStrategy: 'TASK_WEIGHT' } })
  const item = await db.workItem.create({ data: { code: randomUUID(), title: 'Synthetic item', subtype: 'TASK', workstreamId: workstream.id } })
  return { tenant, business, project, person, membership, item, viewer,
    session: { state: 'AUTHENTICATED', principalId: person.id, sessionId: session.id } }
}
