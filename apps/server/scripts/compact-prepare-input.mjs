#!/usr/bin/env node
// @spec ADR-115 — exact-source TEST input producer, never installation or release authority.
// @tested tests/node/compact-prepare-input.test.mjs, tests/node/compact-workflow.test.mjs
import { execFileSync } from 'node:child_process'
import { mkdir, copyFile, lstat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CompactError, isPortablePayloadPath, validateCompactManifest } from './lib/compact/manifest.mjs'
import { bytes, json, digest, stableJson, listFiles, regularFile, destination, writeExclusive, hashFile } from './lib/compact/files.mjs'
import { verifyOciLayout, writeOciArchive } from './lib/compact/oci-layout.mjs'
import { renderCompactRuntimeFiles, packageCompactRelease } from './compact-package.mjs'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const COMPONENTS = ['postgres', 'storage', 'tools', 'web']
const COMMAND = ['server', '/data']
const REVIEW = 'MinIO and mc are source-built pinned Community TEST fixtures, with their license notices and source pointers retained in the image. No external license file is required for this isolated TEST run. This is not production, support, distribution or release-license approval.'
const fail = code => { throw new CompactError(code) }
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && stableJson(Object.keys(value).sort()) === stableJson([...keys].sort())
async function copyRegular(from, relative, to) {
  const { filename } = await regularFile(from, relative)
  await copyFile(filename, await destination(to, relative), 1) // COPYFILE_EXCL
}
async function exclusiveDirectory(directory) {
  if (typeof directory !== 'string') fail('COMPACT_ARGUMENTS_INVALID')
  // Parent must exist and be physical; the existing bounded reader checks every file.
  const parent = path.dirname(path.resolve(directory))
  const { realpath } = await import('node:fs/promises')
  if (await realpath(parent) !== parent || !(await lstat(parent)).isDirectory()) fail('COMPACT_OUTPUT_INVALID')
  await mkdir(directory)
}

export async function assembleCompactOci({ componentDirectories, outputDirectory, sourceRevision } = {}) {
  if (!exactKeys(componentDirectories, COMPONENTS) || !/^[a-f0-9]{40}$/.test(sourceRevision)) fail('COMPACT_ARGUMENTS_INVALID')
  await exclusiveDirectory(outputDirectory)
  const images = {}, manifests = []
  for (const key of COMPONENTS) {
    const input = componentDirectories[key], layout = await json(input, 'oci-layout'), index = await json(input, 'index.json')
    if (!exactKeys(layout, ['imageLayoutVersion']) || layout.imageLayoutVersion !== '1.0.0' || index.schemaVersion !== 2 || index.manifests?.length !== 1) fail('COMPACT_OCI_INVALID')
    const descriptor = index.manifests[0]
    if (!['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].includes(descriptor.mediaType) || !/^sha256:[a-f0-9]{64}$/.test(descriptor.digest)) fail('COMPACT_OCI_INVALID')
    const imageBytes = await bytes(input, `blobs/sha256/${descriptor.digest.slice(7)}`, 4 * 1024 * 1024)
    if (digest(imageBytes) !== descriptor.digest.slice(7) || imageBytes.length !== descriptor.size) fail('COMPACT_OCI_INVALID')
    const image = JSON.parse(imageBytes), config = await json(input, `blobs/sha256/${image.config.digest.slice(7)}`, 4 * 1024 * 1024)
    if (['web', 'tools'].includes(key) && config.config?.Labels?.['org.opencontainers.image.revision'] !== sourceRevision) fail('COMPACT_IMAGE_SOURCE_MISMATCH')
    const reference = images[key] = `zuri-compact.test/${key}@${descriptor.digest}`
    manifests.push({ ...descriptor, annotations: { 'io.containerd.image.name': reference } })
    for (const file of await listFiles(input)) {
      if (file === 'index.json' || file === 'oci-layout') continue
      if (!/^blobs\/sha256\/[a-f0-9]{64}$/.test(file) || await hashFile(input, file) !== file.slice(-64)) fail('COMPACT_OCI_INVALID')
      try { await copyRegular(input, file, outputDirectory) }
      catch (error) { if (error.code !== 'EEXIST' || await hashFile(outputDirectory, file) !== file.slice(-64)) throw error }
    }
  }
  await writeExclusive(outputDirectory, 'oci-layout', stableJson({ imageLayoutVersion: '1.0.0' }))
  await writeExclusive(outputDirectory, 'index.json', stableJson({ schemaVersion: 2, manifests }))
  await verifyOciLayout(outputDirectory, images)
  return { images }
}

export function validatePreparedProviderEvidence(evidence, image) {
  const checks = ['versioning', 'conditionalWrite', 'exactRead', 'exactErase']
  if (!exactKeys(evidence, ['status', 'environment', 'image', 'platform', 'command', 'checks']) || evidence.status !== 'PASS' || evidence.environment !== 'TEST' || evidence.image !== image || evidence.platform !== 'linux/amd64' || stableJson(evidence.command) !== stableJson(COMMAND) || !exactKeys(evidence.checks, checks) || checks.some(key => evidence.checks[key] !== true)) fail('COMPACT_STORAGE_EVIDENCE_INVALID')
  return structuredClone(evidence)
}

export async function prepareCompactInput({ outputDirectory, sourceRevision, images, ociDirectory, baselineDirectory, providerEvidenceFile } = {}) {
  if (!exactKeys(images, COMPONENTS) || !/^[a-f0-9]{40}$/.test(sourceRevision) || typeof providerEvidenceFile !== 'string') fail('COMPACT_ARGUMENTS_INVALID')
  const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
  if (git(['rev-parse', 'HEAD']) !== sourceRevision) fail('COMPACT_SOURCE_REVISION_MISMATCH')
  try { git(['diff', '--quiet', 'HEAD']); if (git(['ls-files', '--others', '--exclude-standard'])) fail('COMPACT_SOURCE_REVISION_MISMATCH') }
  catch { fail('COMPACT_SOURCE_REVISION_MISMATCH') }
  await verifyOciLayout(ociDirectory, images)
  const evidence = validatePreparedProviderEvidence(await json(path.dirname(providerEvidenceFile), path.basename(providerEvidenceFile)), images.storage)
  const baseline = await json(baselineDirectory, 'baseline.json')
  if (baseline.sourceRevision !== sourceRevision) fail('COMPACT_SOURCE_REVISION_MISMATCH')
  await exclusiveDirectory(outputDirectory)
  await writeExclusive(outputDirectory, '.partial', 'NOT_READY\n')
  const manifest = {
    schemaVersion: 'compact-release.v1', releaseId: `test-${sourceRevision.slice(0, 12)}`, sourceRevision, platform: 'linux/amd64', images,
    files: {}, schemaBaseline: { file: 'schema/baseline.sql', sha256: '' }, profiles: ['core'],
    storageQualification: { status: 'QUALIFIED', provider: 'S3_COMPATIBLE', image: images.storage, command: COMMAND, licenseRequired: false,
      evidence: { file: 'qualifications/storage.json', sha256: '' }, licenseEvidence: { file: 'qualifications/license.json', sha256: '' } },
    componentPins: {}, modelArtifacts: [], capabilities: { core: 'NOT_QUALIFIED', line: 'NOT_SELECTED', knowledge: 'NOT_SELECTED', public: 'NOT_SELECTED' },
  }
  const put = async (relative, content) => { await writeExclusive(outputDirectory, relative, content); manifest.files[relative] = digest(content) }
  const files = git(['-c', 'core.quotepath=false', 'ls-files', '--', 'docs', 'registry/document-registry/index.json']).split(/\r?\n/)
  files.push('docs/.doc-graph.json')
  for (const file of files.filter(isPortablePayloadPath)) await put(file, await bytes(REPO, file))
  for (const file of ['baseline.sql', 'baseline.json']) await put(`schema/${file}`, await bytes(baselineDirectory, file))
  await put('qualifications/storage.json', stableJson(evidence))
  await put('qualifications/license.json', stableJson({ status: 'PASS', environment: 'TEST', image: images.storage, licenseRequired: false, reviewSha256: digest(REVIEW) }))
  for (const value of [manifest.schemaBaseline, manifest.storageQualification.evidence, manifest.storageQualification.licenseEvidence]) value.sha256 = manifest.files[value.file]
  // Rendering validates the manifest, including all five generated root entries.
  const roots = ['compose.yml', 'env.example', 'README.md', 'release-manifest.schema.json', 'compact-self-host.mjs']
  for (const file of roots) manifest.files[file] = '0'.repeat(64)
  for (const [file, content] of Object.entries(await renderCompactRuntimeFiles(manifest))) await put(file, content)
  validateCompactManifest(manifest)
  await mkdir(path.join(outputDirectory, 'oci'))
  for (const file of await listFiles(ociDirectory)) await copyRegular(ociDirectory, file, path.join(outputDirectory, 'oci'))
  await writeExclusive(outputDirectory, 'release-manifest.json', stableJson(manifest))
  // Exercise the unchanged consumer preflight before any upload. The validated
  // package is a sibling diagnostic, never part of the prepared input artifact.
  const validation = await packageCompactRelease({ manifest: path.join(outputDirectory, 'release-manifest.json'), outputDirectory: `${outputDirectory}-validated`, expectedRevision: sourceRevision, imageExporter: async () => ({ layoutDirectory: path.join(outputDirectory, 'oci') }) })
  await unlink(path.join(outputDirectory, '.partial'))
  return { status: 'PREPARED_TEST_INPUT_NOT_QUALIFIED', sourceRevision, images, manifestSha256: validation.manifestSha256, licenseReviewSha256: digest(REVIEW) }
}

async function main(argv) {
  const mode = argv.shift(), args = {}
  while (argv.length) {
    const key = argv.shift(), value = argv.shift()
    if (!key?.startsWith('--') || !value || Object.hasOwn(args, key.slice(2))) fail('COMPACT_ARGUMENTS_INVALID')
    args[key.slice(2)] = value
  }
  if (mode === 'assemble' && exactKeys(args, ['exports', 'output', 'source-revision', 'archive'])) {
    const result = await assembleCompactOci({ componentDirectories: Object.fromEntries(COMPONENTS.map(key => [key, path.join(args.exports, key)])), outputDirectory: args.output, sourceRevision: args['source-revision'] })
    await writeOciArchive(args.output, result.images, args.archive)
    return result
  }
  if (mode === 'prepare' && exactKeys(args, ['output', 'source-revision', 'images', 'oci', 'baseline', 'provider-evidence'])) {
    const value = await json(path.dirname(args.images), path.basename(args.images))
    return prepareCompactInput({ outputDirectory: args.output, sourceRevision: args['source-revision'], images: value.images, ociDirectory: args.oci, baselineDirectory: args.baseline, providerEvidenceFile: args['provider-evidence'] })
  }
  fail('COMPACT_ARGUMENTS_INVALID')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(result => process.stdout.write(stableJson(result)), error => { process.stderr.write(`${error instanceof CompactError ? error.code : 'COMPACT_PREPARE_FAILED'}\n`); process.exitCode = 1 })
