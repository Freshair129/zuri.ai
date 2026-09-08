// @req FR-172 — the real knowledge admission acceptance is isolated, native
// prerequisite-gated, and cannot report success without executing a test.
// @spec ADR-072, ADR-071
// @tested tests/acceptance/knowledge-admission-native.test.js
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (/^(POSTGRES_|DATABASE_POSTGRES_URL$|DATABASE_URL$|MSP_DB_PATH$|GKS_DB_PATH$|GENESIS_DB_PATH$|ZURI_KNOWLEDGE_|ZURI_MSP_|MSP_GKS_|MSP_PIPELINE_|GKS_PIPELINE_)/.test(key)) delete env[key]
}
for (const key of ['KI17_MSP_ROOT', 'KI17_GKS_ROOT', 'KI17_GENESIS_ROOT', 'KI17_MODEL_DIR']) {
  if (!env[key] || !path.isAbsolute(env[key]) || !existsSync(env[key])) {
    throw new Error(`${key} must explicitly name an existing isolated runtime/model directory; this suite never skips missing prerequisites`)
  }
}

const result = spawnSync(process.execPath, [
  path.join(root, 'scripts/assert-tests-ran.mjs'),
  'vitest',
  'run',
  '--config',
  'vitest.knowledge-admission.config.js',
  ...process.argv.slice(2),
], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: false,
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
