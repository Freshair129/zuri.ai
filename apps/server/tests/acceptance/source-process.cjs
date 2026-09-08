// @req FR-109 — actual source process death before a Stage9 batch exists.
// @spec ADR-071
// @tested tests/acceptance/genesisrag17-e2e.test.js
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const { existsSync } = require('node:fs')
const root = path.resolve(__dirname, '../..')

// Only the test runner's disposable Prisma database is allowed in this child.
const database = (process.env.DATABASE_URL || '').replaceAll('\\', '/')
if (!/^file:\.\/\.test-dbs\/run-[\w-]+\.db$/.test(database)
    || !existsSync(path.resolve(root, 'prisma', database.slice(5)))) {
  throw new Error('SOURCE_CRASH_REQUIRES_DISPOSABLE_TEST_DATABASE')
}
const result = buildSync({
  stdin: {
    contents: `
      import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
      import { makeOperatorViewer } from './tests/factories/viewer'
      const options = JSON.parse(process.env.KI17_SOURCE_OPTIONS)
      const viewer = makeOperatorViewer({ visibleBusinessIds: [options.input.scope.businessId], ownedBusinessIds: [options.input.scope.businessId] })
      ingestGenesisRag17Raw(options.input, {
        viewer, credential: 'ki17-test-source',
        faultInjector: (point) => { if (point === options.crashAt) process.exit(87) },
      }).then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
    `,
    resolveDir: root,
    sourcefile: 'source-crash-entry.js',
  },
  absWorkingDir: root, bundle: true, write: false, platform: 'node',
  format: 'cjs', packages: 'external', alias: { '@': path.join(root, 'src') },
})
const filename = path.join(root, 'source-crash-bundle.cjs')
const compiled = new Module(filename, module)
compiled.filename = filename
compiled.paths = Module._nodeModulePaths(root)
compiled._compile(result.outputFiles[0].text, filename)
