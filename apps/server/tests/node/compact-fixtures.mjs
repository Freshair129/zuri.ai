// @spec ADR-115 — synthetic package inputs, never installation/provider acceptance.
// @tested tests/node/compact-manifest.test.mjs, tests/node/compact-package.test.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function implementation(relative) {
  try { return await import(new URL(relative, import.meta.url)) }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') assert.fail('Compact implementation is missing'); throw error }
}
export function manifest() {
  const digest = 'a'.repeat(64)
  const evidence = file => ({ file, sha256: 'b'.repeat(64) })
  return {
    schemaVersion: 'compact-release.v1', releaseId: 'test-1', sourceRevision: 'c'.repeat(40), platform: 'linux/amd64',
    images: { web: `test/web@sha256:${digest}`, tools: `test/tools@sha256:${digest}`, postgres: `test/postgres@sha256:${digest}`, storage: `test/storage@sha256:${digest}` },
    files: Object.fromEntries(['compose.yml', 'env.example', 'README.md', 'release-manifest.schema.json', 'compact-self-host.mjs', 'schema/baseline.sql', 'docs/PRODUCT.md', 'docs/.doc-graph.json', 'registry/document-registry/index.json', 'qualifications/storage.json', 'qualifications/license.json'].map(p => [p, 'b'.repeat(64)])),
    schemaBaseline: evidence('schema/baseline.sql'), profiles: ['core'],
    storageQualification: { status: 'QUALIFIED', provider: 'S3_COMPATIBLE', image: `test/storage@sha256:${digest}`, command: ['server', '/data'], licenseRequired: false, evidence: evidence('qualifications/storage.json'), licenseEvidence: evidence('qualifications/license.json') },
    componentPins: {}, modelArtifacts: [],
    capabilities: { core: 'NOT_QUALIFIED', line: 'NOT_SELECTED', knowledge: 'NOT_SELECTED', public: 'NOT_SELECTED' },
  }
}
export async function prepared(directory, api) {
  await mkdir(directory, { recursive: true })
  const m = manifest()
  const content = {
    'schema/baseline.sql': 'CREATE TABLE "TestOnly" (id text PRIMARY KEY);\n',
    'docs/PRODUCT.md': '# Synthetic product documentation\n',
    'docs/.doc-graph.json': JSON.stringify({ nodes: [], edges: [] }),
    'registry/document-registry/index.json': JSON.stringify({ records: [] }),
    'qualifications/storage.json': JSON.stringify({ status: 'PASS', environment: 'TEST', image: m.images.storage, platform: m.platform, command: m.storageQualification.command, checks: { versioning: true, conditionalWrite: true, exactRead: true, exactErase: true } }),
    'qualifications/license.json': JSON.stringify({ status: 'PASS', environment: 'TEST', image: m.images.storage, licenseRequired: m.storageQualification.licenseRequired, reviewSha256: hash('SYNTHETIC LICENSE REVIEW ONLY') }),
    ...await api.renderCompactRuntimeFiles(m),
  }
  for (const [file, bytes] of Object.entries(content)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
    await writeFile(path.join(directory, file), bytes)
    m.files[file] = hash(bytes)
  }
  for (const descriptor of [m.schemaBaseline, m.storageQualification.evidence, m.storageQualification.licenseEvidence]) descriptor.sha256 = m.files[descriptor.file]
  const filename = path.join(directory, 'release-manifest.json')
  await writeFile(filename, JSON.stringify(m, null, 2))
  return { m, filename, content }
}
export async function saveManifest(fixture) { await writeFile(fixture.filename, JSON.stringify(fixture.m)) }
export async function refreshEvidence(directory, m) {
  const content = {
    [m.storageQualification.evidence.file]: JSON.stringify({ status: 'PASS', environment: 'TEST', image: m.images.storage, platform: m.platform, command: m.storageQualification.command, checks: { versioning: true, conditionalWrite: true, exactRead: true, exactErase: true } }),
    [m.storageQualification.licenseEvidence.file]: JSON.stringify({ status: 'PASS', environment: 'TEST', image: m.images.storage, licenseRequired: m.storageQualification.licenseRequired, reviewSha256: hash('SYNTHETIC LICENSE REVIEW ONLY') }),
  }
  for (const [file, bytes] of Object.entries(content)) { await writeFile(path.join(directory, file), bytes); m.files[file] = hash(bytes) }
  for (const descriptor of [m.storageQualification.evidence, m.storageQualification.licenseEvidence]) descriptor.sha256 = m.files[descriptor.file]
}
export async function ociLayout(directory, m) {
  const config = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', config: {}, rootfs: { type: 'layers', diff_ids: [] } }))
  const configDigest = hash(config)
  const image = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: `sha256:${configDigest}`, size: config.length }, layers: [] }))
  const imageDigest = hash(image)
  for (const key of Object.keys(m.images)) m.images[key] = `test/${key.toLowerCase()}@sha256:${imageDigest}`
  m.storageQualification.image = m.images.storage
  await mkdir(path.join(directory, 'blobs/sha256'), { recursive: true })
  await writeFile(path.join(directory, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }))
  const manifests = [...new Set(Object.values(m.images))].sort().map(reference => ({
    mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${imageDigest}`, size: image.length,
    annotations: { 'io.containerd.image.name': reference },
  }))
  await writeFile(path.join(directory, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests }))
  await writeFile(path.join(directory, 'blobs/sha256', configDigest), config)
  await writeFile(path.join(directory, 'blobs/sha256', imageDigest), image)
  return { imageDigest, configDigest, config, image }
}
export async function inventory(directory) {
  const { readdir } = await import('node:fs/promises')
  const rows = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else rows.push([path.relative(directory, file).replaceAll('\\', '/'), hash(await readFile(file))])
    }
  }
  await walk(directory)
  return rows.sort(([a], [b]) => a.localeCompare(b))
}
