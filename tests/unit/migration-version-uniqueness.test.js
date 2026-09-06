import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-030 — a migration's version is its identity on production.
// @spec ADR-057; docs/DB-MIGRATION-NOTES.md §Migration discipline
// @tested this file
//
// `supabase_migrations.schema_migrations` is keyed on VERSION, not on file name.
// Two files that share a version are perfectly legal to git — different names,
// no conflict, both merge — and fatal afterwards: whichever runs first takes the
// receipt, and every version-keyed tool then reads the other as already applied
// and skips it in silence. The schema-migration-drift check (preflight 18)
// cannot see this, because it asks whether some file creates a column, and one
// does.
//
// It has happened twice in one day:
//   20260906120000  record_pre_lineage_tables_and_columns  vs  server_line_jobs
//                   caught in review of #234, renumbered before merge
//   20260906180000  line_conversation_job_rls_policy       vs  line_oa_rich_menu_job
//                   NOT caught — both merged; the first was applied and
//                   receipted, the second's DDL was applied with no receipt it
//                   could own, and the lineage stopped describing the database
//
// Both branches were cut from a base that did not yet contain the other's file,
// which is the normal way two people pick the same timestamp. This check is
// cheap, exact and has no false positives: it compares file names and nothing
// else.

const VERSION = /^(\d{14})_(.+?)(?:\.sql)?$/

const versionsIn = (dir) => {
  const entries = readdirSync(resolve(process.cwd(), dir))
    .filter((name) => name.endsWith('.sql') || !name.includes('.'))
  const byVersion = new Map()
  for (const entry of entries) {
    const match = VERSION.exec(entry)
    if (!match) continue
    const [, version] = match
    byVersion.set(version, [...(byVersion.get(version) ?? []), entry])
  }
  return byVersion
}

describe('every migration version is claimed by exactly one migration', () => {
  for (const dir of ['supabase/migrations', 'prisma/migrations']) {
    it(`${dir} has no duplicate version prefix`, () => {
      const duplicates = [...versionsIn(dir)]
        .filter(([, files]) => files.length > 1)
        .map(([version, files]) => `${version}: ${files.join(' , ')}`)
      expect(duplicates).toEqual([])
    })
  }

  it('every version is a plausible timestamp, so the ordering means something', () => {
    // A version that does not sort as a date makes "the migration after this
    // one" meaningless, which is the property the whole lineage rests on.
    for (const dir of ['supabase/migrations', 'prisma/migrations']) {
      for (const version of versionsIn(dir).keys()) {
        const year = Number(version.slice(0, 4))
        const month = Number(version.slice(4, 6))
        const day = Number(version.slice(6, 8))
        expect(year).toBeGreaterThanOrEqual(2020)
        expect(month).toBeGreaterThanOrEqual(1)
        expect(month).toBeLessThanOrEqual(12)
        expect(day).toBeGreaterThanOrEqual(1)
        expect(day).toBeLessThanOrEqual(31)
      }
    }
  })
})
