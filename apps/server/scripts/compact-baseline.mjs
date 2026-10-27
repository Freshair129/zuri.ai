#!/usr/bin/env node
// @spec ADR-115 — build-time current-schema artifact; no database URL or generated-client mutation.
// @tested tests/node/compact-baseline.test.mjs, tests/postgres/compact-fresh-install.test.js
import { execFileSync } from 'node:child_process'
import { readFile, readdir, mkdir, mkdtemp, writeFile, lstat, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { CompactError } from './lib/compact/manifest.mjs'
import { buildCompactBaseline } from './lib/compact/baseline.mjs'
import { compactProcessEnvironment } from './lib/compact/docker.mjs'
import { stableJson, digest } from './lib/compact/files.mjs'
import { CURRENT_SCHEMA_CONTRACTS } from './lib/compact/security.mjs'
import { assertCompactBaselineSourceIntegrity } from './lib/compact/baseline-source.mjs'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
export async function writeCompactBaseline({ outputDirectory, sourceRevision } = {}) {
  let temporary
  try {
    if (typeof outputDirectory !== 'string' || !/^[a-f0-9]{40}$/.test(sourceRevision)) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
    assertCompactBaselineSourceIntegrity({ root: ROOT, sourceRevision })
    const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
    const canonicalSchema = (await readFile(path.join(ROOT, 'prisma/schema.prisma'), 'utf8')).replaceAll('\r\n', '\n')
    if (git(['show', `${sourceRevision}:apps/server/prisma/schema.prisma`]).replaceAll('\r\n', '\n') !== canonicalSchema.trimEnd()) throw new CompactError('COMPACT_SOURCE_REVISION_MISMATCH')
    const sources = (await readdir(path.join(ROOT, 'supabase/migrations'))).filter(p => p.endsWith('.sql')).map(p => `supabase/migrations/${p}`).sort()
    if (stableJson(sources) !== stableJson(Object.keys(CURRENT_SCHEMA_CONTRACTS).sort())) throw new CompactError('COMPACT_SECURITY_SOURCE_CHANGED')
    for (const file of sources) if (digest((await readFile(path.join(ROOT, file), 'utf8')).replaceAll('\r\n', '\n')) !== CURRENT_SCHEMA_CONTRACTS[file]) throw new CompactError('COMPACT_SECURITY_SOURCE_CHANGED')
    const out = path.resolve(outputDirectory)
    try { await lstat(out); throw new CompactError('COMPACT_OUTPUT_EXISTS') } catch (e) { if (e.code !== 'ENOENT') throw e }
    const parent = path.dirname(out)
    if (!(await lstat(parent)).isDirectory() || path.relative(await realpath(parent), parent) !== '') throw new CompactError('COMPACT_OUTPUT_INVALID')
    const postgresSchema = canonicalSchema.replace(/generator\s+client\s*\{[^}]*\}/, 'generator postgresClient {\n  provider = "prisma-client-js"\n  output = "../unused-generated-client"\n}').replace(/datasource\s+db\s*\{[^}]*\}/, 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")\n}')
    temporary = await mkdtemp(path.join(os.tmpdir(), 'zuri-compact-baseline-'))
    const schema = path.join(temporary, 'schema.postgres.prisma'); await writeFile(schema, postgresSchema)
    const unused = 'postgresql://unused:unused@127.0.0.1:1/compact_schema_only'
    const ddl = execFileSync(process.execPath, [path.join(ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: compactProcessEnvironment({ DATABASE_URL: unused, DIRECT_URL: unused }), stdio: ['ignore', 'pipe', 'pipe'] })
    const result = buildCompactBaseline({ ddl, canonicalSchema, postgresSchema, sourceRevision })
    await mkdir(out)
    await writeFile(path.join(out, 'baseline.sql'), result.sql, { flag: 'wx' })
    await writeFile(path.join(out, 'baseline.json'), stableJson(result.metadata), { flag: 'wx' })
    return { status: 'BASELINE_BUILT', sourceRevision, baselineSha256: result.metadata.baselineSha256 }
  } catch (e) { if (e instanceof CompactError) throw e; throw new CompactError('COMPACT_BASELINE_BUILD_FAILED') }
  finally {
    if (temporary) {
      const physical = await realpath(temporary), parent = await realpath(os.tmpdir())
      if (path.dirname(physical) !== parent || !path.basename(physical).startsWith('zuri-compact-baseline-') || (await lstat(temporary)).isSymbolicLink()) throw new CompactError('COMPACT_TEMPORARY_INVALID')
      await rm(physical, { recursive: true })
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  if (argv.length !== 4 || argv[0] !== '--output' || argv[2] !== '--source-revision') { process.stderr.write('COMPACT_ARGUMENTS_INVALID\n'); process.exitCode = 1 }
  else writeCompactBaseline({ outputDirectory: argv[1], sourceRevision: argv[3] }).then(result => process.stdout.write(JSON.stringify(result) + '\n'), error => { process.stderr.write((error instanceof CompactError ? error.code : 'COMPACT_BASELINE_BUILD_FAILED') + '\n'); process.exitCode = 1 })
}
