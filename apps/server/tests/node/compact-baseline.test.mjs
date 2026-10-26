// @spec ADR-115 — reviewed fresh baseline; no transaction escape or psql command transport.
// @tested tests/node/compact-baseline.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { implementation } from './compact-fixtures.mjs'
import { mkdtemp, readFile, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { hash } from './compact-fixtures.mjs'
const api = () => implementation('../../scripts/lib/compact/baseline.mjs')
for (const sql of ['COMMIT; CREATE TABLE "sentinel" (id text);', 'CREATE TABLE "sentinel" (id text); ROLLBACK;', '\\! echo DO_NOT_EXECUTE', 'COPY x FROM PROGRAM \'DO_NOT_EXECUTE\';', 'ALTER SYSTEM SET x = \'1\';']) test(`rejects unsafe baseline ${sql.split(/[ ;]/)[0]}`, async () => {
  const { assertCompactBaselineSql } = await api()
  assert.throws(() => assertCompactBaselineSql(sql), { code: 'COMPACT_BASELINE_INVALID' })
})
test('baseline scanner treats SQL strings, comments and DO bodies as SQL, not outer transactions', async () => {
  const { assertCompactBaselineSql } = await api()
  assert.doesNotThrow(() => assertCompactBaselineSql('-- COMMIT is history\nCREATE TABLE "x" (id text DEFAULT \'COMMIT;\'); DO $guard$ BEGIN PERFORM 1; END $guard$;'))
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
