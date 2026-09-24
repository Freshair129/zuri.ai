import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Build = boundary scan + syntax check of this package only. It fails on any import
// of apps/server, Next.js, Prisma or another domain's implementation, on an
// undeclared package, and on process.env or I/O modules inside the pure core, so
// "independently buildable" is checked rather than assumed.
// @req FR-092
// @spec ADR-038
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

const FORBIDDEN_EVERYWHERE = [
  [/from\s+['"](?:next(?:\/|['"])|@\/|[^'"]*apps\/server)/, 'imports apps/server or Next.js'],
  [/@prisma\/client|PrismaClient/, 'uses Prisma directly'],
  [/from\s+['"][^'"]*modules\/(?:identity|project-manager|integration|knowledge)/, 'imports a foreign domain'],
]
const FORBIDDEN_IN_CORE = [
  [/process\.env/, 'reads process.env in the pure core'],
  [/from\s+['"]node:(?:fs|net|http|https|child_process)/, 'does I/O in the pure core'],
]
const PURE = ['src/core/', 'src/domain/', 'src/ports/']
const ALLOWED_PACKAGES = new Set(['zod'])

const files = await walk(path.join(root, 'src'))
if (!files.length) throw new Error('SERVICE_SOURCE_MISSING')
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const source = await readFile(file, 'utf8')
  const rules = PURE.some((prefix) => relative.startsWith(prefix))
    ? [...FORBIDDEN_EVERYWHERE, ...FORBIDDEN_IN_CORE]
    : FORBIDDEN_EVERYWHERE
  for (const [pattern, reason] of rules) {
    if (pattern.test(source)) throw new Error(`SERVICE_BOUNDARY_VIOLATION:${relative}: ${reason}`)
  }
  for (const match of source.matchAll(/from\s+['"]([^'"./][^'"]*)['"]/g)) {
    const specifier = match[1]
    if (specifier.startsWith('node:')) continue
    if (!ALLOWED_PACKAGES.has(specifier)) {
      throw new Error(`SERVICE_UNDECLARED_DEPENDENCY:${relative}: ${specifier}`)
    }
  }
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true })
  if (checked.status !== 0) throw new Error(checked.stderr || `SYNTAX_ERROR:${relative}`)
}
process.stdout.write(`market-intelligence build ok · ${files.length} source files · Node ${process.versions.node}\n`)
