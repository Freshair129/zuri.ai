// @spec ADR-115 — hashed portable artifacts, hostile filesystem inputs and OCI identity.
// @tested tests/node/compact-package.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rename, symlink, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { prepared, implementation, saveManifest, inventory, ociLayout, hash, refreshEvidence } from './compact-fixtures.mjs'
const api = () => implementation('../../scripts/compact-package.mjs')
async function setup() { const a = await api(), root = await mkdtemp(path.join(os.tmpdir(), 'compact-package-test-')); return { a, root, f: await prepared(path.join(root, 'input'), a) } }
const absent = async file => assert.rejects(access(file))

test('packages declared bytes only, and relocates without access to original inputs', async () => {
  const { a, root, f } = await setup(), output = path.join(root, 'candidate with spaces')
  await writeFile(path.join(root, 'input', '.env.production'), 'UNSHIPPED_SECRET')
  await a.packageCompactRelease({ manifest: f.filename, outputDirectory: output })
  await absent(path.join(output, '.env.production'))
  const before = await inventory(output)
  await rename(path.join(root, 'input'), path.join(root, 'unavailable-input'))
  const relocated = path.join(root, 'different path'); await rename(output, relocated)
  assert.deepEqual(await inventory(relocated), before)
  const m = JSON.parse(await readFile(path.join(relocated, 'release-manifest.json')))
  for (const [file, digest] of Object.entries(m.files)) assert.equal(hash(await readFile(path.join(relocated, file))), digest)
  const { parse } = await import('yaml'), c = parse(await readFile(path.join(relocated, 'compose.yml'), 'utf8'))
  assert.deepEqual(Object.keys(c.services).sort(), ['db', 'storage', 'tools', 'web'])
  assert.equal(JSON.stringify(c).includes('db push'), false)
  assert.equal(JSON.stringify(c).includes('build'), false)
  assert.equal(c.services.web.image, m.images.web)
  assert.equal(c.services.web.ports[0].startsWith('127.0.0.1:'), true)
  assert.deepEqual(c.services.tools.profiles, ['tools'])
  assert.equal(JSON.stringify(c).includes(root), false)
})
test('identical inputs produce identical package bytes in different directories', async () => {
  const { a, root, f } = await setup()
  await a.packageCompactRelease({ manifest: f.filename, outputDirectory: path.join(root, 'one') })
  await a.packageCompactRelease({ manifest: f.filename, outputDirectory: path.join(root, 'two') })
  assert.deepEqual(await inventory(path.join(root, 'one')), await inventory(path.join(root, 'two')))
})
for (const kind of ['manifest', 'hash', 'missing', 'qualification', 'template']) test(`rejects ${kind} before output or exporter side effects`, async () => {
  const { a, root, f } = await setup(); let calls = 0
  if (kind === 'manifest') f.m.images.web = 'untrusted:latest'
  if (kind === 'hash') await writeFile(path.join(root, 'input/docs/PRODUCT.md'), 'changed')
  if (kind === 'missing') f.m.files['docs/missing.md'] = 'a'.repeat(64)
  if (kind === 'qualification') { const content = '{}'; await writeFile(path.join(root, 'input/qualifications/storage.json'), content); f.m.files['qualifications/storage.json'] = f.m.storageQualification.evidence.sha256 = hash(content) }
  if (kind === 'template') f.m.files['compose.yml'] = 'e'.repeat(64)
  await saveManifest(f)
  const out = path.join(root, 'rejected')
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: out, imageExporter: async () => { calls++; throw new Error('RAW_SECRET') } }), error => error.message.startsWith('COMPACT_') && !error.message.includes('RAW_SECRET'))
  assert.equal(calls, 0); await absent(out)
})
test('does not replace an existing output directory', async () => {
  const { a, root, f } = await setup(), out = path.join(root, 'existing')
  await mkdir(out); await writeFile(path.join(out, 'foreign'), 'preserve')
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: out }), { code: 'COMPACT_OUTPUT_EXISTS' })
  assert.equal(await readFile(path.join(out, 'foreign'), 'utf8'), 'preserve')
})
test('rejects a source parent junction/symlink rather than reading outside the input', async () => {
  const { a, root, f } = await setup()
  await rename(path.join(root, 'input/docs'), path.join(root, 'outside-docs'))
  await symlink(path.join(root, 'outside-docs'), path.join(root, 'input/docs'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: path.join(root, 'rejected') }), { code: 'COMPACT_SOURCE_INVALID' })
})
test('rejects output hidden inside the prepared input by an ancestor junction', async () => {
  const { a, root, f } = await setup()
  await mkdir(path.join(root, 'input/nested'))
  await symlink(path.join(root, 'input'), path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: path.join(root, 'alias/nested/output') }), { code: 'COMPACT_OUTPUT_INVALID' })
  await absent(path.join(root, 'input/nested/output'))
})
test('Knowledge includes only its pinned worker/model and shared namespace inputs', async () => {
  const { a, root, f } = await setup(), revision = 'd'.repeat(40), modelFile = 'models/embedding/model.bin', pinsFile = 'pins/ki17.json'
  f.m.profiles.push('knowledge'); f.m.capabilities.knowledge = 'NOT_QUALIFIED'; f.m.images.genesisWorker = f.m.images.web
  f.m.componentPins = { msp: 'a'.repeat(40), gks: 'b'.repeat(40), genesisblock: 'c'.repeat(40) }
  f.m.modelArtifacts = [{ id: 'embedding', repository: 'test/embedding', revision, files: { [modelFile]: hash('TEST MODEL') } }]
  const pins = JSON.stringify({ repositories: Object.fromEntries(Object.entries(f.m.componentPins).map(([k, commit]) => [k, { commit }])), runtime: { modelRepository: 'test/embedding', modelRevision: revision } })
  for (const [file, content] of [[modelFile, 'TEST MODEL'], [pinsFile, pins]]) { await mkdir(path.dirname(path.join(root, 'input', file)), { recursive: true }); await writeFile(path.join(root, 'input', file), content); f.m.files[file] = hash(content) }
  for (const [file, content] of Object.entries(await a.renderCompactRuntimeFiles(f.m))) f.m.files[file] = hash(content)
  await saveManifest(f); const out = path.join(root, 'knowledge')
  await a.packageCompactRelease({ manifest: f.filename, outputDirectory: out })
  const { parse } = await import('yaml'), compose = parse(await readFile(path.join(out, 'compose.yml'), 'utf8'))
  assert.equal(compose.services['genesis-worker'].network_mode, 'service:web')
  assert.equal(compose.services['genesis-worker'].volumes[2].source, './models/embedding')
  assert.equal(compose.services['genesis-worker'].volumes[2].read_only, true)
  assert.equal(compose.services['line-worker'], undefined)
  const wrongPins = pins.replace('"gks":{"commit":"' + f.m.componentPins.gks, '"gks":{"commit":"' + 'f'.repeat(40))
  await writeFile(path.join(root, 'input', pinsFile), wrongPins); f.m.files[pinsFile] = hash(wrongPins); await saveManifest(f)
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: path.join(root, 'wrong-pins') }), { code: 'COMPACT_PINS_INVALID' })
})
test('requires every registry record file in the package', async () => {
  const { a, root, f } = await setup(), content = JSON.stringify({ records: [{ path: 'docs/requirements/FR-MISSING.md' }] })
  await writeFile(path.join(root, 'input/registry/document-registry/index.json'), content); f.m.files['registry/document-registry/index.json'] = hash(content); await saveManifest(f)
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: path.join(root, 'rejected') }), { code: 'COMPACT_REGISTRY_INCOMPLETE' })
})
test('requires all graph document paths in the package', async () => {
  const { a, root, f } = await setup(), content = JSON.stringify({ nodes: [{ type: 'adr', path: 'docs/decisions/ADR-MISSING.md' }], edges: [] })
  await writeFile(path.join(root, 'input/docs/.doc-graph.json'), content); f.m.files['docs/.doc-graph.json'] = hash(content); await saveManifest(f)
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: path.join(root, 'rejected') }), { code: 'COMPACT_GRAPH_INCOMPLETE' })
})
test('exports a deterministic OCI tar bound to every selected image digest', async () => {
  const { a, root, f } = await setup(), layout = path.join(root, 'layout')
  const fixture = await ociLayout(layout, f.m)
  await refreshEvidence(path.join(root, 'input'), f.m)
  const runtime = await a.renderCompactRuntimeFiles(f.m); for (const [file, bytes] of Object.entries(runtime)) f.m.files[file] = hash(bytes)
  await saveManifest(f)
  for (const out of ['first', 'second']) await a.packageCompactRelease({ manifest: f.filename, outputDirectory: path.join(root, out), imageExporter: async () => ({ layoutDirectory: layout }) })
  assert.deepEqual(await inventory(path.join(root, 'first')), await inventory(path.join(root, 'second')))
  const names = execFileSync('tar', ['-tf', path.join(root, 'first/images.oci.tar')], { encoding: 'utf8' }).trim().split(/\r?\n/)
  assert(names.includes('oci-layout')); assert(names.includes('index.json')); assert(names.some(n => n.startsWith('blobs/sha256/')))
  assert.equal(hash(execFileSync('tar', ['-xOf', path.join(root, 'first/images.oci.tar'), `blobs/sha256/${fixture.imageDigest}`])), fixture.imageDigest)
  assert.equal(hash(execFileSync('tar', ['-xOf', path.join(root, 'first/images.oci.tar'), `blobs/sha256/${fixture.configDigest}`])), fixture.configDigest)
})
test('a failing trusted exporter cannot expose its raw error or produce a success marker', async () => {
  const { a, root, f } = await setup(), out = path.join(root, 'interrupted')
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: out, imageExporter: async () => { throw new Error('RAW_SECRET') } }), error => error.code === 'COMPACT_PACKAGE_FAILED' && !String(error).includes('RAW_SECRET') && error.cause === undefined)
  await absent(path.join(out, 'SHA256SUMS')); await access(path.join(out, '.partial'))
})
for (const kind of ['wrong-image', 'corrupt-blob', 'outside-file']) test(`rejects OCI ${kind} and leaves no success inventory`, async () => {
  const { a, root, f } = await setup(), layout = path.join(root, 'layout'), before = structuredClone(f.m)
  const data = await ociLayout(layout, f.m)
  f.m = before // Deliberately do not claim the fixture digest in the input manifest.
  if (kind !== 'wrong-image') {
    await ociLayout(layout, f.m)
    await refreshEvidence(path.join(root, 'input'), f.m)
    for (const [file, bytes] of Object.entries(await a.renderCompactRuntimeFiles(f.m))) f.m.files[file] = hash(bytes)
  }
  if (kind === 'corrupt-blob') await writeFile(path.join(layout, 'blobs/sha256', data.configDigest), 'corrupted')
  if (kind === 'outside-file') await writeFile(path.join(layout, 'credentials.json'), 'RAW_SECRET')
  await saveManifest(f); const out = path.join(root, 'failed')
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: out, imageExporter: async () => ({ layoutDirectory: layout }) }), error => error.code.startsWith('COMPACT_'))
  await absent(path.join(out, 'SHA256SUMS'))
})
test('CLI rejects unknown options and raw errors without printing secret input', async () => {
  const { root, f } = await setup()
  const result = spawnSync(process.execPath, [new URL('../../scripts/compact-package.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--manifest', f.filename, '--output', path.join(root, 'out'), '--password=RAW_SECRET'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /COMPACT_ARGUMENTS_INVALID/)
  assert.equal(result.stderr.includes('RAW_SECRET'), false)
})
test('CLI packages from an unrelated cwd and enforces expected source revision', async () => {
  const { root, f } = await setup(), script = fileURLToPath(new URL('../../scripts/compact-package.mjs', import.meta.url))
  const mismatch = spawnSync(process.execPath, [script, '--manifest', f.filename, '--output', path.join(root, 'wrong'), '--expected-revision', 'f'.repeat(40)], { cwd: os.tmpdir(), encoding: 'utf8' })
  assert.equal(mismatch.status, 1); assert.match(mismatch.stderr, /COMPACT_SOURCE_REVISION_MISMATCH/)
  const result = spawnSync(process.execPath, [script, '--manifest', f.filename, '--output', path.join(root, 'CLI output'), '--expected-revision', f.m.sourceRevision], { cwd: os.tmpdir(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).status, 'PACKAGED')
  assert.equal(result.stdout.includes(root), false)
})

test('CLI checks and packages a single manifest snapshot when the input changes after reading', async t => {
  const { a, root, f } = await setup(), out = path.join(root, 'snapshot'), original = fsp.open
  let reads = 0
  t.mock.method(fsp, 'open', async (file, ...args) => {
    const handle = await original(file, ...args)
    if (file === f.filename) {
      const read = handle.readFile.bind(handle)
      handle.readFile = async (...options) => {
        const content = await read(...options); reads++
        await writeFile(f.filename, JSON.stringify({ ...f.m, sourceRevision: 'f'.repeat(40) }))
        return content
      }
    }
    return handle
  })
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  await a.runCompactPackage(['--manifest', f.filename, '--output', out, '--expected-revision', f.m.sourceRevision])
  assert.equal(JSON.parse(await readFile(path.join(out, 'release-manifest.json'))).sourceRevision, f.m.sourceRevision)
  assert.equal(reads, 1)
})

test('qualification semantics use the same bytes that were hash checked', async t => {
  const { a, root, f } = await setup(), evidence = path.join(root, 'input/qualifications/storage.json'), original = fsp.open
  const good = await readFile(evidence), bad = Buffer.from(good.toString().replace('"PASS"', '"FAIL"'))
  await writeFile(evidence, bad); f.m.files['qualifications/storage.json'] = f.m.storageQualification.evidence.sha256 = hash(bad); await saveManifest(f)
  t.mock.method(fsp, 'open', async (file, ...args) => {
    const handle = await original(file, ...args)
    if (file === evidence) handle.readFile = async () => good
    return handle
  })
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const out = path.join(root, 'rejected-snapshot')
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: out }), { code: 'COMPACT_PAYLOAD_HASH_MISMATCH' })
  await absent(out)
})

test('copies the validated evidence snapshot even if its source changes after reading', async t => {
  const { a, root, f } = await setup(), evidence = path.join(root, 'input/qualifications/storage.json'), original = fsp.open
  const good = await readFile(evidence); let reads = 0
  t.mock.method(fsp, 'open', async (file, ...args) => {
    const handle = await original(file, ...args)
    if (file === evidence) {
      const read = handle.readFile.bind(handle)
      handle.readFile = async (...options) => { const content = await read(...options); reads++; await writeFile(evidence, '{}'); return content }
    }
    return handle
  })
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const out = path.join(root, 'held-evidence')
  await a.packageCompactRelease({ manifest: f.filename, outputDirectory: out })
  assert.deepEqual(await readFile(path.join(out, 'qualifications/storage.json')), good)
  assert.equal(reads, 1)
})

for (const kind of ['credential-field', 'raw-license']) test(`rejects ${kind} in qualification payloads before output`, async () => {
  const { a, root, f } = await setup(), descriptor = kind === 'raw-license' ? f.m.storageQualification.licenseEvidence : f.m.storageQualification.evidence
  const filename = path.join(root, 'input', descriptor.file)
  const content = kind === 'raw-license' ? 'PRIVATE_LICENSE_SECRET' : JSON.stringify({ ...JSON.parse(await readFile(filename)), password: 'PRIVATE_STORAGE_SECRET' })
  await writeFile(filename, content); f.m.files[descriptor.file] = descriptor.sha256 = hash(content); await saveManifest(f)
  const out = path.join(root, 'rejected-secret')
  await assert.rejects(a.packageCompactRelease({ manifest: f.filename, outputDirectory: out }), { code: kind === 'raw-license' ? 'COMPACT_LICENSE_EVIDENCE_INVALID' : 'COMPACT_STORAGE_EVIDENCE_INVALID' })
  await absent(out)
})
test('OCI archive rejects changed streaming bytes even if the original source stays valid', async t => {
  const { root, f } = await setup(), layout = path.join(root, 'layout'), data = await ociLayout(layout, f.m)
  const { writeOciArchive } = await implementation('../../scripts/lib/compact/oci-layout.mjs')
  const output = path.join(root, 'race.oci.tar'), original = fsp.open
  let copying = false, altered = false
  t.mock.method(fsp, 'open', async (file, ...args) => {
    const handle = await original(file, ...args)
    if (file === output) copying = true
    if (copying && !altered && String(file).endsWith(data.configDigest)) {
      const stream = handle.createReadStream.bind(handle)
      handle.createReadStream = options => { altered = true; return Readable.from([Buffer.alloc(data.config.length, 120)]) }
      t.after(() => { handle.createReadStream = stream })
    }
    return handle
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  await assert.rejects(writeOciArchive(layout, f.m.images, output), { code: 'COMPACT_OCI_INVALID' })
  assert.equal(altered, true)
})

for (const level of ['root', 'nested']) test(`OCI rejects conflicting ${level} descriptor platform metadata`, async () => {
  const { root, f } = await setup(), layout = path.join(root, 'layout')
  await ociLayout(layout, f.m)
  const { verifyOciLayout } = await implementation('../../scripts/lib/compact/oci-layout.mjs')
  const indexFile = path.join(layout, 'index.json'), index = JSON.parse(await readFile(indexFile))
  const child = { ...index.manifests[0], platform: { os: 'linux', architecture: 'arm64' } }
  if (level === 'root') index.manifests = [child]
  else {
    const blob = Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [child] })), digest = hash(blob)
    await writeFile(path.join(layout, 'blobs/sha256', digest), blob)
    index.manifests = [{ mediaType: 'application/vnd.oci.image.index.v1+json', digest: `sha256:${digest}`, size: blob.length, platform: { os: 'linux', architecture: 'amd64' } }]
    for (const key of Object.keys(f.m.images)) f.m.images[key] = `test/${key.toLowerCase()}@sha256:${digest}`
  }
  await writeFile(indexFile, JSON.stringify(index))
  await assert.rejects(verifyOciLayout(layout, f.m.images), { code: 'COMPACT_OCI_INVALID' })
})

test('OCI accepts a matching descriptor platform and rejects unqualified variant constraints', async () => {
  const { root, f } = await setup(), layout = path.join(root, 'layout')
  await ociLayout(layout, f.m)
  const { verifyOciLayout } = await implementation('../../scripts/lib/compact/oci-layout.mjs')
  const indexFile = path.join(layout, 'index.json'), index = JSON.parse(await readFile(indexFile))
  index.manifests[0].platform = { os: 'linux', architecture: 'amd64' }
  await writeFile(indexFile, JSON.stringify(index)); await verifyOciLayout(layout, f.m.images)
  index.manifests[0].platform.variant = 'v3'
  await writeFile(indexFile, JSON.stringify(index))
  await assert.rejects(verifyOciLayout(layout, f.m.images), { code: 'COMPACT_OCI_INVALID' })
})
