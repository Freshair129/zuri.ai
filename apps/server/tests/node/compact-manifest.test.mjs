// @spec ADR-115 — strict release data, selected dependencies and safe errors.
// @tested tests/node/compact-manifest.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { manifest, implementation } from './compact-fixtures.mjs'
const api = () => implementation('../../scripts/lib/compact/manifest.mjs')

test('current graph documentation with an interior space is a portable payload path', async () => {
  const { validateCompactManifest } = await api(), input = manifest()
  input.files['docs/STD-Multi agent workflow S-01.md'] = 'b'.repeat(64)
  assert.doesNotThrow(() => validateCompactManifest(input))
})
for (const filename of ['docs/leading /record.md', 'docs/ trailing.md', 'docs/con .md', 'docs/name$(command).md']) test(`refuses nonportable spaced or shell path ${filename}`, async () => {
  const { validateCompactManifest } = await api(), input = manifest()
  input.files[filename] = 'b'.repeat(64)
  assert.throws(() => validateCompactManifest(input), { code: 'COMPACT_MANIFEST_INVALID' })
})

test('core validates without AI and returns immutable data', async () => {
  const { validateCompactManifest } = await api(), input = manifest()
  const output = validateCompactManifest(input)
  assert.deepEqual(output, input)
  assert.notEqual(output, input)
  assert.equal(Object.isFrozen(output.images), true)
  input.images.web = 'changed'
  assert.notEqual(output.images.web, 'changed')
})
for (const [name, mutate] of Object.entries({
  'unknown field': m => { m.password = 'DO_NOT_ECHO_SECRET' },
  'mutable tag': m => { m.images.web = 'test/web:latest' },
  'missing core image': m => { delete m.images.tools },
  'unqualified storage': m => { m.storageQualification.status = 'PENDING' },
  'different storage image': m => { m.storageQualification.image = `test/other@sha256:${'d'.repeat(64)}` },
  'unknown profile': m => { m.profiles.push('gpu') },
  'duplicate profile': m => { m.profiles.push('core') },
  'missing core profile': m => { m.profiles = [] },
  'unselected AI image': m => { m.images.genesisWorker = m.images.web },
  'line image missing': m => { m.profiles.push('line'); m.capabilities.line = 'NOT_QUALIFIED' },
  'knowledge dependencies missing': m => { m.profiles.push('knowledge'); m.capabilities.knowledge = 'NOT_QUALIFIED' },
  'public image missing': m => { m.profiles.push('public'); m.capabilities.public = 'NOT_QUALIFIED' },
  'false runtime qualification': m => { m.capabilities.core = 'QUALIFIED' },
  'secret command argument': m => { m.storageQualification.command.push('--password=DO_NOT_ECHO_SECRET') },
  'baseline hash mismatch': m => { m.schemaBaseline.sha256 = 'e'.repeat(64) },
  'wrong platform': m => { m.platform = 'linux/arm64' },
  'extra qualification payload': m => { m.files['qualifications/private-license.txt'] = 'b'.repeat(64) },
  'shared evidence payload': m => { m.storageQualification.licenseEvidence = { ...m.storageQualification.evidence } },
  'non-JSON evidence': m => { m.files['qualifications/storage.txt'] = 'b'.repeat(64); delete m.files['qualifications/storage.json']; m.storageQualification.evidence.file = 'qualifications/storage.txt' },
})) test(`rejects ${name} without reflecting input values`, async () => {
  const { validateCompactManifest } = await api(), m = manifest(); mutate(m)
  assert.throws(() => validateCompactManifest(m), error => error.code === 'COMPACT_MANIFEST_INVALID' && error.message === 'COMPACT_MANIFEST_INVALID' && !JSON.stringify(error).includes('DO_NOT_ECHO_SECRET'))
})
for (const file of ['../escape', '/absolute', 'C:/absolute', 'a\\b', 'a//b', 'docs/../x', '.env', '.env.production', 'secrets/key', 'docs/private.key', 'docs/CON.md', 'docs/file.', 'docs/file ', 'release-manifest.json']) {
  test(`rejects nonportable or forbidden path ${file}`, async () => {
    const { validateCompactManifest } = await api(), m = manifest(); m.files[file] = 'b'.repeat(64)
    assert.throws(() => validateCompactManifest(m), { code: 'COMPACT_MANIFEST_INVALID' })
  })
}
test('rejects Windows case-colliding paths', async () => {
  const { validateCompactManifest } = await api(), m = manifest(); m.files['docs/product.md'] = 'b'.repeat(64)
  assert.throws(() => validateCompactManifest(m), { code: 'COMPACT_MANIFEST_INVALID' })
})
test('LINE and public require explicit matching images and no knowledge pin', async () => {
  const { validateCompactManifest } = await api(), m = manifest()
  m.profiles.push('line', 'public'); m.images.lineWorker = m.images.web; m.images.ngrok = m.images.web
  m.capabilities.line = m.capabilities.public = 'NOT_QUALIFIED'
  assert.deepEqual(validateCompactManifest(m).componentPins, {})
})
test('rejects getters, cycles and non-JSON prototypes without invoking a getter', async () => {
  const { validateCompactManifest } = await api(); let called = false
  const m = manifest(); Object.defineProperty(m, 'password', { enumerable: true, get() { called = true; return 'secret' } })
  assert.throws(() => validateCompactManifest(m), { code: 'COMPACT_MANIFEST_INVALID' }); assert.equal(called, false)
  const cycle = manifest(); cycle.files.loop = cycle
  assert.throws(() => validateCompactManifest(cycle), { code: 'COMPACT_MANIFEST_INVALID' })
})
