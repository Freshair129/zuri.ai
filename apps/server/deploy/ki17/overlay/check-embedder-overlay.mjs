#!/usr/bin/env node
// Validates the isolated main-dev E5 helper overlay without changing the default
// KI17 pin receipt. The helper source is a separately attested GenesisBlock blob.
// @spec ADR-075 — bind the helper overlay to the existing GenesisRAG17 worker tuple.
// @tested tests/unit/ki17-embedder-only-overlay.test.js

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASE_IMAGE_REF = 'zuri-ai-main-dev-genesis-worker@sha256:9bee2c31dc0efee6f2564eab273f9c815961a1635c08a29805849524974163e7'
export const BASE_IMAGE_DIGEST = BASE_IMAGE_REF.slice(BASE_IMAGE_REF.lastIndexOf('@') + 1)
export const BASE_EMBEDDER_SHA256 = 'dd7e9e51f61faf5a3d6d0bbe894c8c75b235f589c0906ca952c790afeb555e35'
export const BASE_GENESISBLOCK_COMMIT = '5156f412da73905a23d74775a82cc14d1f6d04d0'
export const HELPER_REPOSITORY = 'Freshair129/GenesisBlock'
export const HELPER_ORIGIN = 'https://github.com/Freshair129/GenesisBlock.git'
export const HELPER_PATH = 'genesisrag17-worker/src/embedder.py'
export const HELPER_TARGET = `/opt/ki17/genesisblock/${HELPER_PATH}`
export const OVERLAY_RECEIPT_PATH = '/opt/ki17/pins/e5-embedder-overlay.json'
export const OVERLAY_PROFILE = 'main-dev-e5-batch32'
export const CANDIDATE_TAG_PREFIX = 'zuri-ai-genesis-worker:main-dev-e5-batch32-'

const EXPECTED_RUNTIME = Object.freeze({
  node: '24.18.0',
  python: '3.12',
  modelRepository: 'intfloat/multilingual-e5-small',
  modelRevision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
})
const EXPECTED_COMMITS = Object.freeze({
  msp: 'd0d48c1a8e833478525d9a6ce5ee16af2c85444d',
  gks: 'ecf1e4de269e949406a6a5f791f9ff8fe30c9578',
  genesisblock: BASE_GENESISBLOCK_COMMIT,
})
const HEX_40 = /^[0-9a-f]{40}$/
const HEX_64 = /^[0-9a-f]{64}$/

export class EmbedderOverlayError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'EmbedderOverlayError'
    this.code = code
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fail(code, message) {
  throw new EmbedderOverlayError(code, message)
}

function requireString(value, pattern, field) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('KI17_EMBEDDER_OVERLAY_RECEIPT_INVALID', `${field} has an invalid value`)
}

function assertPinProfile(pins, resolved) {
  if (pins?.profile !== 'stdio' || resolved?.profile !== 'stdio') {
    fail('KI17_EMBEDDER_OVERLAY_BASE_PROFILE_MISMATCH', 'the inherited runtime must retain the stdio pin profile')
  }
  for (const [key, expected] of Object.entries(EXPECTED_RUNTIME)) {
    if (pins?.runtime?.[key] !== expected || resolved?.runtime?.[key] !== expected) {
      fail('KI17_EMBEDDER_OVERLAY_BASE_RUNTIME_MISMATCH', `${key} does not match the qualified base runtime`)
    }
  }
  for (const [name, expected] of Object.entries(EXPECTED_COMMITS)) {
    const manifestPin = pins?.repositories?.[name]
    const resolvedContext = resolved?.contexts?.find((context) => context?.name === name)
    if (manifestPin?.commit !== expected || resolvedContext?.commit !== expected) {
      fail('KI17_EMBEDDER_OVERLAY_BASE_PIN_MISMATCH', `${name} does not match the qualified base tuple`)
    }
  }
}

/**
 * Verify the pre-copy and post-copy image state. `before` proves that the named
 * immutable base still has the attested old helper; `after` proves the copied
 * helper and separate receipt agree while the default pins remain byte-identical.
 */
export function validateOverlay({
  phase,
  receipt,
  pinsBytes,
  resolvedBytes,
  currentHelperBytes,
  candidateHelperBytes = null,
  expectedSourceCommit = null,
  expectedSourceSha256 = null,
}) {
  if (!['before', 'after'].includes(phase)) fail('KI17_EMBEDDER_OVERLAY_PHASE_INVALID', 'phase must be before or after')

  let pins
  let resolved
  try {
    pins = JSON.parse(Buffer.from(pinsBytes).toString('utf8'))
    resolved = JSON.parse(Buffer.from(resolvedBytes).toString('utf8'))
  } catch {
    fail('KI17_EMBEDDER_OVERLAY_BASE_JSON_INVALID', 'the inherited pins or resolved receipt is not valid JSON')
  }

  if (receipt?.schemaVersion !== 1 || receipt?.profile !== OVERLAY_PROFILE || receipt?.scope !== 'main-dev-only') {
    fail('KI17_EMBEDDER_OVERLAY_RECEIPT_INVALID', 'the receipt must identify schema v1 and the main-dev-only profile')
  }
  if (receipt?.base?.imageRef !== BASE_IMAGE_REF) fail('KI17_EMBEDDER_OVERLAY_BASE_REFERENCE_MISMATCH', 'receipt does not name the qualified immutable base image')
  const localOciLayout = receipt?.base?.localOciLayout
  if (localOciLayout?.indexDigest !== BASE_IMAGE_DIGEST || localOciLayout?.platform !== 'linux/amd64') {
    fail('KI17_EMBEDDER_OVERLAY_BASE_LAYOUT_MISMATCH', 'receipt does not bind the local OCI layout to the qualified digest and platform')
  }
  requireString(localOciLayout?.manifestDigest, /^sha256:[0-9a-f]{64}$/, 'base.localOciLayout.manifestDigest')
  requireString(localOciLayout?.configDigest, /^sha256:[0-9a-f]{64}$/, 'base.localOciLayout.configDigest')
  requireString(localOciLayout?.daemonImageId, /^sha256:[0-9a-f]{64}$/, 'base.localOciLayout.daemonImageId')
  if (![localOciLayout.indexDigest, localOciLayout.manifestDigest, localOciLayout.configDigest].includes(localOciLayout.daemonImageId)) {
    fail('KI17_EMBEDDER_OVERLAY_BASE_LAYOUT_MISMATCH', 'daemon image ID must bind to the OCI index, platform manifest, or image config digest')
  }
  if (!Array.isArray(localOciLayout?.layerDigests) || localOciLayout.layerDigests.length === 0 ||
      !Array.isArray(localOciLayout?.rootFsDiffIds) || localOciLayout.rootFsDiffIds.length !== localOciLayout.layerDigests.length) {
    fail('KI17_EMBEDDER_OVERLAY_BASE_LAYOUT_MISMATCH', 'receipt must bind every selected image layer and root filesystem diff ID')
  }
  for (const [index, digest] of localOciLayout.layerDigests.entries()) {
    requireString(digest, /^sha256:[0-9a-f]{64}$/, `base.localOciLayout.layerDigests[${index}]`)
  }
  for (const [index, digest] of localOciLayout.rootFsDiffIds.entries()) {
    requireString(digest, /^sha256:[0-9a-f]{64}$/, `base.localOciLayout.rootFsDiffIds[${index}]`)
  }
  if (receipt?.base?.profile !== 'stdio') fail('KI17_EMBEDDER_OVERLAY_BASE_PROFILE_MISMATCH', 'receipt does not bind the inherited stdio profile')
  if (receipt?.base?.previousEmbedderSha256 !== BASE_EMBEDDER_SHA256) fail('KI17_EMBEDDER_OVERLAY_BASE_HELPER_MISMATCH', 'receipt does not bind the helper already present in the base image')

  for (const field of ['pinsSha256', 'resolvedSha256']) requireString(receipt?.base?.[field], HEX_64, `base.${field}`)
  if (sha256(pinsBytes) !== receipt.base.pinsSha256 || sha256(resolvedBytes) !== receipt.base.resolvedSha256) {
    fail('KI17_EMBEDDER_OVERLAY_BASE_RECEIPT_MISMATCH', 'inherited pin files differ from the files bound by the overlay receipt')
  }
  assertPinProfile(pins, resolved)
  for (const [key, expected] of Object.entries(EXPECTED_RUNTIME)) {
    if (receipt?.base?.runtime?.[key] !== expected) fail('KI17_EMBEDDER_OVERLAY_BASE_RECEIPT_MISMATCH', `base.runtime.${key} does not bind the qualified tuple`)
  }
  for (const [name, expected] of Object.entries(EXPECTED_COMMITS)) {
    if (receipt?.base?.commits?.[name] !== expected) fail('KI17_EMBEDDER_OVERLAY_BASE_RECEIPT_MISMATCH', `base.commits.${name} does not bind the qualified tuple`)
  }

  const source = receipt?.source
  if (source?.repository !== HELPER_REPOSITORY || source?.origin !== HELPER_ORIGIN || source?.path !== HELPER_PATH) {
    fail('KI17_EMBEDDER_OVERLAY_SOURCE_MISMATCH', 'the helper must come from the pinned GenesisBlock repository path')
  }
  requireString(source?.commit, HEX_40, 'source.commit')
  requireString(source?.gitBlobSha1, HEX_40, 'source.gitBlobSha1')
  requireString(source?.sha256, HEX_64, 'source.sha256')
  if (expectedSourceCommit && source.commit !== expectedSourceCommit) fail('KI17_EMBEDDER_OVERLAY_SOURCE_MISMATCH', 'receipt source commit differs from the requested build commit')
  if (expectedSourceSha256 && source.sha256 !== expectedSourceSha256) fail('KI17_EMBEDDER_OVERLAY_SOURCE_MISMATCH', 'receipt helper SHA-256 differs from the requested build hash')
  requireString(receipt?.configurationCommit, HEX_40, 'configurationCommit')
  const expectedTag = `${CANDIDATE_TAG_PREFIX}${source.commit.slice(0, 8)}`
  if (receipt?.candidateTag !== expectedTag) fail('KI17_EMBEDDER_OVERLAY_TAG_INVALID', 'candidate tag must be the deterministic main-dev-only tag for the helper source commit')
  if (receipt?.overlay?.targetPath !== HELPER_TARGET || receipt?.overlay?.helperSha256 !== source.sha256) {
    fail('KI17_EMBEDDER_OVERLAY_SOURCE_MISMATCH', 'overlay destination and helper digest must match the source receipt')
  }
  if (source.commit === BASE_GENESISBLOCK_COMMIT || source.sha256 === BASE_EMBEDDER_SHA256) {
    fail('KI17_EMBEDDER_OVERLAY_NO_CHANGE', 'the overlay must identify a distinct helper source commit and blob')
  }

  const currentHash = sha256(currentHelperBytes)
  if (phase === 'before') {
    if (currentHash !== BASE_EMBEDDER_SHA256) fail('KI17_EMBEDDER_OVERLAY_BASE_HELPER_MISMATCH', 'the qualified base does not contain the expected previous helper')
    if (!candidateHelperBytes || sha256(candidateHelperBytes) !== source.sha256) {
      fail('KI17_EMBEDDER_OVERLAY_SOURCE_HASH_MISMATCH', 'the staged helper bytes do not match the source commit receipt')
    }
  } else if (currentHash !== source.sha256) {
    fail('KI17_EMBEDDER_OVERLAY_SOURCE_HASH_MISMATCH', 'the overlaid helper bytes do not match the source commit receipt')
  }

  return {
    phase,
    profile: OVERLAY_PROFILE,
    baseImageRef: BASE_IMAGE_REF,
    baseGenesisBlockCommit: resolved.contexts.find((context) => context.name === 'genesisblock').commit,
    helperSourceCommit: source.commit,
    helperSha256: source.sha256,
    candidateTag: receipt.candidateTag,
  }
}

function parseCli(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!['--phase', '--receipt', '--pins', '--resolved', '--current-helper', '--candidate-helper', '--expected-source-commit', '--expected-source-sha256'].includes(flag)) {
      fail('KI17_EMBEDDER_OVERLAY_ARGS_INVALID', `unknown argument ${flag ?? '(missing)'}`)
    }
    if (typeof value !== 'string' || value.startsWith('--')) fail('KI17_EMBEDDER_OVERLAY_ARGS_INVALID', `${flag} requires a value`)
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    options[key] = value
    i += 1
  }
  for (const key of ['phase', 'receipt', 'pins', 'resolved', 'currentHelper']) {
    if (!options[key]) fail('KI17_EMBEDDER_OVERLAY_ARGS_INVALID', `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`)
  }
  if (options.phase === 'before' && !options.candidateHelper) fail('KI17_EMBEDDER_OVERLAY_ARGS_INVALID', '--candidate-helper is required before copy')
  return options
}

function main(argv) {
  const options = parseCli(argv)
  const receipt = JSON.parse(readFileSync(options.receipt, 'utf8'))
  const result = validateOverlay({
    phase: options.phase,
    receipt,
    pinsBytes: readFileSync(options.pins),
    resolvedBytes: readFileSync(options.resolved),
    currentHelperBytes: readFileSync(options.currentHelper),
    candidateHelperBytes: options.candidateHelper ? readFileSync(options.candidateHelper) : null,
    expectedSourceCommit: options.expectedSourceCommit ?? null,
    expectedSourceSha256: options.expectedSourceSha256 ?? null,
  })
  process.stdout.write(`ki17 helper overlay ${result.phase} verified (${result.profile}; base ${result.baseGenesisBlockCommit}; helper ${result.helperSourceCommit})\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
