#!/usr/bin/env node
// @spec ADR-115 — build-time package only; no Docker, network or installation calls.
// @tested tests/node/compact-package.test.mjs, tests/node/compact-manifest.test.mjs
import { readFile, lstat, mkdir, unlink, realpath } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { build } from 'esbuild'
import { CompactError, validateCompactManifest } from './lib/compact/manifest.mjs'
import { bytes, json, digest, stableJson, openRegular, destination, writeExclusive, hashFile, listFiles } from './lib/compact/files.mjs'
import { writeOciArchive } from './lib/compact/oci-layout.mjs'

const ASSETS = fileURLToPath(new URL('../deploy/compact/', import.meta.url))
export async function renderCompactRuntimeFiles(input) {
  const m = validateCompactManifest(input)
  const compose = parse(await readFile(path.join(ASSETS, 'compose.yml'), 'utf8'))
  for (const [name, service] of Object.entries(compose.services)) {
    if (service.profiles && !service.profiles.includes('tools') && !service.profiles.some(p => m.profiles.includes(p))) { delete compose.services[name]; continue }
    const image = /^@image\.(.+)$/.exec(service.image)?.[1]
    if (!image || !m.images[image]) throw new CompactError('COMPACT_TEMPLATE_INVALID')
    service.image = m.images[image]
  }
  compose.services.storage.command = [...m.storageQualification.command]
  if (m.storageQualification.licenseRequired) compose.services.storage.volumes.push({ type: 'bind', source: '${COMPACT_STORAGE_LICENSE_FILE:?Set a private provider license file}', target: '/run/secrets/storage.license', read_only: true, bind: { create_host_path: false } })
  if (m.profiles.includes('knowledge')) {
    compose.services.web.volumes.push('knowledge-state:/var/lib/zuri-ki17/state')
    compose.services['genesis-worker'].volumes[2].source = `./models/${m.modelArtifacts[0].id}`
  } else { delete compose.volumes.genesis; delete compose.volumes['knowledge-state'] }
  const installer = await build({ entryPoints: [fileURLToPath(new URL('./compact-self-host.mjs', import.meta.url))], absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, legalComments: 'none', logLevel: 'silent', banner: { js: "import { createRequire as compactCreateRequire } from 'node:module'; const require = compactCreateRequire(import.meta.url);" } })
  return {
    'compose.yml': stringify(compose, { lineWidth: 0 }),
    'env.example': await readFile(path.join(ASSETS, 'env.example')),
    'README.md': await readFile(path.join(ASSETS, 'README.md')),
    'release-manifest.schema.json': await readFile(path.join(ASSETS, 'release-manifest.schema.json')),
    'compact-self-host.mjs': installer.outputFiles[0].contents,
  }
}
function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)) }
function snapshotJson(snapshots, file, code) {
  try { return JSON.parse(snapshots.get(file).toString('utf8')) }
  catch { throw new CompactError(code) }
}
function validateEvidence(snapshots, m) {
  const q = snapshotJson(snapshots, m.storageQualification.evidence.file, 'COMPACT_STORAGE_EVIDENCE_INVALID')
  const expected = m.storageQualification
  const checks = ['versioning', 'conditionalWrite', 'exactRead', 'exactErase']
  if (!exactKeys(q, ['status', 'environment', 'image', 'platform', 'command', 'checks']) || q.status !== 'PASS' || !['TEST', 'UAT', 'PRODUCTION'].includes(q.environment) || q.image !== m.images.storage || q.platform !== m.platform || JSON.stringify(q.command) !== JSON.stringify(expected.command) || !exactKeys(q.checks, checks) || checks.some(k => q.checks[k] !== true)) throw new CompactError('COMPACT_STORAGE_EVIDENCE_INVALID')
  const license = snapshotJson(snapshots, expected.licenseEvidence.file, 'COMPACT_LICENSE_EVIDENCE_INVALID')
  if (!exactKeys(license, ['status', 'environment', 'image', 'licenseRequired', 'reviewSha256']) || license.status !== 'PASS' || license.environment !== q.environment || license.image !== m.images.storage || license.licenseRequired !== expected.licenseRequired || typeof license.reviewSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(license.reviewSha256)) throw new CompactError('COMPACT_LICENSE_EVIDENCE_INVALID')
  const registry = snapshotJson(snapshots, 'registry/document-registry/index.json', 'COMPACT_REGISTRY_INCOMPLETE')
  if (!Array.isArray(registry?.records) || registry.records.some(r => !r || typeof r.path !== 'string' || !Object.hasOwn(m.files, r.path))) throw new CompactError('COMPACT_REGISTRY_INCOMPLETE')
  const graph = snapshotJson(snapshots, 'docs/.doc-graph.json', 'COMPACT_GRAPH_INCOMPLETE')
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges) || graph.nodes.some(n => typeof n?.path === 'string' && n.path.startsWith('docs/') && !Object.hasOwn(m.files, n.path.split('#')[0]))) throw new CompactError('COMPACT_GRAPH_INCOMPLETE')
  if (m.profiles.includes('knowledge')) {
    const pins = snapshotJson(snapshots, 'pins/ki17.json', 'COMPACT_PINS_INVALID')
    if (['msp', 'gks', 'genesisblock'].some(k => pins.repositories?.[k]?.commit !== m.componentPins[k]) || m.modelArtifacts.length !== 1 || m.modelArtifacts[0].repository !== pins.runtime?.modelRepository || m.modelArtifacts[0].revision !== pins.runtime?.modelRevision) throw new CompactError('COMPACT_PINS_INVALID')
  }
}
async function preflight(root, m, generated) {
  const names = Object.keys(m.files).sort(), snapshots = new Map()
  const metadata = new Set([m.storageQualification.evidence.file, m.storageQualification.licenseEvidence.file, 'registry/document-registry/index.json', 'docs/.doc-graph.json', ...(m.profiles.includes('knowledge') ? ['pins/ki17.json'] : [])])
  for (const file of names) {
    if (metadata.has(file)) snapshots.set(file, await bytes(root, file))
    const actual = Object.hasOwn(generated, file) ? digest(generated[file]) : snapshots.has(file) ? digest(snapshots.get(file)) : await hashFile(root, file)
    if (actual !== m.files[file]) throw new CompactError('COMPACT_PAYLOAD_HASH_MISMATCH')
  }
  validateEvidence(snapshots, m)
  return { files: names, snapshots }
}
async function copyPayload(root, out, file, expected) {
  const input = await openRegular(root, file), target = await destination(out, file)
  try {
    await pipeline(input.createReadStream({ autoClose: false }), createWriteStream(target, { flags: 'wx', mode: 0o644 }))
    if (await hashFile(out, file) !== expected) { await unlink(target); throw new CompactError('COMPACT_PAYLOAD_HASH_MISMATCH') }
  } finally { await input.close() }
}
export async function packageCompactRelease({ manifest, outputDirectory, imageExporter, expectedRevision } = {}) {
  try {
    if (typeof manifest !== 'string' || typeof outputDirectory !== 'string' || (imageExporter !== undefined && typeof imageExporter !== 'function') || (expectedRevision !== undefined && (typeof expectedRevision !== 'string' || !/^[a-f0-9]{40}$/.test(expectedRevision)))) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
    const input = path.resolve(manifest), root = await realpath(path.dirname(input)), out = path.resolve(outputDirectory)
    const m = validateCompactManifest(await json(root, path.basename(input), 4 * 1024 * 1024))
    if (expectedRevision !== undefined && m.sourceRevision !== expectedRevision) throw new CompactError('COMPACT_SOURCE_REVISION_MISMATCH')
    try { await lstat(out); throw new CompactError('COMPACT_OUTPUT_EXISTS') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = await lstat(path.dirname(out))
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new CompactError('COMPACT_OUTPUT_INVALID')
    const physicalParent = await realpath(path.dirname(out))
    if (path.relative(physicalParent, path.dirname(out)) !== '') throw new CompactError('COMPACT_OUTPUT_INVALID')
    const physicalOutput = path.join(physicalParent, path.basename(out))
    // Compare physical paths: an ancestor junction must not hide input overlap.
    for (const [a, b] of [[root, physicalOutput], [physicalOutput, root]]) { const relative = path.relative(a, b); if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new CompactError('COMPACT_OUTPUT_INVALID') }
    const generated = await renderCompactRuntimeFiles(m), { files, snapshots } = await preflight(root, m, generated)
    try { await mkdir(out) } catch (error) { if (error.code === 'EEXIST') throw new CompactError('COMPACT_OUTPUT_EXISTS'); throw error }
    await writeExclusive(out, '.partial', 'INCOMPLETE COMPACT PACKAGE\n')
    for (const file of files) {
      if (Object.hasOwn(generated, file)) await writeExclusive(out, file, generated[file])
      else if (snapshots.has(file)) await writeExclusive(out, file, snapshots.get(file))
      else await copyPayload(root, out, file, m.files[file])
    }
    const archives = []
    if (imageExporter) {
      const result = await imageExporter({ images: m.images, platform: m.platform })
      if (!result || typeof result.layoutDirectory !== 'string') throw new CompactError('COMPACT_OCI_INVALID')
      await writeOciArchive(path.resolve(result.layoutDirectory), m.images, path.join(out, 'images.oci.tar'))
      archives.push('images.oci.tar')
    }
    await writeExclusive(out, 'release-manifest.json', stableJson(m))
    await writeExclusive(out, 'transport.json', stableJson({ schemaVersion: 'compact-transport.v1', kind: archives.length ? 'oci' : 'registry', images: m.images, archives: Object.fromEntries(await Promise.all(archives.map(async file => [file, await hashFile(out, file)]))) }))
    const expected = [...files, ...archives, '.partial', 'release-manifest.json', 'transport.json'].sort()
    if (JSON.stringify(await listFiles(out)) !== JSON.stringify(expected)) throw new CompactError('COMPACT_OUTPUT_INVALID')
    const inventory = []
    for (const file of expected.filter(f => f !== '.partial')) {
      const hash = await hashFile(out, file)
      if (m.files[file] && m.files[file] !== hash) throw new CompactError('COMPACT_PAYLOAD_HASH_MISMATCH')
      inventory.push(`${hash}  ${file}`)
    }
    await writeExclusive(out, 'SHA256SUMS', inventory.join('\n') + '\n')
    await unlink(path.join(out, '.partial'))
    return { outputDirectory: out, manifestPath: path.join(out, 'release-manifest.json'), archives, manifestSha256: digest(stableJson(m)), payloadFiles: files.length, releaseId: m.releaseId }
  } catch (error) { if (error instanceof CompactError) throw error; throw new CompactError('COMPACT_PACKAGE_FAILED') }
}
export async function runCompactPackage(argv) {
  const args = Object.create(null), flags = new Set(['--manifest', '--output', '--oci-layout', '--expected-revision'])
  for (let i = 0; i < argv.length; i += 2) {
    if (!flags.has(argv[i]) || args[argv[i]] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
    args[argv[i]] = argv[i + 1]
  }
  if (!args['--manifest'] || !args['--output']) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
  const result = await packageCompactRelease({ manifest: args['--manifest'], outputDirectory: args['--output'], expectedRevision: args['--expected-revision'], imageExporter: args['--oci-layout'] ? async () => ({ layoutDirectory: path.resolve(args['--oci-layout']) }) : undefined })
  return { status: 'PACKAGED', releaseId: result.releaseId, manifestSha256: result.manifestSha256, payloadFiles: result.payloadFiles, transport: result.archives.length ? 'oci' : 'registry' }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCompactPackage(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n'), error => { process.stderr.write((error instanceof CompactError ? error.code : 'COMPACT_PACKAGE_FAILED') + '\n'); process.exitCode = 1 })
}
