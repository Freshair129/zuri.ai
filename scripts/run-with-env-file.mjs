#!/usr/bin/env node
// Run the Windows entrypoint with the ignored .env loaded into this process tree only.
// Existing environment variables win; secret values are never printed.
//
// @req FR-030, FR-046 — the selected application provider reaches the runtime process.
// @spec ADR-035, SEC-011 — environment authority is process-local and secret-safe.
// @tested tests/unit/postgres-runtime-bootstrap.test.js
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const batchIndex = process.argv.indexOf('--batch-path')
const batchPath = batchIndex >= 0 ? process.argv[batchIndex + 1] : null

if (!batchPath) {
  console.error('usage: run-with-env-file.mjs --batch-path <entrypoint.bat>')
  process.exit(2)
}

const resolvedBatch = resolve(batchPath)
const relativeBatch = relative(root, resolvedBatch)
if (!relativeBatch || relativeBatch.startsWith('..') || isAbsolute(relativeBatch)) {
  console.error('ZURI_RUNTIME_BATCH_OUTSIDE_REPOSITORY')
  process.exit(1)
}

const childEnv = { ...process.env }
const envFile = resolve(root, '.env')
if (existsSync(envFile)) {
  const fileEnv = parseEnv(readFileSync(envFile, 'utf8'))
  for (const [key, value] of Object.entries(fileEnv)) {
    if (childEnv[key] === undefined) childEnv[key] = value
  }
  console.log('[zuri] Loaded runtime environment from .env (values omitted).')
}

const commandShell = childEnv.ComSpec || process.env.ComSpec || 'cmd.exe'
const child = spawn(commandShell, ['/d', '/c', resolvedBatch], {
  cwd: root,
  env: childEnv,
  stdio: 'inherit',
})

child.on('error', () => {
  console.error('ZURI_RUNTIME_BATCH_START_FAILED')
  process.exitCode = 1
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
