#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { scanSource } from './boundary-scan.mjs'

// Build = boundary scan + kernel drift check + syntax check of this package only,
// the same meaning `build` has for services/market-intelligence and
// services/conversation-runtime (scripts/ci-change-scope.mjs lists a service as
// isolated only while CI runs its tests AND this build).
//
// It fails on:
//   - any boundary violation scripts/boundary-scan.mjs reports: static, dynamic
//     import() and require() references to apps/server, Next.js, the `@/` alias,
//     Prisma or anything outside services/scm; createRequire; an unverifiable
//     non-literal import(); an undeclared package. SCM owns its store and reaches
//     core only over scm-core.v1;
//   - a stale or hand-edited src/kernel/** (sync-kernel --check);
//   - a file Node cannot parse.
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

const files = await walk(path.join(root, 'src'))
if (!files.length) throw new Error('SERVICE_SOURCE_MISSING')
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const source = await readFile(file, 'utf8')
  const violations = scanSource({ file, root, source, declared: DECLARED })
  if (violations.length) throw new Error(violations.join('\n'))
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true })
  if (checked.status !== 0) throw new Error(checked.stderr || `SYNTAX_ERROR:${relative}`)
}

const kernel = spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-kernel.mjs'), '--check'], { cwd: root, encoding: 'utf8', windowsHide: true })
if (kernel.status !== 0) throw new Error(`SERVICE_KERNEL_DRIFT: ${(kernel.stdout + kernel.stderr).trim()}`)

process.stdout.write(`scm build ok · ${files.length} source files · kernel in sync · Node ${process.versions.node}\n`)
