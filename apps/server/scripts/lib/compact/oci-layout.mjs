// @spec ADR-115 — complete OCI graph verification and deterministic USTAR transport.
// @tested tests/node/compact-package.test.mjs, tests/node/compact-oci-reference.test.mjs
import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { CompactError } from './manifest.mjs'
import { bytes, digest, listFiles, regularFile, openRegular, hashFile } from './files.mjs'

const OCI_INDEX = 'application/vnd.oci.image.index.v1+json'
const INDEXES = new Set([OCI_INDEX, 'application/vnd.docker.distribution.manifest.list.v2+json'])
const IMAGES = new Set(['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'])
const CONFIGS = new Set(['application/vnd.oci.image.config.v1+json', 'application/vnd.docker.container.image.v1+json'])
const LAYERS = new Set(['application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip', 'application/vnd.oci.image.layer.v1.tar+zstd', 'application/vnd.docker.image.rootfs.diff.tar.gzip'])
const CONTAINERD_IMAGE_NAME = 'io.containerd.image.name'
const OCI_REF_NAME = 'org.opencontainers.image.ref.name'
const OCI_REFERENCE_NAME = /^[A-Za-z0-9]+(?:(?:[-._:@+]|--)[A-Za-z0-9]+)*(?:\/[A-Za-z0-9]+(?:(?:[-._:@+]|--)[A-Za-z0-9]+)*)*$/
const IMAGE_REFERENCE = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/
const fail = () => { throw new CompactError('COMPACT_OCI_INVALID') }
const MAX_TAR_SIZE = 0o77777777777
function expectedImageReferences(images) {
  if (!images || typeof images !== 'object' || Array.isArray(images) || !Object.keys(images).length) fail()
  const references = new Map()
  for (const reference of Object.values(images)) {
    if (typeof reference !== 'string' || !IMAGE_REFERENCE.test(reference)) fail()
    references.set(reference, reference.slice(reference.lastIndexOf('@') + 1))
  }
  return references
}
function rootImageReference(descriptor, expectedReferences) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) fail()
  const annotations = descriptor.annotations
  if (annotations !== undefined && (!annotations || typeof annotations !== 'object' || Array.isArray(annotations))) fail()
  const hasContainerdName = Object.hasOwn(annotations ?? {}, CONTAINERD_IMAGE_NAME)
  const hasOciName = Object.hasOwn(annotations ?? {}, OCI_REF_NAME)
  const containerdName = hasContainerdName ? annotations[CONTAINERD_IMAGE_NAME] : undefined
  const ociName = hasOciName ? annotations[OCI_REF_NAME] : undefined
  if ((hasContainerdName && (typeof containerdName !== 'string' || !containerdName)) || (hasOciName && (typeof ociName !== 'string' || !ociName))) fail()

  // Containerd prefers its full image-name annotation over OCI ref.name. Never infer a repository
  // alias from a matching digest alone; ref.name is a fallback only when it names the exact pin.
  if (hasContainerdName) {
    if (expectedReferences.get(containerdName) !== descriptor.digest) fail()
    if (hasOciName) {
      const ociDigest = expectedReferences.get(ociName)
      if (ociDigest !== undefined && (ociName !== containerdName || ociDigest !== descriptor.digest)) fail()
      if (ociDigest === undefined && ociName.includes('@')) fail()
    }
    return containerdName
  }
  if (!hasOciName || !OCI_REFERENCE_NAME.test(ociName) || expectedReferences.get(ociName) !== descriptor.digest) fail()
  return ociName
}
export async function verifyOciLayout(directory, images) {
  const allowed = new Set(['oci-layout', 'index.json']), verified = new Map(), expectedHashes = new Map()
  const decode = raw => { try { return JSON.parse(raw.toString('utf8')) } catch { fail() } }
  const layoutBytes = await bytes(directory, 'oci-layout', 1024), layout = decode(layoutBytes)
  expectedHashes.set('oci-layout', digest(layoutBytes))
  if (layout?.imageLayoutVersion !== '1.0.0' || Object.keys(layout).length !== 1) fail()
  const indexBytes = await bytes(directory, 'index.json', 4 * 1024 * 1024), index = decode(indexBytes)
  expectedHashes.set('index.json', digest(indexBytes))
  if (index?.schemaVersion !== 2 || !Array.isArray(index.manifests) || !index.manifests.length) fail()
  const expectedReferences = expectedImageReferences(images), namedReferences = new Set()
  for (const root of index.manifests) {
    const reference = rootImageReference(root, expectedReferences)
    if (namedReferences.has(reference)) fail()
    namedReferences.add(reference)
  }
  if (namedReferences.size !== expectedReferences.size || [...expectedReferences.keys()].some(reference => !namedReferences.has(reference))) fail()
  let descriptors = 0
  async function descriptor(d, kind, depth = 0) {
    if (++descriptors > 100000 || depth > 8 || !d || !/^sha256:[a-f0-9]{64}$/.test(d.digest) || !Number.isSafeInteger(d.size) || d.size < 0 || d.size > MAX_TAR_SIZE) fail()
    // Compact v1 qualifies only the base linux/amd64 platform, without variants
    // or additional OS/CPU constraints. Check each reference, including cache hits.
    if (Object.hasOwn(d, 'platform') && (!d.platform || typeof d.platform !== 'object' || Array.isArray(d.platform) || d.platform.os !== 'linux' || d.platform.architecture !== 'amd64' || Object.keys(d.platform).some(k => !['os', 'architecture'].includes(k)))) fail()
    const relative = `blobs/sha256/${d.digest.slice(7)}`
    allowed.add(relative)
    expectedHashes.set(relative, d.digest.slice(7))
    const previous = verified.get(d.digest)
    if (previous && (previous.size !== d.size || previous.mediaType !== d.mediaType)) fail()
    let doc = previous?.doc
    if (!previous) {
      const { info } = await regularFile(directory, relative)
      if (info.size !== d.size) fail()
      if (kind === 'layer') { if (await hashFile(directory, relative) !== d.digest.slice(7)) fail() }
      else {
        const raw = await bytes(directory, relative, 4 * 1024 * 1024)
        if (raw.length !== d.size || digest(raw) !== d.digest.slice(7)) fail()
        doc = decode(raw)
      }
      verified.set(d.digest, { size: d.size, mediaType: d.mediaType, doc })
    }
    if (kind === 'layer') { if (!LAYERS.has(d.mediaType)) fail(); return }
    if (kind === 'config') {
      if (!CONFIGS.has(d.mediaType)) fail()
      if (doc?.os !== 'linux' || doc?.architecture !== 'amd64' || ['variant', 'os.version', 'os.features', 'features'].some(k => Object.hasOwn(doc, k))) fail()
      return
    }
    if (doc?.schemaVersion !== 2) fail()
    if (INDEXES.has(d.mediaType)) {
      if (!Array.isArray(doc.manifests) || !doc.manifests.length) fail()
      for (const item of doc.manifests) await descriptor(item, 'image', depth + 1)
    } else if (IMAGES.has(d.mediaType)) {
      if (!Array.isArray(doc.layers)) fail()
      await descriptor(doc.config, 'config', depth + 1)
      for (const layer of doc.layers) await descriptor(layer, 'layer', depth + 1)
    } else fail()
  }
  for (const item of index.manifests) await descriptor(item, 'image')
  const files = await listFiles(directory)
  if (JSON.stringify(files) !== JSON.stringify([...allowed].sort())) fail()
  for (const file of files) {
    const { info } = await regularFile(directory, file)
    if (info.size > MAX_TAR_SIZE) fail()
  }
  return { files, expectedHashes }
}
function header(filename, size) {
  if (Buffer.byteLength(filename) > 100 || size > MAX_TAR_SIZE) fail()
  const b = Buffer.alloc(512)
  b.write(filename, 0, 100, 'utf8')
  const octal = (offset, length, n) => b.write(n.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii')
  octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, size); octal(136, 12, 0)
  b.fill(32, 148, 156); b[156] = 48; b.write('ustar\0', 257, 'ascii'); b.write('00', 263, 'ascii')
  const sum = b.reduce((n, x) => n + x, 0)
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return b
}
export async function writeOciArchive(directory, images, filename) {
  const { files, expectedHashes } = await verifyOciLayout(directory, images)
  const output = await open(filename, 'wx', 0o644)
  async function write(buffer) {
    let offset = 0
    while (offset < buffer.length) { const result = await output.write(buffer, offset, buffer.length - offset); if (!result.bytesWritten) fail(); offset += result.bytesWritten }
  }
  try {
    for (const file of files) {
      const input = await openRegular(directory, file), { size } = await input.stat()
      try {
        await write(header(file, size)); let copied = 0; const hash = createHash('sha256')
        for await (const chunk of input.createReadStream({ autoClose: false })) { copied += chunk.length; hash.update(chunk); await write(chunk) }
        if (copied !== size || hash.digest('hex') !== expectedHashes.get(file)) fail()
        if (size % 512) await write(Buffer.alloc(512 - size % 512))
      } finally { await input.close() }
    }
    await write(Buffer.alloc(1024))
  } finally { await output.close() }
}
