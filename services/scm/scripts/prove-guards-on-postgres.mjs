#!/usr/bin/env node
// Guard proof: for each concurrency guard the SCM service adds over a legacy
// defect shape (SCM-HANDOFF §7: F-1, F-9, F-12), copy this package to a temp
// directory, remove ONLY that guard in the copy, and run the guard's two-process
// race test on the disposable PostgreSQL (READ COMMITTED, real interleaving) and on
// SQLite. The proof holds when:
//   • the intact copy passes on PostgreSQL (control),
//   • without the guard, the race test FAILS on PostgreSQL in at least one run —
//     i.e. the legacy shape really breaks there, so the guard is necessary,
//   • without the guard, SQLite still passes — i.e. the SQLite suite alone could
//     never have shown it (why the PostgreSQL run is required evidence).
// The working tree is never modified. Usage: node scripts/prove-guards-on-postgres.mjs [--runs=3] [--only=F-1,W-1]
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const runs = Number((process.argv.find((a) => a.startsWith('--runs=')) ?? '--runs=3').split('=')[1])

const GUARDS = [
  {
    finding: 'F-1', guard: 'PurchaseOrder compare-and-swap (D-2)', test: 'recovery/two-process-receipt',
    // Receipt codes are made collision-free in BOTH arms, so the store's retry on a
    // duplicate code cannot re-plan the loser by accident and mask the shape.
    common: [['src/modules/procurement/adapters/procurement-repo.js', 'id, data.code, data.tenantId, data.businessId, data.purchaseOrderId,', 'id, `${data.code}-${id.slice(0, 8)}`, data.tenantId, data.businessId, data.purchaseOrderId,']],
    remove: [['src/modules/procurement/adapters/procurement-repo.js', 'updatedAt = ? WHERE id = ? AND version = ?`,', 'updatedAt = ? WHERE id = ? AND CAST(? AS INTEGER) IS NOT NULL`,']],
  },
  {
    finding: 'F-9', guard: 'order-row lock before the refund ceiling read (D-9)', test: 'recovery/two-process-refund',
    common: [],
    remove: [['src/modules/commerce/application/payments.js', '      repo.lockOrderRow(sql, row.orderId)\n', '']],
  },
  {
    finding: 'F-12', guard: 'one CONFIRMED cost sheet per supplier (D-13)', test: 'recovery/cost-sheet-concurrency',
    common: [],
    remove: [['src/infrastructure/schema.js', "CREATE UNIQUE INDEX IF NOT EXISTS SupplierCostSheet_one_confirmed ON SupplierCostSheet (businessId, supplierId) WHERE status = 'CONFIRMED';\n", '']],
  },
  {
    finding: 'S-1', guard: 'stocktake commit takes the ledger fence before its reads (legacy FR-184 design)', test: 'recovery/two-process-stocktake',
    common: [],
    remove: [['src/modules/inventory/application/stocktake.js', "  // then observes COMMITTED and returns the stored result.\n  const fenceRevision = Number(repo.acquireFence(sql, { tenantId: business.tenantId, businessId: business.id, now: ctx.now }))", "  // then observes COMMITTED and returns the stored result.\n  const fenceRevision = Number(sql.get('SELECT COALESCE(MAX(mutationRevision), 0) AS r FROM InventoryLedgerFence WHERE tenantId = ? AND businessId = ?', business.tenantId, business.id).r)"]],
  },
  {
    finding: 'R-1', guard: 'ledger fence before a new hold reads ATP (D-23)', test: 'recovery/two-process-reservation',
    common: [],
    remove: [['src/modules/inventory/application/atp.js', '  repo.acquireFence(sql, { tenantId: business.tenantId, businessId: business.id, now: ctx.now })\n', '']],
  },
  {
    finding: 'R-2', guard: 'reservation compare-and-swap (D-23)', test: 'recovery/two-process-reservation',
    // Hold codes are made collision-free in BOTH arms: two CONVERTs otherwise pick the
    // same RSV code, and the store's re-run on the duplicate would mask the shape.
    common: [['src/modules/inventory/adapters/wip-repo.js', "const row = { id, ...values, status: 'ACTIVE', version: 1 }", "const row = { id, ...values, code: `${values.code}-${id.slice(0, 8)}`, status: 'ACTIVE', version: 1 }"]],
    remove: [['src/modules/inventory/adapters/wip-repo.js', "WHERE id = ? AND version = ? AND status = 'ACTIVE'`", 'WHERE id = ? AND CAST(? AS INTEGER) IS NOT NULL`']],
  },
  {
    finding: 'I-1', guard: 'catalogue-intake commit locks the intake before it reads the status (D-27)', test: 'recovery/two-process-catalog-intake',
    common: [],
    remove: [['src/modules/inventory/adapters/intake-repo.js', "export const lockIntake = (sql, id) => Number(sql.run('UPDATE InventoryCatalogIntake SET version = version WHERE id = ?', id).changes)", 'export const lockIntake = () => 1']],
  },
  {
    finding: 'W-1', guard: 'work-order compare-and-swap (D-20)', test: 'recovery/two-process-kitting',
    common: [],
    remove: [['src/modules/inventory/adapters/wip-repo.js', 'updatedAt = ? WHERE id = ? AND version = ?`, ...keys.map', 'updatedAt = ? WHERE id = ? AND CAST(? AS INTEGER) IS NOT NULL`, ...keys.map']],
  },
]

function copyWith(edits) {
  const dir = mkdtempSync(join(tmpdir(), 'zuri-s5-guard-'))
  cpSync(root, dir, { recursive: true, filter: (src) => !src.includes('node_modules') })
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction')
  for (const [file, from, to] of edits) {
    const path = join(dir, file)
    const text = readFileSync(path, 'utf8')
    if (text.split(from).length !== 2) throw new Error(`guard anchor not found exactly once in ${file}: ${from.slice(0, 60)}`)
    writeFileSync(path, text.replace(from, to))
  }
  return dir
}

function race(dir, engine, test) {
  const r = spawnSync(process.execPath, ['scripts/run-tests.mjs', `--engine=${engine}`, test], { cwd: dir, encoding: 'utf8', env: { ...process.env, SCM_TEST_ENGINE: engine }, maxBuffer: 64 * 1024 * 1024 })
  const summary = JSON.parse((/SCM test summary: (\{.*\})/.exec(r.stdout) ?? [null, '{}'])[1])
  return { failed: (summary.fail ?? 1) > 0 || summary.pass === 0, diagnostics: [...r.stdout.matchAll(/ℹ (outcomes|two sheets|same sheet): (.*)/g)].map((m) => `${m[1]}: ${m[2]}`) }
}

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length).split(',').filter(Boolean)
const report = []
for (const g of GUARDS.filter((x) => !only.length || only.includes(x.finding))) {
  const intact = copyWith(g.common)
  const removed = copyWith([...g.common, ...g.remove])
  try {
    const control = race(intact, 'postgres', g.test)
    const pg = Array.from({ length: runs }, () => race(removed, 'postgres', g.test))
    const sqlite = race(removed, 'sqlite', g.test)
    const proven = !control.failed && pg.some((r) => r.failed) && !sqlite.failed
    report.push({ finding: g.finding, guard: g.guard, controlPostgresPass: !control.failed, withoutGuardPostgresFailedRuns: `${pg.filter((r) => r.failed).length}/${runs}`, withoutGuardSqlitePass: !sqlite.failed, proven, example: pg.find((r) => r.failed)?.diagnostics ?? [] })
  } finally {
    rmSync(intact, { recursive: true, force: true })
    rmSync(removed, { recursive: true, force: true })
  }
}
process.stdout.write(`${JSON.stringify({ engine: 'postgres 17 (embedded) READ COMMITTED vs sqlite', runs, report }, null, 2)}\n`)
process.exit(report.every((r) => r.proven) ? 0 : 1)
