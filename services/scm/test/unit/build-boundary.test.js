// The boundary scan `npm run build` enforces (scripts/boundary-scan.mjs). Since
// services/scm is an isolated service for scoped CI, an SCM-only pull request
// skips the apps/server suite, so each rule is pinned here: it must catch its own
// form (static, export-from, dynamic import(), require(), createRequire, an escape
// out of the package, an undeclared package, an unverifiable specifier) and must
// NOT flag the look-alikes the real tree contains (comments, `.require(...)`
// method calls and definitions, URLs inside strings, regex literals).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSource, stripComments } from '../../scripts/boundary-scan.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const declared = new Set(['pg', 'yaml', 'zod'])
const file = path.join(root, 'src', 'modules', 'inventory', 'application', 'probe.js')
const scan = (source) => scanSource({ file, root, source, declared })
const refusedAs = (source, pattern) => {
  const found = scan(source)
  assert.ok(found.length > 0, `not refused: ${source}`)
  assert.match(found.join('\n'), pattern, source)
}

test('static and export-from references to the monolith, Next.js or Prisma are refused', () => {
  refusedAs("import db from '@/lib/db'", /apps\/server `@\/` alias/)
  refusedAs("import { x } from '../../../../../apps/server/src/lib/db.js'", /imports apps\/server/)
  refusedAs("export { y } from 'next/server'", /Next\.js/)
  refusedAs("import { PrismaClient } from '@prisma/client'", /Prisma/)
  refusedAs("import 'apps/server/src/side-effect.js'", /imports apps\/server/)
})

test('dynamic import() is scanned: literal specifiers by the same rules, non-literal ones refused', () => {
  // The reviewer's exact repro (MC0 review of 535627cd, finding 1).
  refusedAs("export const leak = () => import('../../../apps/server/src/lib/db.js')", /imports apps\/server/)
  refusedAs('const m = await import("@/modules/crm/scm-reference-reader")', /alias/)
  refusedAs('const m = await import(`../../../../../apps/server/src/x.js`)', /imports apps\/server/)
  refusedAs('const m = await import(name)', /non-literal/)
  refusedAs('const m = await import(`../${name}.js`)', /non-literal/)
  refusedAs("const m = await import('lodash')", /SERVICE_UNDECLARED_DEPENDENCY/)
  assert.deepEqual(scan("const m = await import('./local.js')"), [])
  assert.deepEqual(scan("const m = await import('node:crypto')"), [])
})

test('require() and createRequire are refused the same way', () => {
  refusedAs("const db = require('../../../../../apps/server/src/lib/db.js')", /imports apps\/server/)
  refusedAs("const p = require('@prisma/client')", /Prisma/)
  refusedAs("const l = require('lodash')", /SERVICE_UNDECLARED_DEPENDENCY/)
  refusedAs("import { createRequire } from 'node:module'\nconst r = createRequire(import.meta.url)", /createRequire/)
})

test('a relative path may not leave services/scm, whatever it is called', () => {
  refusedAs("import x from '../../../../../market-intelligence/src/index.js'", /outside services\/scm/)
  refusedAs("const x = await import('../../../../../../scripts/ci-change-scope.mjs')", /outside services\/scm/)
  assert.deepEqual(scan("import { z } from '../../../infrastructure/delegation.js'"), [])
})

test('an undeclared package is refused; declared packages and node: builtins pass', () => {
  refusedAs("import _ from 'lodash/fp'", /SERVICE_UNDECLARED_DEPENDENCY/)
  refusedAs("import x from '@scope/pkg/sub'", /SERVICE_UNDECLARED_DEPENDENCY/)
  assert.deepEqual(scan("import { z } from 'zod'\nimport pg from 'pg'\nimport { randomUUID } from 'node:crypto'"), [])
})

test('look-alikes are not module references', () => {
  const clean = [
    // Comments, including the generated-kernel sentence that once tripped the scan.
    '// unrecoverable", which is a different statement from "nobody granted it".',
    '  // self-governance import (doc-graph supersedes/relates → Dependency rows).',
    "/* const db = require('../../../../apps/server/src/lib/db.js') */",
    "// export const leak = () => import('@/lib/db')",
    // The authority ladders: method definitions and method calls named require.
    'export const a = {\n  require(scope, businessId, capability = \'read\') {\n    return scope\n  },\n}',
    "const id = inventoryAuthority.require(scope, data.businessId, { write: true }).id",
    // A URL inside a string and a regex literal holding quotes and slashes.
    "const base = new URL(req.url, 'http://scm.local') // not a comment start inside the string",
    "const re = /^http:\\/\\/[a-z0-9-]+(:\\d+)?$/i\nconst q = /['\"]/g",
  ]
  for (const source of clean) assert.deepEqual(scan(source), [], source)
})

test('stripComments keeps code, strings and newlines and blanks only comments', () => {
  const source = "const a = '//x' // tail\n/* block\nspans */const b = `/*y*/`\nconst c = /\\/\\//.test(a)"
  const stripped = stripComments(source)
  assert.equal(stripped.split('\n').length, source.split('\n').length)
  for (const kept of ["'//x'", '`/*y*/`', '/\\/\\//']) assert.ok(stripped.includes(kept), kept)
  for (const gone of ['tail', 'block', 'spans']) assert.ok(!stripped.includes(gone), gone)
})

test('the real services/scm source tree is within bounds', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const real = new Set(Object.keys(pkg.dependencies ?? {}))
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.js') ? [full] : []
  })
  const files = walk(path.join(root, 'src'))
  assert.ok(files.length > 50)
  for (const f of files) assert.deepEqual(scanSource({ file: f, root, source: readFileSync(f, 'utf8'), declared: real }), [], f)
})
