// Static proof of the image topology (acceptance D27, static half only): the
// Dockerfile copies nothing outside services/scm, mounts nothing, and every file
// the entrypoint imports is inside the copied set. Building/starting the image is
// a separate LOCAL/HOSTED proof recorded in SCM-HANDOFF.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
const ignore = readFileSync(join(root, 'Dockerfile.dockerignore'), 'utf8')

test('the image copies only this package and mounts nothing', () => {
  const copies = [...dockerfile.matchAll(/^COPY\s+(.+?)\s+\S+$/gm)].flatMap((m) => m[1].split(/\s+/))
  assert.ok(copies.length >= 4)
  for (const source of copies) assert.ok(source.startsWith('services/scm/'), source)
  assert.doesNotMatch(dockerfile, /^\s*VOLUME\b/m)
  const instructions = dockerfile.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n')
  assert.doesNotMatch(instructions, /apps\/server|\.git\b/)
  const allowed = ignore.split('\n').filter((l) => l.startsWith('!'))
  assert.equal(ignore.split('\n')[0].trim(), '*')
  for (const a of allowed) assert.ok(a.startsWith('!services/scm/'), a)
})

test('runtime dependencies are exactly what the lockfile pins', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  for (const [name, version] of Object.entries(pkg.dependencies)) assert.equal(lock.packages[`node_modules/${name}`]?.version, version, name)
  assert.equal(pkg.devDependencies, undefined, 'tests use node:test only')
})
