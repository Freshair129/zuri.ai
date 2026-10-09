// @req FR-281, FR-282, FR-283 — reproducible opt-in QA without ambient storage.
// @tested tests/integration/marketing-report-native.test.js
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const server = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repository = resolve(server, '../..')
const require = createRequire(join(server, 'package.json'))
const cli = process.env.ZURI_REPORT_PRISMA_CLI || require.resolve('prisma/build/index.js')
const vitest = process.env.ZURI_REPORT_VITEST_CLI || require.resolve('vitest/vitest.mjs')
if (!/prisma\s+:\s+5\.22\.0\b/.test(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }))) throw Error('PINNED_PRISMA_5_22_REQUIRED')
const privateRoot = join(repository, '.local'); mkdirSync(privateRoot, { recursive: true })
const qa = mkdtempSync(join(privateRoot, 'p3-receiver-native-qa-')), schema = join(qa, 'schema.prisma'), base = join(qa, 'baseline.prisma'), client = join(qa, 'client')
const baseline = execFileSync('git', ['--no-replace-objects', 'show', 'd08f08a8f2604bd9657360d37f7c135d636189b7:apps/server/prisma/schema.prisma'], { cwd: repository, encoding: 'utf8' })
writeFileSync(base, baseline)
writeFileSync(schema, readFileSync(join(server, 'prisma/schema.prisma'), 'utf8').replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = ' + JSON.stringify(client.replaceAll('\\', '/'))))
const env = { ...process.env, DATABASE_URL: 'file:' + join(qa, 'unused-qa.sqlite').replaceAll('\\', '/'), PRISMA_GENERATE_SKIP_AUTOINSTALL: '1',
  ZURI_REPORT_QA_HOME: qa, ZURI_REPORT_QA_CLIENT: client }
writeFileSync(join(qa, 'base.sql'), execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', base, '--script'], { env, encoding: 'utf8' }))
execFileSync(process.execPath, [cli, 'generate', '--schema', schema], { env, stdio: 'inherit' })
const config = join(qa, 'vitest.config.mjs')
writeFileSync(config, 'export default ' + JSON.stringify({ root: server, resolve: { alias: { '@': join(server, 'src') } }, css: { postcss: { plugins: [] } }, test: {
  environment: 'node', include: ['tests/unit/marketing-report-wire.test.js', 'tests/integration/marketing-report-native.test.js'],
  fileParallelism: false, maxWorkers: 1, testTimeout: 30000, hookTimeout: 30000,
} }) + ';\n')
const result = spawnSync(process.execPath, [vitest, 'run', '--config', config], { cwd: repository, env, stdio: 'inherit' })
process.exitCode = result.status ?? 1
// Preserve only test-owned private SQLite evidence/client files for inspection.
// Never migrate, restore, provision, read config or send to an ambient DB/URL.
