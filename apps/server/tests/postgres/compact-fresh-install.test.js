// @spec ADR-115 — actual fresh PostgreSQL catalog/role/rollback on unique disposable resources.
// @tested tests/postgres/compact-fresh-install.test.js
import { beforeAll, afterAll, describe, it, expect, inject } from 'vitest'
import assert from 'node:assert/strict'
import { readFile, rename } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { compactFixture } from '../helpers/compact-postgres-target'
import { createPmRoleFixture, startPmRoleTarget, PM_TABLES } from '../helpers/pm-role-target'
import { PrismaClient } from '@zuri/prisma-postgres'
import { runCompactDocker } from '../../scripts/lib/compact/docker.mjs'

let packageApi, baselineApi, executorApi, policyReference
const fixtures = [], clients = []
const make = async options => { assert.equal(typeof baselineApi?.buildCompactBaseline, 'function', 'Compact Task2 baseline implementation is missing'); assert.equal(typeof executorApi?.executeCompactInstall, 'function', 'Compact Task2 executor implementation is missing'); const f = await compactFixture({ packageApi, baselineApi, executorApi, ...options }); fixtures.push(f); return f }
async function module(relative) { try { return await import(relative) } catch (e) { if (['ERR_MODULE_NOT_FOUND', 'ERR_LOAD_URL'].includes(e.code) || e.message?.startsWith(`Failed to load url ${relative} `)) return null; throw e } }
const columns = `SELECT table_name,column_name,udt_name,is_nullable,column_default,character_maximum_length FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`
const constraints = `SELECT cl.relname AS table_name,c.contype,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND c.contype IN ('p','f','u') ORDER BY cl.relname,c.contype,definition`
const policies = `SELECT tablename,policyname,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname`

beforeAll(async () => {
  packageApi = await module('../../scripts/compact-package.mjs')
  baselineApi = await module('../../scripts/lib/compact/baseline.mjs')
  executorApi = await module('../../scripts/lib/compact/executor.mjs')
}, 120000)
afterAll(async () => { try { await Promise.all(clients.map(c => c.$disconnect())); await policyReference?.stop() } finally { for (const f of fixtures.reverse()) await f.close() } }, 120000)

describe('Compact fresh-only PostgreSQL', () => {
  it('installs current model catalog with non-owner runtime and exact Phase B policies', async () => {
    const f = await make(), result = await f.install()
    expect(result.status).toBe('INSTALLED')
    const reference = new pg.Client({ connectionString: inject('testDatabaseUrl') }); await reference.connect()
    let columnCount, tableCount
    try {
      const actualColumns = (await f.query(columns)).rows; columnCount = actualColumns.length; tableCount = new Set(actualColumns.map(row => row.table_name)).size
      expect(actualColumns).toEqual((await reference.query(columns)).rows)
      expect((await f.query(constraints)).rows).toEqual((await reference.query(constraints)).rows)
    } finally { await reference.end() }
    policyReference = await startPmRoleTarget()
    expect((await f.query(policies, [PM_TABLES])).rows).toEqual(await policyReference.admin.$queryRawUnsafe(policies, PM_TABLES))
    const shape = (await f.query(`SELECT c.relname,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND k.contype='c' AND c.relname=ANY($1::text[]) ORDER BY c.relname,definition`, [PM_TABLES])).rows
    expect(shape).toEqual(await policyReference.admin.$queryRawUnsafe(`SELECT c.relname,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND k.contype='c' AND c.relname=ANY($1::text[]) ORDER BY c.relname,definition`, PM_TABLES))
    const facts = (await f.query(`SELECT current_user,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,pg_get_userbyid(d.datdba) AS owner FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`, [], true)).rows[0]
    expect(facts).toMatchObject({ current_user: 'zuri_web_login', rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, owner: 'compact_bootstrap' })
    expect((await f.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`)).rows[0].n).toBe(0)
    expect((await f.query(`SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create,pg_has_role(current_user,'compact_bootstrap','MEMBER') AS owner_member`, [], true)).rows[0]).toEqual({ can_create: false, owner_member: false })
    expect((await f.query(`SELECT r.rolname,admin_option,inherit_option,set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='zuri_web_login'`)).rows).toEqual([{ rolname: 'zuri_app_runtime', admin_option: false, inherit_option: true, set_option: false }])
    const runtimeUrl = `postgresql://zuri_web_login:${f.runtimePassword}@127.0.0.1:${f.target.database.port}/${f.target.database.name}`
    const adminUrl = `postgresql://compact_bootstrap:${f.bootstrapPassword}@127.0.0.1:${f.target.database.port}/${f.target.database.name}`
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } }), runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } }); clients.push(admin, runtime)
    const a = await createPmRoleFixture(admin), b = await createPmRoleFixture(admin)
    const input = fixture => ({ id: randomUUID(), tenantId: fixture.tenant.id, businessId: fixture.business.id, projectId: fixture.project.id, code: randomUUID(), title: 'Fresh contract', problem: 'Synthetic qualification', outcome: 'Scoped SQL', primaryDomainId: 'DOM-COMMERCE', lifecycle: 'DRAFT' })
    await expect(runtime.projectFeature.create({ data: input(a) })).rejects.toThrow(/row.level security/i)
    await runtime.$transaction(async tx => {
      await tx.$queryRawUnsafe("SELECT set_config('zuri.pm_tenant_id',$1,true),set_config('zuri.pm_business_id',$2,true)", a.tenant.id, a.business.id)
      const made = await tx.projectFeature.create({ data: input(a) }); expect(made.businessId).toBe(a.business.id)
    })
    await expect(runtime.$transaction(async tx => { await tx.$queryRawUnsafe("SELECT set_config('zuri.pm_tenant_id',$1,true),set_config('zuri.pm_business_id',$2,true)", a.tenant.id, a.business.id); return tx.projectFeature.create({ data: input(b) }) })).rejects.toThrow(/row.level security/i)
    await expect(f.query('UPDATE "GovernanceSnapshot" SET "validationStatus"=\'INVALID\' WHERE false', [], true)).rejects.toMatchObject({ code: '42501' })
    const before = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    expect((await f.install()).status).toBe('INSTALLED')
    const after = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    expect(after).toEqual(before)
    expect(await admin.projectFeature.count()).toBe(1)
    await f.recordEvidence('core-parity-and-retry', before, after, { modelTables: tableCount, modelColumns: columnCount, phaseBChecks: shape.length, phaseBPolicies: 8, retainedFeatureRows: 1, runtimeRole: facts })
  }, 120000)

  it('rolls back all DDL and role creation on an injected baseline failure', async () => {
    const f = await make({ corruptDdl: true }), credentials = await executorApi.readCompactCredentials(f.target)
    const before = await f.driver.create({ manifest: f.manifest, target: f.target, credentials })
    await expect(f.install()).rejects.toMatchObject({ code: 'COMPACT_INITIALIZATION_FAILED' })
    const o = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    expect(o.database.objectCount).toBe(0); expect(o.database.runtimeRoles).toEqual([]); expect(o.database.installation).toBeNull()
    expect((await f.query(`SELECT to_regclass('public."MustRollback"') AS relation`)).rows[0].relation).toBeNull()
    expect(o).toEqual(before)
    await f.recordEvidence('transaction-rollback', before, o, { injectedDdlFailed: true, applicationObjects: 0, runtimeRoles: 0 })
  }, 120000)

  it('preserves populated data and exact owned volume identities on retry refusal', async () => {
    const f = await make(), credentials = await executorApi.readCompactCredentials(f.target)
    await f.driver.create({ manifest: f.manifest, target: f.target, credentials })
    await f.query('CREATE TABLE "ForeignSentinel" (id text PRIMARY KEY); INSERT INTO "ForeignSentinel" VALUES (\'retained\')')
    const before = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    await expect(f.install()).rejects.toMatchObject({ code: 'COMPACT_DATABASE_NOT_EMPTY' })
    expect(await f.driver.inspect({ manifest: f.manifest, target: f.target })).toEqual(before)
    expect((await f.query('SELECT id FROM "ForeignSentinel"')).rows).toEqual([{ id: 'retained' }])
    await f.recordEvidence('populated-target-refusal', before, await f.driver.inspect({ manifest: f.manifest, target: f.target }), { retainedSentinelRows: 1 })
  }, 120000)

  it('refuses an existing foreign volume without altering it or creating a container', async () => {
    const f = await make(); await f.foreignVolume()
    const before = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    await expect(f.install()).rejects.toMatchObject({ code: 'COMPACT_FOREIGN_RESOURCE' })
    expect(await f.driver.inspect({ manifest: f.manifest, target: f.target })).toEqual(before)
    expect(before.container).toBeNull()
    await f.recordEvidence('foreign-volume-refusal', before, await f.driver.inspect({ manifest: f.manifest, target: f.target }), { noContainerCreated: true })
  }, 120000)

  it('refuses installed catalog drift without repairing or reinitializing it', async () => {
    const f = await make(); await f.install()
    await f.query('ALTER TABLE "Person" ADD COLUMN "foreignChange" TEXT')
    const before = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    await expect(f.install()).rejects.toMatchObject({ code: 'COMPACT_SCHEMA_DRIFT' })
    expect(await f.driver.inspect({ manifest: f.manifest, target: f.target })).toEqual(before)
    await f.recordEvidence('schema-drift-refusal', before, await f.driver.inspect({ manifest: f.manifest, target: f.target }), { noRepair: true })
  }, 120000)

  it('refuses lost runtime CONNECT privilege instead of reporting an installed usable role', async () => {
    const f = await make(); await f.install()
    await f.query(`REVOKE CONNECT ON DATABASE "${f.target.database.name}" FROM zuri_app_runtime`)
    await expect(f.query('SELECT current_user', [], true)).rejects.toMatchObject({ code: '42501' })
    const before = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    await expect(f.install()).rejects.toMatchObject({ code: 'COMPACT_SCHEMA_DRIFT' })
    expect(await f.driver.inspect({ manifest: f.manifest, target: f.target })).toEqual(before)
    await f.recordEvidence('connect-revocation-refusal', before, await f.driver.inspect({ manifest: f.manifest, target: f.target }), { runtimeConnectDenied: true, noRepair: true })
  }, 120000)

  it('preserves current pricing grants and IAM check constraints beyond Prisma models', async () => {
    const f = await make(); await f.install()
    await expect(f.query('DELETE FROM "PricingRuleSet" WHERE false', [], true)).rejects.toMatchObject({ code: '42501' })
    await expect(f.query('UPDATE "PricingCalculation" SET "inputHash"=\'forged\' WHERE false', [], true)).rejects.toMatchObject({ code: '42501' })
    const admin = new PrismaClient({ datasources: { db: { url: `postgresql://compact_bootstrap:${f.bootstrapPassword}@127.0.0.1:${f.target.database.port}/${f.target.database.name}` } } }); clients.push(admin)
    const a = await createPmRoleFixture(admin)
    await expect(f.query('UPDATE "Membership" SET "status"=\'FORGED\' WHERE "id"=$1', [a.membership.id])).rejects.toMatchObject({ code: '23514' })
    await expect(f.query('UPDATE "Business" SET "provisioningTemplateId"=\'partial\' WHERE "id"=$1', [a.business.id])).rejects.toMatchObject({ code: '23514' })
    const observed = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    await f.recordEvidence('pricing-and-iam-contracts', observed, observed, { pricingDeleteDenied: true, calculationUpdateDenied: true, membershipCheckRejected: true, provisioningCheckRejected: true })
  }, 120000)

  it('refuses preexisting large objects even when public has no application table', async () => {
    const f = await make(), credentials = await executorApi.readCompactCredentials(f.target)
    await f.driver.create({ manifest: f.manifest, target: f.target, credentials })
    await f.query('SELECT lo_create(987654)')
    const before = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    await expect(f.install()).rejects.toMatchObject({ code: 'COMPACT_DATABASE_NOT_EMPTY' })
    expect(await f.driver.inspect({ manifest: f.manifest, target: f.target })).toEqual(before)
    expect((await f.query('SELECT count(*)::int AS n FROM pg_largeobject_metadata')).rows[0].n).toBe(1)
    await f.recordEvidence('large-object-refusal', before, await f.driver.inspect({ manifest: f.manifest, target: f.target }), { retainedLargeObjects: 1 })
  }, 120000)

  it('rechecks emptiness inside the atomic SQL boundary after a concurrent writer appears', async () => {
    const f = await make(); let raced = false
    const driver = executorApi.createCompactDockerDriver({ run: async (args, options) => {
      if (args.includes('--single-transaction') && !raced) {
        raced = true
        const seeded = await runCompactDocker(args.filter(a => a !== '--single-transaction'), { ...options, input: 'CREATE TABLE "RaceSentinel" (id text); INSERT INTO "RaceSentinel" VALUES (\'retained\');' })
        expect(seeded.status).toBe(0)
      }
      return runCompactDocker(args, options)
    } })
    await expect(executorApi.executeCompactInstall({ packageDirectory: f.release, target: f.target, driver })).rejects.toMatchObject({ code: 'COMPACT_INITIALIZATION_FAILED' })
    expect(raced).toBe(true)
    expect((await f.query('SELECT id FROM "RaceSentinel"')).rows).toEqual([{ id: 'retained' }])
    const o = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    expect(o.database.installation).toBeNull(); expect(o.database.runtimeRoles).toEqual([])
    expect((await f.query('SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=\'public\'')).rows[0].n).toBe(1)
    await f.recordEvidence('racing-writer-refusal', o, o, { retainedSentinelRows: 1, applicationTables: 1, installationAbsent: true })
  }, 120000)

  it('runs the packaged bare-Node CLI after source relocation, and stop preserves volumes', async () => {
    const f = await make(); await f.install()
    await rename(path.join(f.root, 'input'), path.join(f.root, 'source unavailable'))
    await rename(f.target.secretFiles.bootstrapEnvironment, path.join(f.root, 'missing bootstrap.env'))
    await rename(f.target.secretFiles.runtimeEnvironment, path.join(f.root, 'missing runtime.env'))
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOME', 'TEMP', 'TMP'].includes(k.toUpperCase())))
    const command = verb => JSON.parse(execFileSync(process.execPath, [path.join(f.release, 'compact-self-host.mjs'), verb, '--package', f.release, '--target', f.targetFile], { cwd: os.tmpdir(), env, windowsHide: true, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }))
    expect(command('status').status).toBe('INSTALLED')
    const before = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    expect(command('stop').status).toBe('STOPPED')
    const after = await f.driver.inspect({ manifest: f.manifest, target: f.target })
    expect(after.volumes).toEqual(before.volumes); expect(after.container.id).toBe(before.container.id)
    expect(command('status').status).toBe('STOPPED_UNVERIFIED')
    await f.recordEvidence('relocated-cli-stop', before, after, { privateCredentialFilesAbsent: true, sameContainer: true, sameVolumes: true, stoppedStatusUnverified: true })
  }, 120000)
})
