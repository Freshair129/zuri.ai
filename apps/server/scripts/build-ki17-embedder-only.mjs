#!/usr/bin/env node
// Build a local main-dev-only image with one official GenesisBlock helper overlaid
// on the qualified KI17 worker image. This script never deploys or pushes an image.
// @spec ADR-075 — preserve the qualified GenesisRAG17 runtime tuple during overlay.
// @tested tests/unit/ki17-embedder-only-overlay.test.js

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  BASE_EMBEDDER_SHA256,
  BASE_IMAGE_DIGEST,
  BASE_GENESISBLOCK_COMMIT,
  BASE_IMAGE_REF,
  CANDIDATE_TAG_PREFIX,
  HELPER_ORIGIN,
  HELPER_PATH,
  HELPER_REPOSITORY,
  HELPER_TARGET,
  OVERLAY_PROFILE,
  OVERLAY_RECEIPT_PATH,
  sha256,
  validateOverlay,
} from '../deploy/ki17/overlay/check-embedder-overlay.mjs'

const REPO_ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'))
const SERVER_ROOT = path.join(REPO_ROOT, 'apps', 'server')
const DOCKERFILE = 'deploy/ki17/overlay/embedder-only.Dockerfile'
const EXPECTED_PIN_COMMITS = Object.freeze({
  msp: 'd0d48c1a8e833478525d9a6ce5ee16af2c85444d',
  gks: 'ecf1e4de269e949406a6a5f791f9ff8fe30c9578',
  genesisblock: BASE_GENESISBLOCK_COMMIT,
})
const EXPECTED_RUNTIME = Object.freeze({
  node: '24.18.0',
  python: '3.12',
  modelRepository: 'intfloat/multilingual-e5-small',
  modelRevision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
})
const HEX_40 = /^[0-9a-f]{40}$/
const HEX_64 = /^[0-9a-f]{64}$/

export class EmbedderBuildError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'EmbedderBuildError'
    this.code = code
  }
}

function fail(code, message) {
  throw new EmbedderBuildError(code, message)
}

function commandResult(command, args, { cwd, binary = false, spawn = spawnSync } = {}) {
  const result = spawn(command, args, {
    cwd,
    encoding: binary ? null : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error) fail('KI17_EMBEDDER_BUILD_COMMAND_FAILED', `${command} could not start (${result.error.code ?? result.error.message})`)
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr ?? '')
    fail('KI17_EMBEDDER_BUILD_COMMAND_FAILED', `${command} exited ${result.status}: ${stderr.trim().slice(-1600)}`)
  }
  return binary ? Buffer.from(result.stdout ?? []) : String(result.stdout ?? '').trim()
}

function normalizeOrigin(value) {
  const raw = String(value ?? '').trim()
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(raw)
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i.exec(raw)
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(raw)
  const match = https ?? ssh ?? sshUrl
  return match ? `https://github.com/${match[1].toLowerCase()}.git` : null
}

export function assertSourceDescriptor({ origin, head, requestedCommit, cleanStatus, bytes, expectedSha256, gitBlobSha1 }) {
  const normalizedOrigin = normalizeOrigin(origin)
  if (normalizedOrigin !== HELPER_ORIGIN.toLowerCase()) fail('KI17_EMBEDDER_SOURCE_ORIGIN_INVALID', `origin must be ${HELPER_ORIGIN}`)
  if (!HEX_40.test(String(requestedCommit ?? '')) || head !== requestedCommit) fail('KI17_EMBEDDER_SOURCE_COMMIT_MISMATCH', 'source checkout HEAD must equal the requested full helper commit')
  if (String(cleanStatus ?? '').trim()) fail('KI17_EMBEDDER_SOURCE_DIRTY', 'source checkout has tracked changes; use the committed helper blob')
  if (!HEX_64.test(String(expectedSha256 ?? '')) || !HEX_40.test(String(gitBlobSha1 ?? ''))) fail('KI17_EMBEDDER_SOURCE_HASH_INVALID', 'the expected content and Git blob hashes must be full hexadecimal digests')
  const content = Buffer.from(bytes ?? [])
  if (content.includes(0x0d)) fail('KI17_EMBEDDER_SOURCE_NOT_LF', 'the committed helper blob must use LF line endings')
  const actualSha = createHash('sha256').update(content).digest('hex')
  if (actualSha !== expectedSha256) fail('KI17_EMBEDDER_SOURCE_HASH_MISMATCH', 'the Git blob SHA-256 does not match the supplied frozen hash')
  const actualGitBlobSha1 = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
  if (actualGitBlobSha1 !== gitBlobSha1) fail('KI17_EMBEDDER_SOURCE_BLOB_MISMATCH', 'the source bytes do not match the Git blob object named by the commit')
  if (!content.length || actualSha === BASE_EMBEDDER_SHA256) fail('KI17_EMBEDDER_SOURCE_NO_CHANGE', 'the helper must be a non-empty source blob that differs from the qualified base')
  return {
    repository: HELPER_REPOSITORY,
    origin: HELPER_ORIGIN,
    commit: requestedCommit,
    path: HELPER_PATH,
    gitBlobSha1,
    sha256: actualSha,
    bytes: content,
  }
}

export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!['--helper-source-repo', '--source-commit', '--source-sha256'].includes(flag)) {
      fail('KI17_EMBEDDER_BUILD_ARGS_INVALID', `unknown argument ${flag ?? '(missing)'}`)
    }
    if (typeof value !== 'string' || value.startsWith('--')) fail('KI17_EMBEDDER_BUILD_ARGS_INVALID', `${flag} requires a value`)
    const key = flag === '--helper-source-repo' ? 'helperSourceRepo' : flag === '--source-commit' ? 'sourceCommit' : 'sourceSha256'
    options[key] = value
    index += 1
  }
  for (const key of ['helperSourceRepo', 'sourceCommit', 'sourceSha256']) {
    if (!options[key]) fail('KI17_EMBEDDER_BUILD_ARGS_INVALID', `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`)
  }
  if (!HEX_40.test(options.sourceCommit)) fail('KI17_EMBEDDER_SOURCE_COMMIT_INVALID', '--source-commit must be a full lowercase Git SHA')
  if (!HEX_64.test(options.sourceSha256)) fail('KI17_EMBEDDER_SOURCE_HASH_INVALID', '--source-sha256 must be a full lowercase SHA-256')
  return options
}

export function verifySourceCheckout(options, { run = commandResult } = {}) {
  const repo = realpathSync(options.helperSourceRepo)
  const get = (args, binary = false) => run('git', ['-C', repo, ...args], { binary })
  const origin = get(['remote', 'get-url', 'origin'])
  const head = get(['rev-parse', 'HEAD'])
  const cleanStatus = get(['status', '--porcelain', '--untracked-files=no'])
  const bytes = get(['show', `${options.sourceCommit}:${HELPER_PATH}`], true)
  const gitBlobSha1 = get(['rev-parse', `${options.sourceCommit}:${HELPER_PATH}`])
  return assertSourceDescriptor({
    origin,
    head,
    requestedCommit: options.sourceCommit,
    expectedSha256: options.sourceSha256,
    cleanStatus,
    bytes,
    gitBlobSha1,
  })
}

export function assertBaseImageDigests(repoDigestsText) {
  let repoDigests
  try {
    repoDigests = JSON.parse(repoDigestsText)
  } catch {
    fail('KI17_EMBEDDER_BASE_DIGEST_UNVERIFIABLE', 'Docker did not return the base image RepoDigests list')
  }
  if (!Array.isArray(repoDigests) || !repoDigests.includes(BASE_IMAGE_REF)) {
    fail('KI17_EMBEDDER_BASE_DIGEST_MISMATCH', 'the qualified immutable base digest is not present locally')
  }
  return BASE_IMAGE_REF
}

function parseBaseImageInspect(text) {
  const [imageId, osName, architecture, rootFsLayersText, repoDigestsText, configText] = String(text).split(/\r?\n/)
  if (!imageId || !osName || !architecture || !rootFsLayersText || !repoDigestsText || !configText) {
    fail('KI17_EMBEDDER_BASE_INSPECT_INVALID', 'Docker did not return the base image ID, platform, config, rootfs diff IDs, and RepoDigests')
  }
  let rootFsLayers
  let repoDigests
  let config
  try {
    rootFsLayers = JSON.parse(rootFsLayersText)
    repoDigests = JSON.parse(repoDigestsText)
    config = JSON.parse(configText)
  } catch {
    fail('KI17_EMBEDDER_BASE_INSPECT_INVALID', 'Docker returned invalid base platform metadata')
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(imageId) || !config || typeof config !== 'object' || Array.isArray(config)) {
    fail('KI17_EMBEDDER_BASE_INSPECT_INVALID', 'Docker returned invalid base image identity or config')
  }
  if (!Array.isArray(rootFsLayers) || rootFsLayers.some((digest) => !/^sha256:[0-9a-f]{64}$/.test(digest))) {
    fail('KI17_EMBEDDER_BASE_INSPECT_INVALID', 'Docker returned invalid base rootfs diff IDs')
  }
  assertBaseImageDigests(JSON.stringify(repoDigests))
  if (osName !== 'linux' || architecture !== 'amd64') {
    fail('KI17_EMBEDDER_BASE_PLATFORM_MISMATCH', 'the qualified local OCI base must resolve to linux/amd64')
  }
  return { imageId, os: osName, architecture, platform: `${osName}/${architecture}`, rootFsLayers, repoDigests, config }
}

function tarField(header, start, end) {
  const bytes = header.subarray(start, end)
  const nul = bytes.indexOf(0)
  return bytes.subarray(0, nul < 0 ? bytes.length : nul).toString('utf8')
}

function tarOctal(header, start, end, field) {
  const value = header.subarray(start, end).toString('ascii').replace(/\0.*$/s, '').trim()
  if (!value) return 0
  if (!/^[0-7]+$/.test(value)) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', `Docker image archive has an unsupported ${field} field`)
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', `Docker image archive has an invalid ${field} field`)
  return parsed
}

function assertTarHeader(header) {
  if (header.subarray(257, 263).toString('ascii') !== 'ustar\0') {
    fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive must use the ustar format')
  }
  const expected = tarOctal(header, 148, 156, 'header checksum')
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  if (actual !== expected) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive has a bad tar header checksum')
}

function readAt(fd, length, position, archiveSize) {
  if (!Number.isSafeInteger(length) || length < 0 || position + length > archiveSize) {
    fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive entry extends beyond the archive')
  }
  const buffer = Buffer.allocUnsafe(length)
  let read = 0
  while (read < length) {
    const count = readSync(fd, buffer, read, length - read, position + read)
    if (!count) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive ended unexpectedly')
    read += count
  }
  return buffer
}

function copyTarFile(fd, position, size, destination, expectedBlobDigest, archiveSize) {
  if (size > 2 ** 53 - 1 || position + size > archiveSize) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive entry has an invalid size')
  const output = openSync(destination, 'wx')
  const hash = createHash('sha256')
  const chunkSize = 1024 * 1024
  let copied = 0
  try {
    while (copied < size) {
      const chunk = readAt(fd, Math.min(chunkSize, size - copied), position + copied, archiveSize)
      hash.update(chunk)
      let written = 0
      while (written < chunk.length) {
        const count = writeSync(output, chunk, written, chunk.length - written)
        if (count === 0) fail('KI17_EMBEDDER_BASE_LAYOUT_WRITE_FAILED', 'could not write the local OCI image blob')
        written += count
      }
      copied += chunk.length
    }
  } finally {
    closeSync(output)
  }
  if (expectedBlobDigest && hash.digest('hex') !== expectedBlobDigest) {
    rmSync(destination, { force: true })
    fail('KI17_EMBEDDER_BASE_ARCHIVE_BLOB_MISMATCH', 'Docker image archive blob bytes do not match their content-addressed filename')
  }
  if (!expectedBlobDigest) hash.digest()
}

function parseOciImageReference(imageRef) {
  const match = /^.+@(sha256:[0-9a-f]{64})$/.exec(imageRef)
  if (!match) fail('KI17_EMBEDDER_BASE_REFERENCE_INVALID', 'base image reference must include a full sha256 digest')
  return match[1]
}

function readOciJson(layoutDir, relativePath, maxBytes = 4 * 1024 * 1024) {
  const file = path.join(layoutDir, ...relativePath.split('/'))
  let bytes
  try {
    bytes = readFileSync(file)
  } catch {
    fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', `local OCI layout is missing ${relativePath}`)
  }
  if (bytes.length > maxBytes) fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', `local OCI layout ${relativePath} exceeds its size limit`)
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) }
  } catch {
    fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', `local OCI layout ${relativePath} is not valid JSON`)
  }
}

export function validateLocalOciLayout(layoutDir, { imageRef = BASE_IMAGE_REF, imageInfo }) {
  const expectedDigest = parseOciImageReference(imageRef)
  if (!imageInfo || imageInfo.platform !== 'linux/amd64' || !Array.isArray(imageInfo.rootFsLayers) ||
      !/^sha256:[0-9a-f]{64}$/.test(String(imageInfo.imageId ?? '')) || !imageInfo.config || typeof imageInfo.config !== 'object') {
    fail('KI17_EMBEDDER_BASE_INSPECT_INVALID', 'base image platform and rootfs metadata are required to validate its OCI layout')
  }
  if (!Array.isArray(imageInfo.repoDigests) || !imageInfo.repoDigests.includes(imageRef)) {
    fail('KI17_EMBEDDER_BASE_DIGEST_MISMATCH', 'Docker image inspection does not bind the local OCI export to the qualified RepoDigest')
  }
  const layout = readOciJson(layoutDir, 'oci-layout').value
  if (layout?.imageLayoutVersion !== '1.0.0') fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', 'local OCI layout must use version 1.0.0')
  const { value: index } = readOciJson(layoutDir, 'index.json')
  if (index?.schemaVersion !== 2 || index?.mediaType !== 'application/vnd.oci.image.index.v1+json' || !Array.isArray(index.manifests)) {
    fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', 'local OCI layout index is not a valid OCI image index')
  }
  const roots = index.manifests.filter((descriptor) => descriptor?.digest === expectedDigest)
  if (roots.length !== 1 || index.manifests.length !== 1) fail('KI17_EMBEDDER_BASE_LAYOUT_DIGEST_MISMATCH', 'local OCI layout must contain exactly the qualified base digest as its root')

  const seen = new Set()
  const blobs = new Set()
  const platformManifests = []
  const verifyDescriptor = (descriptor, platform = null) => {
    const digestMatch = /^sha256:([0-9a-f]{64})$/.exec(descriptor?.digest ?? '')
    if (!digestMatch || !Number.isSafeInteger(descriptor?.size) || descriptor.size < 0 || typeof descriptor.mediaType !== 'string') {
      fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', 'local OCI layout contains an invalid content descriptor')
    }
    const digest = digestMatch[1]
    const blobPath = path.join(layoutDir, 'blobs', 'sha256', digest)
    let bytes
    try {
      bytes = readFileSync(blobPath)
    } catch {
      fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', `local OCI layout is missing blob ${descriptor.digest}`)
    }
    if (bytes.length !== descriptor.size || sha256(bytes) !== digest) fail('KI17_EMBEDDER_BASE_LAYOUT_BLOB_MISMATCH', `local OCI blob ${descriptor.digest} does not match its descriptor`)
    blobs.add(digest)
    if (seen.has(digest)) return null
    seen.add(digest)
    const isIndex = descriptor.mediaType === 'application/vnd.oci.image.index.v1+json' || descriptor.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json'
    const isManifest = descriptor.mediaType === 'application/vnd.oci.image.manifest.v1+json' || descriptor.mediaType === 'application/vnd.docker.distribution.manifest.v2+json'
    const isConfig = descriptor.mediaType === 'application/vnd.oci.image.config.v1+json' || descriptor.mediaType === 'application/vnd.docker.container.image.v1+json'
    if (!isIndex && !isManifest && !isConfig) return null
    let value
    try {
      value = JSON.parse(bytes.toString('utf8'))
    } catch {
      // Configs, layer archives and attestation payloads are not necessarily JSON.
      return null
    }
    if (isIndex) {
      if (value?.schemaVersion !== 2 || !Array.isArray(value.manifests)) fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', 'nested OCI index is malformed')
      for (const child of value.manifests) verifyDescriptor(child, child.platform ?? null)
      return null
    }
    if (isManifest) {
      if (value?.schemaVersion !== 2 || !value.config || !Array.isArray(value.layers)) fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', 'OCI image manifest is malformed')
      const config = verifyDescriptor(value.config)
      for (const layer of value.layers) verifyDescriptor(layer)
      const selectedPlatform = platform ?? (config ? { os: config.os, architecture: config.architecture } : null)
      if (selectedPlatform?.os === imageInfo.os && selectedPlatform?.architecture === imageInfo.architecture) {
        platformManifests.push({ digest: descriptor.digest, configDescriptor: value.config, layers: value.layers, config })
      }
      return null
    }
    return value?.rootfs?.diff_ids && value?.os && value?.architecture ? value : null
  }
  for (const root of roots) verifyDescriptor(root)
  if (platformManifests.length !== 1) fail('KI17_EMBEDDER_BASE_LAYOUT_PLATFORM_MISMATCH', 'local OCI index must resolve to exactly one linux/amd64 image manifest')

  const selected = platformManifests[0]
  if (!selected.config || selected.config.os !== imageInfo.os || selected.config.architecture !== imageInfo.architecture ||
      !Array.isArray(selected.config.rootfs?.diff_ids) ||
      !isDeepStrictEqual(selected.config.rootfs.diff_ids, imageInfo.rootFsLayers) ||
      !isDeepStrictEqual(selected.config.config ?? {}, imageInfo.config)) {
    fail('KI17_EMBEDDER_BASE_LAYOUT_CONFIG_MISMATCH', 'local OCI config, platform, or rootfs diff IDs differ from the verified Docker image')
  }
  const validImageIds = new Set([expectedDigest, selected.digest, selected.configDescriptor.digest])
  if (!validImageIds.has(imageInfo.imageId)) fail('KI17_EMBEDDER_BASE_IMAGE_ID_MISMATCH', 'Docker image ID does not identify the exported OCI index, selected manifest, or selected config')
  const ociBlobsDir = path.join(layoutDir, 'blobs', 'sha256')
  const actualBlobNames = readdirSync(ociBlobsDir)
  const actualBlobFiles = new Set(actualBlobNames.filter((name) => /^[0-9a-f]{64}$/.test(name)))
  if (actualBlobFiles.size !== blobs.size || actualBlobNames.length !== actualBlobFiles.size || [...actualBlobFiles].some((digest) => !blobs.has(digest))) {
    fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', 'local OCI layout contains an unreferenced or missing image blob')
  }
  return {
    indexDigest: expectedDigest,
    daemonImageId: imageInfo.imageId,
    manifestDigest: selected.digest,
    configDigest: selected.configDescriptor.digest,
    platform: imageInfo.platform,
    layerDigests: selected.layers.map((layer) => layer.digest),
    rootFsDiffIds: selected.config.rootfs.diff_ids,
  }
}

export function extractDockerOciArchive(archivePath, layoutDir, options = {}) {
  const { imageRef = BASE_IMAGE_REF, imageInfo } = options
  if (existsSync(layoutDir)) fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', 'local OCI layout destination must not already exist')
  mkdirSync(path.join(layoutDir, 'blobs', 'sha256'), { recursive: true })
  const fd = openSync(archivePath, 'r')
  let archiveSize
  try {
    archiveSize = statSync(archivePath).size
    let position = 0
    let ended = false
    const entries = new Set()
    const extracted = new Set()
    while (position + 512 <= archiveSize) {
      const header = readAt(fd, 512, position, archiveSize)
      if (header.every((byte) => byte === 0)) {
        ended = true
        position += 512
        break
      }
      assertTarHeader(header)
      const name = tarField(header, 0, 100)
      const prefix = tarField(header, 345, 500)
      const entryName = (prefix ? `${prefix}/${name}` : name).replace(/\/$/, '')
      const type = String.fromCharCode(header[156] || 0)
      const size = tarOctal(header, 124, 136, 'entry size')
      const dataPosition = position + 512
      const paddedSize = Math.ceil(size / 512) * 512
      if (!entryName || entryName.startsWith('/') || entryName.includes('\\') || entryName.split('/').some((segment) => segment === '..' || segment === '.')) {
        fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive contains an unsafe path')
      }
      if (entries.has(entryName)) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive contains duplicate paths')
      entries.add(entryName)
      if (dataPosition + paddedSize > archiveSize) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive entry extends beyond the archive')

      const isDirectory = type === '5'
      if (isDirectory) {
        if (size !== 0 || !['blobs', 'blobs/sha256'].includes(entryName)) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive contains an unexpected directory')
      } else if (type === '\0' || type === '0') {
        const blobMatch = /^blobs\/sha256\/([0-9a-f]{64})$/.exec(entryName)
        const rootFile = ['oci-layout', 'index.json'].includes(entryName)
        const dockerMetadata = ['manifest.json', 'repositories'].includes(entryName)
        if (!blobMatch && !rootFile && !dockerMetadata) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive contains an unexpected file')
        if (rootFile && size > 1024 * 1024) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive metadata exceeds its size limit')
        if (dockerMetadata) {
          position = dataPosition + paddedSize
          continue
        }
        const destination = path.join(layoutDir, ...entryName.split('/'))
        copyTarFile(fd, dataPosition, size, destination, blobMatch?.[1] ?? null, archiveSize)
        extracted.add(entryName)
      } else {
        fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive uses an unsupported tar entry type')
      }
      position = dataPosition + paddedSize
    }
    if (!ended) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive has no tar end marker')
    while (position < archiveSize) {
      const tail = readAt(fd, Math.min(1024 * 1024, archiveSize - position), position, archiveSize)
      if (!tail.every((byte) => byte === 0)) fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive has nonzero data after its end marker')
      position += tail.length
    }
    if (!extracted.has('oci-layout') || !extracted.has('index.json') || ![...extracted].some((name) => name.startsWith('blobs/sha256/'))) {
      fail('KI17_EMBEDDER_BASE_ARCHIVE_INVALID', 'Docker image archive does not contain an OCI image layout')
    }
  } finally {
    closeSync(fd)
  }
  return validateLocalOciLayout(layoutDir, { imageRef, imageInfo })
}

function assertBaseContextClean({ run = commandResult } = {}) {
  const status = run('git', ['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)output'], { cwd: SERVER_ROOT })
  if (status) fail('KI17_EMBEDDER_ZURI_CONTEXT_DIRTY', 'apps/server build inputs must be committed before building the candidate')
  const revision = run('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'])
  if (!HEX_40.test(revision)) fail('KI17_EMBEDDER_CONFIG_REVISION_INVALID', 'could not resolve the full Zuri configuration commit')
  return revision
}

function readBaseArtifact(relativePath, { run = commandResult } = {}) {
  return run('docker', [
    'run', '--rm', '--network', 'none', '--entrypoint', 'cat', BASE_IMAGE_REF, relativePath,
  ], { binary: true })
}

function inspectBase({ run = commandResult, workDir }) {
  const inspection = run('docker', [
    'image', 'inspect', '--format', '{{.Id}}{{printf "\\n"}}{{.Os}}{{printf "\\n"}}{{.Architecture}}{{printf "\\n"}}{{json .RootFS.Layers}}{{printf "\\n"}}{{json .RepoDigests}}{{printf "\\n"}}{{json .Config}}', BASE_IMAGE_REF,
  ])
  const imageInfo = parseBaseImageInspect(inspection)
  const archivePath = path.join(workDir, 'base-image.tar')
  const layoutDir = path.join(workDir, 'base-oci-layout')
  run('docker', ['image', 'save', '--output', archivePath, BASE_IMAGE_REF])
  const localOciLayout = extractDockerOciArchive(archivePath, layoutDir, { imageRef: BASE_IMAGE_REF, imageInfo })
  rmSync(archivePath, { force: true })
  return {
    localOciLayout,
    pinsBytes: readBaseArtifact('/opt/ki17/pins/pins.json', { run }),
    resolvedBytes: readBaseArtifact('/opt/ki17/pins/resolved.json', { run }),
    helperBytes: readBaseArtifact(HELPER_TARGET, { run }),
  }
}

function parseJson(bytes, field) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    fail('KI17_EMBEDDER_BASE_JSON_INVALID', `${field} in the qualified base is not valid JSON`)
  }
}

function createReceipt({ source, baseArtifacts, configurationCommit }) {
  const pins = parseJson(baseArtifacts.pinsBytes, 'pins.json')
  const resolved = parseJson(baseArtifacts.resolvedBytes, 'resolved.json')
  const actualBaseHelperSha256 = sha256(baseArtifacts.helperBytes)
  if (actualBaseHelperSha256 !== BASE_EMBEDDER_SHA256) fail('KI17_EMBEDDER_BASE_HELPER_MISMATCH', 'qualified base helper does not match the recorded prior SHA-256')
  if (pins?.profile !== 'stdio' || resolved?.profile !== 'stdio') fail('KI17_EMBEDDER_BASE_PROFILE_MISMATCH', 'qualified base must retain the stdio pin profile')
  for (const [key, expected] of Object.entries(EXPECTED_RUNTIME)) {
    if (pins?.runtime?.[key] !== expected || resolved?.runtime?.[key] !== expected) fail('KI17_EMBEDDER_BASE_RUNTIME_MISMATCH', `${key} does not match the qualified base runtime`)
  }
  const resolvedByName = new Map((resolved.contexts ?? []).map((context) => [context.name, context.commit]))
  for (const [name, expected] of Object.entries(EXPECTED_PIN_COMMITS)) {
    if (pins?.repositories?.[name]?.commit !== expected || resolvedByName.get(name) !== expected) fail('KI17_EMBEDDER_BASE_PIN_MISMATCH', `${name} does not match the qualified base tuple`)
  }
  const candidateTag = `${CANDIDATE_TAG_PREFIX}${source.commit.slice(0, 8)}`
  return {
    schemaVersion: 1,
    id: 'zuri-ki17-e5-batch32-helper-overlay-v1',
    profile: OVERLAY_PROFILE,
    scope: 'main-dev-only',
    candidateTag,
    configurationCommit,
    base: {
      imageRef: BASE_IMAGE_REF,
      localOciLayout: baseArtifacts.localOciLayout,
      profile: pins.profile,
      pinsSha256: sha256(baseArtifacts.pinsBytes),
      resolvedSha256: sha256(baseArtifacts.resolvedBytes),
      previousEmbedderSha256: actualBaseHelperSha256,
      runtime: Object.fromEntries(Object.keys(EXPECTED_RUNTIME).map((key) => [key, pins.runtime[key]])),
      commits: Object.fromEntries(Object.keys(EXPECTED_PIN_COMMITS).map((key) => [key, pins.repositories[key].commit])),
    },
    source: {
      repository: source.repository,
      origin: source.origin,
      commit: source.commit,
      path: source.path,
      gitBlobSha1: source.gitBlobSha1,
      sha256: source.sha256,
    },
    overlay: {
      targetPath: HELPER_TARGET,
      helperSha256: source.sha256,
    },
  }
}

export function buildDockerArgs({ tag, configurationCommit, helperSourceCommit, helperSha256, contextDir, baseLayoutDir }) {
  const expectedTag = `${CANDIDATE_TAG_PREFIX}${helperSourceCommit.slice(0, 8)}`
  if (tag !== expectedTag) fail('KI17_EMBEDDER_TAG_INVALID', 'candidate tag must use the fixed main-dev-only prefix and source commit')
  if (!HEX_40.test(configurationCommit) || !HEX_40.test(helperSourceCommit) || !HEX_64.test(helperSha256)) {
    fail('KI17_EMBEDDER_BUILD_ARGS_INVALID', 'build provenance arguments must be full hexadecimal hashes')
  }
  if (typeof baseLayoutDir !== 'string' || !baseLayoutDir.trim()) fail('KI17_EMBEDDER_BASE_LAYOUT_INVALID', 'a verified local OCI layout directory is required')
  return [
    'build',
    '--pull=false',
    '--network=none',
    '--platform=linux/amd64',
    '--file', DOCKERFILE,
    '--build-arg', `BASE_IMAGE=${BASE_IMAGE_REF}`,
    '--build-arg', `CONFIGURATION_COMMIT=${configurationCommit}`,
    '--build-arg', `HELPER_SOURCE_COMMIT=${helperSourceCommit}`,
    '--build-arg', `HELPER_SOURCE_SHA256=${helperSha256}`,
    '--build-context', `helper-source=${contextDir}`,
    '--build-context', `base-image=${ociLayoutContextUri(baseLayoutDir, BASE_IMAGE_DIGEST)}`,
    '--tag', tag,
    '.',
  ]
}

export function ociLayoutContextUri(layoutDir, digest) {
  if (!/^sha256:[0-9a-f]{64}$/.test(String(digest))) fail('KI17_EMBEDDER_BASE_DIGEST_INVALID', 'local OCI context digest must be a full sha256 digest')
  const absolute = path.resolve(layoutDir).replaceAll('\\', '/')
  const uriPath = /^[A-Za-z]:\//.test(absolute) ? `/${absolute}` : absolute
  const encodedPath = uriPath.split('/').map((segment) => /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)).join('/')
  return `oci-layout://${encodedPath}@${digest}`
}

function createContext(source, receipt, workDir) {
  const contextDir = path.join(workDir, 'helper-source')
  mkdirSync(contextDir)
  writeFileSync(path.join(contextDir, 'embedder.py'), source.bytes, { mode: 0o644 })
  writeFileSync(path.join(contextDir, 'overlay-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 })
  return contextDir
}

function readImageArtifact(imageRef, relativePath, { run = commandResult } = {}) {
  return run('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'cat', imageRef, relativePath], { binary: true })
}

function inspectImageField(imageRef, field, { run = commandResult } = {}) {
  return run('docker', ['image', 'inspect', '--format', `{{json .Config.${field}}}`, imageRef])
}

function verifyBuiltImage({ tag, receipt, baseArtifacts, run = commandResult }) {
  const baseLabelsText = run('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', BASE_IMAGE_REF])
  const labelsText = run('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', tag])
  let baseLabels
  let labels
  try {
    baseLabels = JSON.parse(baseLabelsText)
    labels = JSON.parse(labelsText)
  } catch { fail('KI17_EMBEDDER_IMAGE_LABELS_INVALID', 'Docker did not return base and candidate image labels') }
  for (const [key, value] of Object.entries(baseLabels ?? {})) {
    if (labels?.[key] !== value) fail('KI17_EMBEDDER_IMAGE_LABELS_CHANGED', `candidate changed inherited image label ${key}`)
  }
  const expectedLabels = {
    'org.zuri.ki17.overlay-profile': OVERLAY_PROFILE,
    'org.zuri.ki17.overlay.base-image-ref': BASE_IMAGE_REF,
    'org.zuri.ki17.overlay.helper-source-revision': receipt.source.commit,
    'org.zuri.ki17.overlay.helper-source-sha256': receipt.source.sha256,
    'org.zuri.ki17.overlay.configuration-revision': receipt.configurationCommit,
  }
  for (const [key, expected] of Object.entries(expectedLabels)) {
    if (labels?.[key] !== expected) fail('KI17_EMBEDDER_IMAGE_LABEL_MISMATCH', `${key} does not match the overlay receipt`)
  }
  for (const field of ['Cmd', 'Entrypoint', 'User', 'WorkingDir']) {
    const fromBase = inspectImageField(BASE_IMAGE_REF, field, { run })
    const fromCandidate = inspectImageField(tag, field, { run })
    if (fromBase !== fromCandidate) fail('KI17_EMBEDDER_IMAGE_CONFIG_CHANGED', `candidate changed the inherited ${field} setting`)
  }

  const pinsBytes = readImageArtifact(tag, '/opt/ki17/pins/pins.json', { run })
  const resolvedBytes = readImageArtifact(tag, '/opt/ki17/pins/resolved.json', { run })
  const currentHelperBytes = readImageArtifact(tag, HELPER_TARGET, { run })
  const receiptBytes = readImageArtifact(tag, OVERLAY_RECEIPT_PATH, { run })
  if (!pinsBytes.equals(baseArtifacts.pinsBytes) || !resolvedBytes.equals(baseArtifacts.resolvedBytes)) {
    fail('KI17_EMBEDDER_IMAGE_BASE_PINS_CHANGED', 'candidate image changed the qualified base pin files')
  }
  const embeddedReceipt = parseJson(receiptBytes, OVERLAY_RECEIPT_PATH)
  validateOverlay({ phase: 'after', receipt: embeddedReceipt, pinsBytes, resolvedBytes, currentHelperBytes })
}

export function buildPlan({ tag, configurationCommit, source, contextDir, baseLayoutDir }) {
  return {
    tag,
    configurationCommit,
    sourceCommit: source.commit,
    sourceSha256: source.sha256,
    command: ['docker', ...buildDockerArgs({
      tag,
      configurationCommit,
      helperSourceCommit: source.commit,
      helperSha256: source.sha256,
      contextDir,
      baseLayoutDir,
    })],
    deploys: false,
    pushes: false,
  }
}

export function runBuild(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv)
  const run = dependencies.run ?? commandResult
  const source = verifySourceCheckout(options, { run })
  const configurationCommit = assertBaseContextClean({ run })
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'ki17-e5-batch32-'))
  try {
    const baseArtifacts = inspectBase({ run, workDir })
    const receipt = createReceipt({ source, baseArtifacts, configurationCommit })
    validateOverlay({
      phase: 'before',
      receipt,
      pinsBytes: baseArtifacts.pinsBytes,
      resolvedBytes: baseArtifacts.resolvedBytes,
      currentHelperBytes: baseArtifacts.helperBytes,
      candidateHelperBytes: source.bytes,
    })

    const contextDir = createContext(source, receipt, workDir)
    const baseLayoutDir = path.join(workDir, 'base-oci-layout')
    const tag = receipt.candidateTag
    const args = buildDockerArgs({ tag, configurationCommit, helperSourceCommit: source.commit, helperSha256: source.sha256, contextDir, baseLayoutDir })
    run('docker', args, { cwd: SERVER_ROOT })
    verifyBuiltImage({ tag, receipt, baseArtifacts, run })
    process.stdout.write(`Main-dev helper candidate built: ${tag}\n`)
    process.stdout.write(`GenesisBlock helper commit: ${source.commit}\n`)
    process.stdout.write(`GenesisBlock helper SHA-256: ${source.sha256}\n`)
    process.stdout.write(`Verified local OCI base: ${baseArtifacts.localOciLayout.indexDigest} (${baseArtifacts.localOciLayout.platform}; ${baseArtifacts.localOciLayout.layerDigests.length} layers)\n`)
    process.stdout.write('No Compose service was started; no image was pushed.\n')
    return { tag, receipt }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runBuild()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
