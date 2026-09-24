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
