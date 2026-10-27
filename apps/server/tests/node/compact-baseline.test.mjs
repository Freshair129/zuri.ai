// @spec ADR-115 — reviewed fresh baseline; no transaction escape or psql command transport.
// @tested tests/node/compact-baseline.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { implementation } from './compact-fixtures.mjs'
import { mkdtemp, readFile, access, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { hash } from './compact-fixtures.mjs'
import { assertCompactBaselineSourceIntegrity } from '../../scripts/lib/compact/baseline-source.mjs'
const api = () => implementation('../../scripts/lib/compact/baseline.mjs')

const sourceFixtureFiles = {
  '.gitignore': '.brain/session-memory/\n',
  'package.json': '{"name":"compact-fixture"}\n',
  'package-lock.json': '{"lockfileVersion":3}\n',
  'prisma/schema.prisma': 'model Fixture { id String @id }\n',
  'scripts/compact-baseline.mjs': 'export const generator = true\n',
  'scripts/lib/compact/baseline.mjs': 'export const baseline = true\n',
  'scripts/lib/compact/security.mjs': 'export const security = true\n',
  'supabase/migrations/20261027000000_fixture.sql': 'CREATE TABLE fixture (id text);\n'
}

async function createBaselineSourceFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compact-baseline-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [relative, contents] of Object.entries(sourceFixtureFiles)) {
    const file = path.join(root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, contents)
  }
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '--quiet'])
  git(['config', 'user.name', 'Compact source test'])
  git(['config', 'user.email', 'compact-source-test@example.invalid'])
  git(['add', '--all'])
  git(['commit', '--quiet', '-m', 'fixture source'])
  return { root, sourceRevision: git(['rev-parse', 'HEAD']) }
}

for (const sourcePath of ['scripts/compact-baseline.mjs', 'scripts/lib/compact/baseline.mjs', 'scripts/lib/compact/security.mjs', 'prisma/schema.prisma', 'supabase/migrations/20261027000000_fixture.sql', 'package.json', 'package-lock.json']) {
  test(`baseline source binding rejects dirty ${sourcePath}`, async t => {
    const { root, sourceRevision } = await createBaselineSourceFixture(t), file = path.join(root, sourcePath)
    await writeFile(file, `${await readFile(file, 'utf8')}\n// changed after HEAD\n`)
    assert.throws(() => assertCompactBaselineSourceIntegrity({ root, sourceRevision }), { code: 'COMPACT_SOURCE_REVISION_MISMATCH' })
  })
}

test('baseline source binding rejects a staged-only generator change', async t => {
  const { root, sourceRevision } = await createBaselineSourceFixture(t), sourcePath = 'scripts/compact-baseline.mjs', file = path.join(root, sourcePath)
  await writeFile(file, `${await readFile(file, 'utf8')}\n// staged after HEAD\n`)
  execFileSync('git', ['add', '--', sourcePath], { cwd: root, windowsHide: true, stdio: 'ignore' })
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', '--', sourcePath], { cwd: root, windowsHide: true, stdio: 'ignore' }))
  assert.throws(() => execFileSync('git', ['diff', '--cached', '--quiet', 'HEAD', '--', sourcePath], { cwd: root, windowsHide: true, stdio: 'ignore' }))
  assert.throws(() => assertCompactBaselineSourceIntegrity({ root, sourceRevision }), { code: 'COMPACT_SOURCE_REVISION_MISMATCH' })
})

test('baseline source binding rejects an untracked compact library dependency', async t => {
  const { root, sourceRevision } = await createBaselineSourceFixture(t), file = path.join(root, 'scripts/lib/compact/untracked-dependency.mjs')
  await writeFile(file, 'export const unreviewed = true\n')
  assert.throws(() => assertCompactBaselineSourceIntegrity({ root, sourceRevision }), { code: 'COMPACT_SOURCE_REVISION_MISMATCH' })
})

test('baseline source binding ignores unrelated worktree files and ignored session notes', async t => {
  const { root, sourceRevision } = await createBaselineSourceFixture(t)
  await mkdir(path.join(root, '.brain/session-memory'), { recursive: true })
  await writeFile(path.join(root, '.brain/session-memory/local-note.md'), 'private ignored note\n')
  await mkdir(path.join(root, 'docs'), { recursive: true })
  await writeFile(path.join(root, 'docs/unrelated-untracked.md'), 'unrelated\n')
  assert.doesNotThrow(() => assertCompactBaselineSourceIntegrity({ root, sourceRevision }))
})

test('baseline source binding requires the requested revision to be current HEAD', async t => {
  const { root, sourceRevision } = await createBaselineSourceFixture(t)
  assert.throws(() => assertCompactBaselineSourceIntegrity({ root, sourceRevision: 'f'.repeat(40) }), { code: 'COMPACT_SOURCE_REVISION_MISMATCH' })
})

for (const sql of ['COMMIT; CREATE TABLE "sentinel" (id text);', 'CREATE TABLE "sentinel" (id text); ROLLBACK;', '\\! echo DO_NOT_EXECUTE', 'COPY x FROM PROGRAM \'DO_NOT_EXECUTE\';', 'ALTER SYSTEM SET x = \'1\';']) test(`rejects unsafe baseline ${sql.split(/[ ;]/)[0]}`, async () => {
  const { assertCompactBaselineSql } = await api()
  assert.throws(() => assertCompactBaselineSql(sql), { code: 'COMPACT_BASELINE_INVALID' })
})
test('baseline scanner treats SQL strings, comments and DO bodies as SQL, not outer transactions', async () => {
  const { assertCompactBaselineSql } = await api()
  assert.doesNotThrow(() => assertCompactBaselineSql('-- COMMIT is history\nCREATE TABLE "x" (id text DEFAULT \'COMMIT;\'); DO $guard$ BEGIN PERFORM 1; END $guard$;'))
})

test('baseline scanner accepts reviewed fresh trigger/function declarations without transaction escapes', async () => {
  const { assertCompactBaselineSql } = await api()
  assert.doesNotThrow(() => assertCompactBaselineSql('CREATE OR REPLACE FUNCTION report_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER report_guard BEFORE INSERT ON "Report" FOR EACH ROW EXECUTE FUNCTION report_guard();'))
})

test('fresh Marketing guards retain the exact issued function/trigger bodies without replaying the mirror', async () => {
  const { COMPACT_MARKETING_SECURITY_SQL } = await implementation('../../scripts/lib/compact/marketing-security.mjs')
  const issued = (await readFile(new URL('../../supabase/migrations/20261005124416_marketing_external_report.sql', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
  const start = issued.indexOf('CREATE OR REPLACE FUNCTION marketing_report_policy_guard()')
  const end = issued.indexOf('-- PostgreSQL receiver is disabled.', start)
  assert(start > 0 && end > start)
  assert(COMPACT_MARKETING_SECURITY_SQL.includes(issued.slice(start, end).trimEnd()))
  assert.doesNotMatch(COMPACT_MARKETING_SECURITY_SQL, /CREATE TABLE IF NOT EXISTS|^BEGIN;|^COMMIT;/m)
})
test('producer rejects a PostgreSQL model drift instead of certifying a different schema', async () => {
  const { buildCompactBaseline } = await api()
  assert.throws(() => buildCompactBaseline({ ddl: 'CREATE TABLE x(id text);', canonicalSchema: 'model One {\n id String @id\n}\n', postgresSchema: 'datasource db { provider = "postgresql" }\nmodel Other {\n id String @id\n}\n', sourceRevision: 'a'.repeat(40) }), { code: 'COMPACT_BASELINE_INVALID' })
})
test('baseline producer emits immutable files without replacing the generated Prisma client', async () => {
  const { writeCompactBaseline } = await implementation('../../scripts/compact-baseline.mjs'), root = await mkdtemp(path.join(os.tmpdir(), 'compact baseline ; $() '))
  const server = fileURLToPath(new URL('../../', import.meta.url)), revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: server, encoding: 'utf8' }).trim()
  const client = path.join(server, 'node_modules/@zuri/prisma-postgres/schema.prisma'), before = hash(await readFile(client)), outputDirectory = path.join(root, 'schema')
  await assert.rejects(writeCompactBaseline({ outputDirectory: path.join(root, 'wrong'), sourceRevision: 'f'.repeat(40) }), { code: 'COMPACT_SOURCE_REVISION_MISMATCH' })
  await assert.rejects(access(path.join(root, 'wrong')))
  await writeCompactBaseline({ outputDirectory, sourceRevision: revision })
  const metadata = JSON.parse(await readFile(path.join(outputDirectory, 'baseline.json'))), sql = await readFile(path.join(outputDirectory, 'baseline.sql'))
  assert.equal(metadata.sourceRevision, revision); assert.equal(hash(sql), metadata.baselineSha256)
  assert.equal(hash(await readFile(client)), before)
  await assert.rejects(writeCompactBaseline({ outputDirectory, sourceRevision: revision }), { code: 'COMPACT_OUTPUT_EXISTS' })
})
