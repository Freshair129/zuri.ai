import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// @spec ADR-106 D5, SDD-108 — build is limited to this independent Node process.
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
const files = await walk(path.join(root, 'src'))
if (!files.length) throw new Error('SERVICE_SOURCE_MISSING')
for (const file of files) {
  const source = await readFile(file, 'utf8')
  if (/from\s+['"](?:next\/|@\/|apps\/server|\.\.\/\.\.\/\.\.\/apps\/server)/.test(source)
    || /(?:@prisma\/client|PrismaClient)/.test(source)
    || /\/api\/line-oa\/worker/.test(source)) throw new Error(`SERVICE_BOUNDARY_VIOLATION:${path.relative(root, file)}`)
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true })
  if (checked.status !== 0) throw new Error(checked.stderr || `SYNTAX_ERROR:${file}`)
}
process.stdout.write(`conversation-runtime build ok · ${files.length} source files · Node ${process.versions.node}\n`)
