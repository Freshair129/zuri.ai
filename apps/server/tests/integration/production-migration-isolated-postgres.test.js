import pg from 'pg'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RECONCILIATION_PLAN,
  runReconciliationPlan,
} from '../../scripts/production-migration-reconcile.mjs'
import {
  assertOutsideRepository,
  captureDatabaseBaseline,
  verifyDependencyBackup,
} from '../../scripts/production-migration-evidence.mjs'
import { assertOwnedDisposableTestDatabase } from '../../scripts/production-migration-test-target.mjs'

// @req FR-084 — prove additive PostgreSQL migration, exact receipt, rollback,
//   legacy NULL preservation and baseline restoration in a disposable database.
// @spec ADR-104 D3/D5
// @tested tests/integration/production-migration-isolated-postgres.test.js

const databaseUrl = process.env.PM_MIGRATION_TEST_DATABASE_URL
const containerId = process.env.PM_MIGRATION_TEST_CONTAINER_ID
const ownerToken = process.env.PM_MIGRATION_TEST_OWNER_TOKEN
const repositoryRoot = path.resolve(process.cwd(), '../..')

describe.skipIf(!databaseUrl)('production migration operator on isolated PostgreSQL', () => {
  let client
  let target
  let initialBaseline
  let snapshotPath
  let snapshotArtifact
  let evidenceDirectory
  const handoffMigration = RECONCILIATION_PLAN.find((item) => item.version === '20261024010000')

  beforeAll(async () => {
    if (!containerId || !ownerToken) {
      throw new Error('isolated migration proof requires the test-owned disposable PostgreSQL harness')
    }

    let inspected
    try {
      inspected = JSON.parse(execFileSync('docker', ['inspect', containerId], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }))[0]
    } catch {
      throw new Error('isolated migration proof could not verify its Docker-owned database')
    }
    const isolatedTarget = assertOwnedDisposableTestDatabase({
      databaseUrl, containerId, ownerToken, container: inspected,
    })

    client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
    await client.connect()
    const identity = (await client.query(`
      select current_user as "user", current_database() as database
    `)).rows[0]
    if (identity.user !== 'postgres' || identity.database !== 'pm_migration_test') {
      throw new Error('refuse to run isolated migration proof outside the disposable test database')
    }

    target = {
      projectRef: 'isolated-test',
      host: isolatedTarget.host,
      port: isolatedTarget.port,
      database: isolatedTarget.database,
    }
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuri_app_runtime') THEN
          CREATE ROLE zuri_app_runtime NOLOGIN;
        END IF;
      END $$
    `)
    await client.query('CREATE SCHEMA supabase_migrations')
    await client.query(`
      CREATE TABLE supabase_migrations.schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL
      )
    `)
    await createDependencyTable()
    await client.query(`
      INSERT INTO public."Dependency" (id, "sourceType", "sourceId", "targetType", "targetId", "dependencyType")
      VALUES
        ('legacy-1', 'PROJECT', 'p-1', 'PROJECT', 'p-2', 'BLOCKS'),
        ('legacy-2', 'WORKSTREAM', 'w-1', 'PROJECT', 'p-2', 'SUPPORTS')
    `)
    initialBaseline = await captureDatabaseBaseline(client, target)

    evidenceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-migration-recovery-'))
    snapshotPath = path.join(evidenceDirectory, 'synthetic-protected-snapshot.json')
    const dependencyPath = `${snapshotPath}.dependency.ndjson`
    const dependencyHandle = fs.openSync(dependencyPath, 'wx')
    const sidecarBaseline = await captureDatabaseBaseline(client, target, {
      onDependencyRow: async (rowJson) => fs.writeSync(dependencyHandle, `${rowJson}\n`, null, 'utf8'),
    })
    fs.fsyncSync(dependencyHandle)
    fs.closeSync(dependencyHandle)
    expect(sidecarBaseline.baselineId).toBe(initialBaseline.baselineId)
    assertOutsideRepository(snapshotPath, repositoryRoot)
    fs.writeFileSync(snapshotPath, `${JSON.stringify({ kind: 'synthetic-test-snapshot' })}\n`, { flag: 'wx' })
    snapshotArtifact = {
      baseline: sidecarBaseline.baseline,
      dependencyBackup: {
        file: path.basename(dependencyPath),
        rowCount: sidecarBaseline.baseline.dependency.rowCount,
        sha256: sidecarBaseline.baseline.dependency.fullRowsSha256,
      },
    }
  }, 30_000)

  afterAll(async () => {
    await client?.end().catch(() => {})
    if (evidenceDirectory) fs.rmSync(evidenceDirectory, { recursive: true, force: true })
  })

  it('refuses production-path execution when any prior migration receipt is missing', async () => {
    await expect(runReconciliationPlan(client, {
      apply: true,
      target,
      expectedBaseline: initialBaseline,
      plan: [handoffMigration],
      requirePriorReconciliation: true,
    })).rejects.toThrow(/prior migration .* missing from ledger/)
    expect((await client.query(`
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'Dependency' and column_name = 'contractJson'
    `)).rows).toHaveLength(0)
    expect((await client.query('select * from supabase_migrations.schema_migrations')).rows).toHaveLength(0)
  }, 30_000)

  it('captures the Dependency baseline only after waiting for concurrent writers', async () => {
    const writer = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
    const monitor = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
    await writer.connect()
    await monitor.connect()
    const operatorPid = Number((await client.query('select pg_backend_pid() as pid')).rows[0].pid)
    let resultPromise
    let writerTransactionOpen = false

    try {
      await writer.query('BEGIN')
      writerTransactionOpen = true
      await writer.query(`
        UPDATE public."Dependency" SET "targetId" = 'p-concurrent'
        WHERE id = 'legacy-1'
      `)
      resultPromise = runReconciliationPlan(client, {
        apply: false,
        target,
        expectedBaseline: initialBaseline,
        plan: [handoffMigration],
      }).then((value) => ({ value }), (error) => ({ error }))

      let waitingForLock = false
      const deadline = Date.now() + 5_000
      while (!waitingForLock && Date.now() < deadline) {
        const state = (await monitor.query(`
          select wait_event_type
          from pg_stat_activity
          where pid = $1
        `, [operatorPid])).rows[0]
        waitingForLock = state?.wait_event_type === 'Lock'
        if (!waitingForLock) await new Promise((resolve) => setTimeout(resolve, 50))
      }

      await writer.query('COMMIT')
      writerTransactionOpen = false
      const result = await resultPromise
      expect(waitingForLock).toBe(true)
      expect(result.error?.message).toMatch(/baseline differs/)
      await writer.query(`
        UPDATE public."Dependency" SET "targetId" = 'p-2'
        WHERE id = 'legacy-1'
      `)
      expect((await captureDatabaseBaseline(client, target)).baselineId).toBe(initialBaseline.baselineId)
    } finally {
      if (writerTransactionOpen) await writer.query('ROLLBACK').catch(() => {})
      if (resultPromise) await resultPromise
      await writer.end().catch(() => {})
      await monitor.end().catch(() => {})
    }
  }, 30_000)

  it('refuses partial catalog/ledger states and rolls back a failed postcondition', async () => {
    await client.query(`
      INSERT INTO supabase_migrations.schema_migrations (version, name)
      VALUES ('20261024010000', 'wrong_name')
    `)
    const wrongLedger = await captureDatabaseBaseline(client, target)
    await expect(runReconciliationPlan(client, {
      apply: true, target, expectedBaseline: wrongLedger, plan: [handoffMigration],
    })).rejects.toThrow(/ledger name mismatch/)
    expect((await captureDatabaseBaseline(client, target)).baselineId).toBe(wrongLedger.baselineId)
    await client.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261024010000'`)

    await client.query(`ALTER TABLE public."Dependency" ADD COLUMN "contractJson" TEXT`)
    const partialColumn = await captureDatabaseBaseline(client, target)
    await expect(runReconciliationPlan(client, {
      apply: true, target, expectedBaseline: partialColumn, plan: [handoffMigration],
    })).rejects.toThrow(/expected absent column/)
    await client.query(`ALTER TABLE public."Dependency" DROP COLUMN "contractJson"`)

    const invalidPostcondition = {
      ...handoffMigration,
      post: {
        columnDefinitions: [{
          table: 'Dependency', column: 'contractJson', dataType: 'text',
          isNullable: 'NO', columnDefault: null,
        }],
      },
    }
    await expect(runReconciliationPlan(client, {
      apply: true, target, expectedBaseline: initialBaseline, plan: [invalidPostcondition],
    })).rejects.toThrow(/catalog postcondition failed/)
    expect((await captureDatabaseBaseline(client, target)).baselineId).toBe(initialBaseline.baselineId)
    expect((await client.query(`select * from supabase_migrations.schema_migrations`)).rows).toHaveLength(0)
  }, 30_000)

  it('rolls back dry run, applies the exact nullable column and restores from the verified NDJSON sidecar', async () => {
    const dryRun = await runReconciliationPlan(client, {
      apply: false,
      target,
      expectedBaseline: initialBaseline,
      plan: [handoffMigration],
    })
    expect(dryRun).toMatchObject([
      { version: '20261024010000', name: 'dependency_handoff', mode: 'apply', status: 'RECORDED' },
    ])
    expect((await client.query(`
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'Dependency' and column_name = 'contractJson'
    `)).rows).toHaveLength(0)
    expect((await client.query(`select * from supabase_migrations.schema_migrations`)).rows).toHaveLength(0)

    const applied = await runReconciliationPlan(client, {
      apply: true,
      target,
      expectedBaseline: initialBaseline,
      plan: [handoffMigration],
    })
    expect(applied).toMatchObject([
      { version: '20261024010000', name: 'dependency_handoff', mode: 'apply', status: 'RECORDED' },
    ])
    expect((await client.query(`
      select data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'Dependency' and column_name = 'contractJson'
    `)).rows).toEqual([{ data_type: 'text', is_nullable: 'YES', column_default: null }])
    expect((await client.query(`
      select version, name from supabase_migrations.schema_migrations
    `)).rows).toEqual([{ version: '20261024010000', name: 'dependency_handoff' }])
    expect((await client.query(`
      select count(*)::int as total, count(*) filter (where "contractJson" is null)::int as legacy_nulls
      from public."Dependency"
    `)).rows[0]).toEqual({ total: 2, legacy_nulls: 2 })

    await client.query(`
      UPDATE public."Dependency" SET "contractJson" = '{"link":true}'
      WHERE id = 'legacy-1'
    `)
    const valueSnapshotPath = path.join(evidenceDirectory, 'post-apply-snapshot.json')
    const valueSidecarPath = `${valueSnapshotPath}.dependency.ndjson`
    const valueSidecarHandle = fs.openSync(valueSidecarPath, 'wx')
    const appliedBaseline = await captureDatabaseBaseline(client, target, {
      onDependencyRow: async (rowJson) => fs.writeSync(valueSidecarHandle, `${rowJson}\n`, null, 'utf8'),
    })
    fs.fsyncSync(valueSidecarHandle)
    fs.closeSync(valueSidecarHandle)
    expect(appliedBaseline.baseline.dependency.rowsSha256)
      .toBe(initialBaseline.baseline.dependency.rowsSha256)
    expect(appliedBaseline.baseline.dependency.fullRowsSha256)
      .not.toBe(initialBaseline.baseline.dependency.fullRowsSha256)
    const valueSnapshot = {
      baseline: appliedBaseline.baseline,
      dependencyBackup: {
        file: path.basename(valueSidecarPath),
        rowCount: appliedBaseline.baseline.dependency.rowCount,
        sha256: appliedBaseline.baseline.dependency.fullRowsSha256,
      },
    }
    fs.writeFileSync(valueSnapshotPath, `${JSON.stringify(valueSnapshot)}\n`, { flag: 'wx' })
    await verifyDependencyBackup(valueSnapshot, valueSnapshotPath, repositoryRoot)
    const backedUpValue = fs.readFileSync(valueSidecarPath, 'utf8')
      .split('\n').filter(Boolean).map((row) => JSON.parse(row)).find((row) => row.id === 'legacy-1')
    expect(backedUpValue.contractJson).toBe('{"link":true}')

    const alreadyApplied = await runReconciliationPlan(client, {
      apply: false,
      target,
      expectedBaseline: appliedBaseline,
      plan: [handoffMigration],
    })
    expect(alreadyApplied).toMatchObject([
      { version: '20261024010000', name: 'dependency_handoff', status: 'ALREADY_APPLIED' },
    ])

    const verifiedSidecarPath = await verifyDependencyBackup(snapshotArtifact, snapshotPath, repositoryRoot)
    expect(verifiedSidecarPath).toBe(`${snapshotPath}.dependency.ndjson`)
    await client.query('DROP TABLE public."Dependency"')
    await createDependencyTable(true)
    await restoreRowsFromSidecar(valueSidecarPath)
    const valueRestored = await captureDatabaseBaseline(client, target)
    expect(valueRestored.baselineId).toBe(appliedBaseline.baselineId)
    expect(valueRestored.baseline.dependency.fullRowsSha256)
      .toBe(appliedBaseline.baseline.dependency.fullRowsSha256)

    await client.query('DROP TABLE public."Dependency"')
    await client.query('DELETE FROM supabase_migrations.schema_migrations')
    await createDependencyTable()
    await restoreRowsFromSidecar(verifiedSidecarPath)
    const restored = await captureDatabaseBaseline(client, target)
    expect(restored.baselineId).toBe(initialBaseline.baselineId)
    expect(restored.baseline.dependency.rowsSha256).toBe(initialBaseline.baseline.dependency.rowsSha256)
  }, 30_000)

  async function createDependencyTable(includeContractJson = false) {
    await client.query(`
      CREATE TABLE public."Dependency" (
        id text PRIMARY KEY,
        "sourceType" text NOT NULL,
        "sourceId" text NOT NULL,
        "targetType" text NOT NULL,
        "targetId" text NOT NULL,
        "dependencyType" text NOT NULL,
        "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ${includeContractJson ? '"contractJson" text,' : ''}
        CONSTRAINT "Dependency_edge_key" UNIQUE ("sourceType", "sourceId", "targetType", "targetId", "dependencyType")
      )
    `)
    await client.query('ALTER TABLE public."Dependency" ENABLE ROW LEVEL SECURITY')
    await client.query('ALTER TABLE public."Dependency" FORCE ROW LEVEL SECURITY')
    await client.query(`
      CREATE POLICY zuri_app_runtime_all ON public."Dependency"
      FOR ALL TO zuri_app_runtime USING (true) WITH CHECK (true)
    `)
    await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON public."Dependency" TO zuri_app_runtime')
  }

  async function restoreRowsFromSidecar(filePath) {
    const rows = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity })
    for await (const line of rows) {
      if (!line) continue
      const row = JSON.parse(line)
      await client.query(`
        INSERT INTO public."Dependency"
        SELECT * FROM jsonb_populate_record(NULL::public."Dependency", $1::jsonb)
      `, [JSON.stringify(row)])
    }
  }
})
