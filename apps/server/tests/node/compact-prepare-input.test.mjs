// @spec ADR-115 — producer identity is verified before consuming or uploading an input.
// @tested scripts/compact-prepare-input.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { hash, implementation } from './compact-fixtures.mjs'

const revision = 'c'.repeat(40)
async function fixture(mutate = () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compact-producer-')), components = {}
  for (const key of ['web', 'tools', 'postgres', 'storage']) {
    const dir = components[key] = path.join(root, key)
    await mkdir(path.join(dir, 'blobs/sha256'), { recursive: true })
    const config = { os: 'linux', architecture: 'amd64', config: { Labels: { 'org.opencontainers.image.revision': revision } }, rootfs: { type: 'layers', diff_ids: [] } }
    mutate(config, key)
    const configBytes = JSON.stringify(config), configHash = hash(configBytes)
    const image = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: `sha256:${configHash}`, size: Buffer.byteLength(configBytes) }, layers: [] })
    await writeFile(path.join(dir, 'blobs/sha256', configHash), configBytes)
    await writeFile(path.join(dir, 'blobs/sha256', hash(image)), image)
    await writeFile(path.join(dir, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }))
    await writeFile(path.join(dir, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${hash(image)}`, size: Buffer.byteLength(image), annotations: { 'org.opencontainers.image.ref.name': 'build-export' } }] }))
  }
  return { root, components, output: path.join(root, 'merged') }
}
const api = () => implementation('../../scripts/compact-prepare-input.mjs')

test('producer assembles only exact core OCI identities and observes web/tools source labels', async () => {
  const a = await api(), f = await fixture()
  const result = await a.assembleCompactOci({ componentDirectories: f.components, outputDirectory: f.output, sourceRevision: revision })
  assert.deepEqual(Object.keys(result.images).sort(), ['postgres', 'storage', 'tools', 'web'])
  assert.match(result.images.web, /^zuri-compact\.test\/web@sha256:[a-f0-9]{64}$/)
  const index = JSON.parse(await readFile(path.join(f.output, 'index.json')))
  assert.equal(index.manifests.length, 4)
  assert(index.manifests.every(d => Object.values(result.images).includes(d.annotations['io.containerd.image.name'])))
})
test('producer refuses foreign image source, corrupt blobs and extra component inputs', async () => {
  const a = await api()
  for (const mutate of [
    async f => { const bad = await fixture((c, k) => { if (k === 'web') c.config.Labels['org.opencontainers.image.revision'] = 'd'.repeat(40) }); f.components = bad.components },
    async f => { const index = JSON.parse(await readFile(path.join(f.components.web, 'index.json'))); await writeFile(path.join(f.components.web, 'blobs/sha256', index.manifests[0].digest.slice(7)), '{}') },
    async f => { await writeFile(path.join(f.components.web, 'blobs/sha256', 'f'.repeat(64)), 'unreachable') },
    async f => { f.components.genesisWorker = f.components.storage },
  ]) {
    const f = await fixture(); await mutate(f)
    await assert.rejects(a.assembleCompactOci({ componentDirectories: f.components, outputDirectory: f.output, sourceRevision: revision }))
  }
})
test('producer does not overwrite an existing OCI output', async () => {
  const a = await api(), f = await fixture(); await mkdir(f.output); await writeFile(path.join(f.output, 'keep'), 'original')
  await assert.rejects(a.assembleCompactOci({ componentDirectories: f.components, outputDirectory: f.output, sourceRevision: revision }))
  assert.equal(await readFile(path.join(f.output, 'keep'), 'utf8'), 'original')
})
test('only actual exact TEST provider evidence can become prepared evidence', async () => {
  const a = await api(), image = `zuri-compact.test/storage@sha256:${'a'.repeat(64)}`
  const valid = { status: 'PASS', environment: 'TEST', image, platform: 'linux/amd64', command: ['server', '/data'], checks: { versioning: true, conditionalWrite: true, exactRead: true, exactErase: true } }
  assert.deepEqual(a.validatePreparedProviderEvidence(valid, image), valid)
  for (const bad of [{ ...valid, status: 'FAIL' }, { ...valid, environment: 'PRODUCTION' }, { ...valid, image: image.replace('/storage@', '/foreign@') }, { ...valid, command: ['server', '/foreign'] }, { ...valid, checks: { ...valid.checks, exactErase: false } }, { ...valid, extra: 'secret' }]) assert.throws(() => a.validatePreparedProviderEvidence(bad, image))
})
test('missing producer inputs cannot emit a release manifest', async () => {
  const a = await api(), f = await fixture(), output = path.join(f.root, 'prepared')
  await assert.rejects(a.prepareCompactInput({ outputDirectory: output, sourceRevision: revision, images: {}, ociDirectory: f.output, baselineDirectory: f.root, providerEvidenceFile: path.join(f.root, 'absent') }))
  await assert.rejects(access(path.join(output, 'release-manifest.json')))
})
