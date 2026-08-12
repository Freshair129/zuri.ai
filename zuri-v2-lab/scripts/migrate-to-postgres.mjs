#!/usr/bin/env node
// UUID-preserving Zuri → Postgres/Supabase data cutover, via the provider-agnostic
// backup snapshot (domain-level export/import — NOT a file copy). Two phases run in two
// environments, each with its own generated Prisma client, so a sqlite-built client and
// a postgres-built client never need to coexist:
//
//   1) In the SQLite lab:      node scripts/migrate-to-postgres.mjs export snapshot.json
//   2) Point DATABASE_URL at Supabase, deploy prisma/postgres/0001_init.sql, then:
//      node scripts/migrate-to-postgres.mjs import snapshot.json
//
// importSnapshot recreates every row with its original id, so UUIDs are preserved
// (printed docs, LINE bindings, ExternalRef mappings keep resolving — the hard rule).
//
// @req FR-030 — Postgres/Supabase cutover (ADR-007 P4).
// @spec docs/DB-MIGRATION-NOTES.md §Migration procedure; BR-008 (import previews/confirms).
import { readFileSync, writeFileSync } from 'node:fs'

const [mode, file] = process.argv.slice(2)

async function main() {
  if (!['export', 'import'].includes(mode) || !file) {
    console.error('usage: migrate-to-postgres.mjs <export|import> <snapshot.json>')
    process.exit(2)
  }
  // Imported lazily so the ambient (provider-specific) Prisma client is the one in use.
  const { exportSnapshot, importSnapshot, previewImport } = await import('../src/modules/project-manager/application/backup-service.js')

  if (mode === 'export') {
    const snapshot = await exportSnapshot()
    writeFileSync(file, JSON.stringify(snapshot))
    const counts = Object.fromEntries(Object.entries(snapshot.tables).map(([k, v]) => [k, v.length]))
    console.log('exported snapshot →', file, counts)
    return
  }

  // import
  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  const preview = await previewImport(snapshot)
  if (!preview.valid) {
    console.error('snapshot invalid:', preview.errors)
    process.exit(1)
  }
  if (preview.wouldReplace) {
    console.error('target is not empty — refusing to overwrite. Import into a fresh Postgres DB.')
    process.exit(1)
  }
  const result = await importSnapshot(snapshot, { confirm: true })
  console.log('imported into Postgres (UUIDs preserved):', result.counts)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
