// Structural proof of the dependency rules (ADR draft D2/D4):
//  • a module's adapter writes only the tables its owner declares (schema OWNERS);
//  • no module imports another module's adapters — cross-module calls use index.js;
//  • nothing in the service imports apps/server, Next.js, Prisma or '@/…' aliases;
//  • kernel and domain code import no DB, network or environment.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OWNERS } from '../../src/infrastructure/schema.js'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [] })
const files = walk(src).map((path) => ({ path, rel: relative(src, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))
const imports = (text) => [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
const code = (text) => text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const written = (text) => [...code(text).matchAll(/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|(?<!DO\s)UPDATE|DELETE\s+FROM)\s+(\w+)/g)].map((m) => m[1]) // SQL is upper-case; prose is not

test('each adapter writes only its owner\'s tables', () => {
  const modules = Object.entries(OWNERS).filter(([owner]) => owner !== 'scm')
  assert.deepEqual(modules.map(([m]) => m).sort(), ['commerce', 'inventory', 'procurement'])
  for (const [owner, tables] of modules) {
    for (const f of files.filter((x) => x.rel.startsWith(`modules/${owner}/adapters/`))) {
      for (const table of written(f.text)) assert.ok(tables.includes(table), `${f.rel} writes ${table}, owned elsewhere`)
    }
  }
  // kernel/ is generated legacy pure code: it cannot reach a DB (see 'kernel and
  // domain code stay pure') and its prose ("only UPDATE takes fields") is not SQL.
  for (const f of files.filter((x) => !x.rel.startsWith('modules/') && !x.rel.startsWith('infrastructure/') && !x.rel.startsWith('kernel/'))) {
    assert.deepEqual(written(f.text), [], `${f.rel} writes tables directly; only module adapters and infrastructure evidence may`)
  }
  for (const f of files.filter((x) => x.rel.startsWith('infrastructure/') && x.rel !== 'infrastructure/schema.js')) {
    for (const table of written(f.text)) assert.ok(OWNERS.scm.includes(table), `${f.rel} writes ${table}`)
  }
})

// A workflow is ONE module's use case: it may use that module's internals and
// only the public index of every other module. Every workflow must be listed.
const WORKFLOW_OWNER = { 'workflows/post-goods-receipt.js': 'procurement', 'workflows/pos-checkout.js': 'commerce' }

test('cross-module calls go through the other module\'s public index', () => {
  for (const f of files.filter((x) => x.rel.startsWith('modules/') || x.rel.startsWith('workflows/'))) {
    const own = f.rel.startsWith('modules/') ? f.rel.split('/')[1] : WORKFLOW_OWNER[f.rel]
    assert.ok(own, `${f.rel} has no declared owning module`)
    for (const spec of imports(f.text)) {
      const m = /modules\/(\w+)\/(adapters|application|domain)\//.exec(spec)
      if (!m || m[1] === own) continue
      assert.fail(`${f.rel} imports ${spec}: use modules/${m[1]}/index.js`)
    }
  }
})

test('no monolith, framework, ORM or alias imports anywhere in the service', () => {
  for (const f of files) {
    for (const spec of imports(f.text)) {
      assert.ok(!/apps\/server|^next\b|@prisma|^@\//.test(spec), `${f.rel} imports ${spec}`)
    }
  }
})

test('kernel and domain code stay pure', () => {
  for (const f of files.filter((x) => x.rel.startsWith('kernel/') || x.rel.includes('/domain/') || x.rel.startsWith('modules/commerce/pricing/'))) {
    for (const spec of imports(f.text)) assert.ok(!/node:(sqlite|http|net|fs|child_process)|^pg$/.test(spec), `${f.rel} imports ${spec}`)
    assert.ok(!/process\.env/.test(f.text), `${f.rel} reads the environment`)
  }
  for (const f of files.filter((x) => x.rel !== 'main.js' && x.rel !== 'config.js')) assert.ok(!/process\.env/.test(f.text), `${f.rel} reads process.env; only main.js may`)
})
