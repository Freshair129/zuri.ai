#!/usr/bin/env node
// Generate both provider-specific Prisma clients. SQLite remains the local/test
// default; the Postgres client is emitted separately for production Supabase.
//
// @req FR-030, FR-076, FR-078 — production application DB uses the Postgres
// schema while local/test persistence remains SQLite.
// @spec ADR-018, docs/DB-MIGRATION-NOTES.md.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const prismaCli = resolve(root, 'node_modules/prisma/build/index.js')
const postgresClientPackage = '@zuri/prisma-postgres'

function run(args) {
  execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    stdio: 'inherit',
  })
}

run(['generate'])
execFileSync(process.execPath, ['scripts/gen-postgres-schema.mjs'], {
  cwd: root,
  stdio: 'inherit',
})
run(['generate', '--schema', 'prisma/schema.postgres.prisma'])

const postgresClientPackageJson = resolve(root, 'node_modules/@zuri/prisma-postgres/package.json')
const generatedPackage = JSON.parse(readFileSync(postgresClientPackageJson, 'utf8'))
generatedPackage.name = postgresClientPackage
writeFileSync(postgresClientPackageJson, `${JSON.stringify(generatedPackage, null, 2)}\n`)
