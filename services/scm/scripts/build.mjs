#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Build = boundary scan + kernel drift check + syntax check of this package only,
// the same meaning `build` has for services/market-intelligence and
// services/conversation-runtime (scripts/ci-change-scope.mjs lists a service as
// isolated only while CI runs its tests AND this build).
//
// It fails on:
//   - an import of apps/server, Next.js or the `@/` alias, or any Prisma use:
//     SCM owns its store and reaches core only over scm-core.v1;
//   - a package this package does not declare (package.json dependencies);
//   - a stale or hand-edited src/kernel/** (sync-kernel --check);
//   - a file Node cannot parse.
// Only real `import … from` / `export … from` / `import '…'` statements count;
// the words "from '…'" inside a comment or string do not.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function walk(dir) {
  const output = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) output.push(...await walk(file))
    else if (entry.name.endsWith('.js')) output.push(file)
  }
  return output
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const DECLARED = new Set(Object.keys(pkg.dependencies ?? {}))
const STATEMENT = /^\s*(?:import|export)\b[^'"`]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm
const FORBIDDEN = [
  [/^(?:next(?:\/|$)|@\/)/, 'imports Next.js or the apps/server `@/` alias'],
  [/(?:^|\/)apps\/server(?:\/|$)/, 'imports apps/server'],
  [/^@prisma\//, 'imports Prisma'],
]

const files = await walk(path.join(root, 'src'))
if (!files.length) throw new Error('SERVICE_SOURCE_MISSING')
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const source = await readFile(file, 'utf8')
  if (/\bPrismaClient\b/.test(source)) throw new Error(`SERVICE_BOUNDARY_VIOLATION:${relative}: uses Prisma`)
  for (const match of source.matchAll(STATEMENT)) {
    const specifier = match[1] ?? match[2]
    for (const [pattern, reason] of FORBIDDEN) {
      if (pattern.test(specifier)) throw new Error(`SERVICE_BOUNDARY_VIOLATION:${relative}: ${reason}`)
    }
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (!DECLARED.has(name)) throw new Error(`SERVICE_UNDECLARED_DEPENDENCY:${relative}: ${specifier}`)
  }
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true })
  if (checked.status !== 0) throw new Error(checked.stderr || `SYNTAX_ERROR:${relative}`)
}

const kernel = spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-kernel.mjs'), '--check'], { cwd: root, encoding: 'utf8', windowsHide: true })
if (kernel.status !== 0) throw new Error(`SERVICE_KERNEL_DRIFT: ${(kernel.stdout + kernel.stderr).trim()}`)

process.stdout.write(`scm build ok · ${files.length} source files · kernel in sync · Node ${process.versions.node}\n`)
