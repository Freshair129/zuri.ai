// @spec ADR-115 — producer identity is verified before consuming or uploading an input.
// @tested scripts/compact-prepare-input.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
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

test('the TEST recipe copies notices from the selected module even when another mc version is cached', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compact-notices-'))
  for (const dir of ['bin', 'mod/github.com/minio/minio@selected', 'mod/github.com/minio/mc@selected', 'mod/github.com/minio/mc@other']) await mkdir(path.join(root, dir), { recursive: true })
  for (const [name, value] of [['minio@selected', 'selected-minio-license'], ['mc@selected', 'selected-mc-license'], ['mc@other', 'foreign-license']]) await writeFile(path.join(root, 'mod/github.com/minio', name, 'LICENSE'), value)
  const gitPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).trim()
  const bash = process.platform === 'win32' ? path.resolve(gitPath, '../../../bin/bash.exe') : '/bin/bash'
  const shellRoot = process.platform === 'win32' ? root.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : root
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`
  await writeFile(path.join(root, 'bin/go'), '#!/bin/sh\nif [ "$1" = install ]; then exit 0; fi\ncase "$*" in *github.com/minio/minio@*) printf "%s\\n" "$NOTICE_ROOT/mod/github.com/minio/minio@selected";; *github.com/minio/mc@*) printf "%s\\n" "$NOTICE_ROOT/mod/github.com/minio/mc@selected";; *) exit 1;; esac\n', { mode: 0o755 })
  const recipe = await readFile(new URL('../../deploy/compact/Minio.test.Dockerfile', import.meta.url), 'utf8')
  const command = /^RUN ([\s\S]+?)\nFROM /m.exec(recipe)?.[1]
  assert(command)
  const bounded = command.replaceAll('/go/pkg/mod', `${quote(shellRoot)}/mod`).replaceAll('/notices', `${quote(shellRoot)}/notices`)
  const result = spawnSync(bash, ['-c', `export NOTICE_ROOT=${quote(shellRoot)}; export PATH=${quote(shellRoot)}/bin:$PATH; ${bounded}`], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(path.join(root, 'notices/MC-LICENSE'), 'utf8'), 'selected-mc-license')
  assert.equal(await readFile(path.join(root, 'notices/MINIO-LICENSE'), 'utf8'), 'selected-minio-license')
})
