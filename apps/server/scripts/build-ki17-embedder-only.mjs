#!/usr/bin/env node
// Build a local main-dev-only image with one official GenesisBlock helper overlaid
// on the qualified KI17 worker image. This script never deploys or pushes an image.
// @spec ADR-075 — preserve the qualified GenesisRAG17 runtime tuple during overlay.
// @tested tests/unit/ki17-embedder-only-overlay.test.js

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BASE_EMBEDDER_SHA256,
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

function inspectBase({ run = commandResult } = {}) {
  const repoDigests = run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', BASE_IMAGE_REF])
  assertBaseImageDigests(repoDigests)
  return {
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

export function buildDockerArgs({ tag, configurationCommit, helperSourceCommit, helperSha256, contextDir }) {
  const expectedTag = `${CANDIDATE_TAG_PREFIX}${helperSourceCommit.slice(0, 8)}`
  if (tag !== expectedTag) fail('KI17_EMBEDDER_TAG_INVALID', 'candidate tag must use the fixed main-dev-only prefix and source commit')
  if (!HEX_40.test(configurationCommit) || !HEX_40.test(helperSourceCommit) || !HEX_64.test(helperSha256)) {
    fail('KI17_EMBEDDER_BUILD_ARGS_INVALID', 'build provenance arguments must be full hexadecimal hashes')
  }
  return [
    'build',
    '--pull=false',
    '--network=none',
    '--file', DOCKERFILE,
    '--build-arg', `BASE_IMAGE=${BASE_IMAGE_REF}`,
    '--build-arg', `CONFIGURATION_COMMIT=${configurationCommit}`,
    '--build-arg', `HELPER_SOURCE_COMMIT=${helperSourceCommit}`,
    '--build-arg', `HELPER_SOURCE_SHA256=${helperSha256}`,
    '--build-context', `helper-source=${contextDir}`,
    '--tag', tag,
    '.',
  ]
}

function createContext(source, receipt) {
  const contextDir = mkdtempSync(path.join(os.tmpdir(), 'ki17-e5-batch32-'))
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

export function buildPlan({ tag, configurationCommit, source, contextDir }) {
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
  const baseArtifacts = inspectBase({ run })
  const receipt = createReceipt({ source, baseArtifacts, configurationCommit })
  validateOverlay({
    phase: 'before',
    receipt,
    pinsBytes: baseArtifacts.pinsBytes,
    resolvedBytes: baseArtifacts.resolvedBytes,
    currentHelperBytes: baseArtifacts.helperBytes,
    candidateHelperBytes: source.bytes,
  })

  const contextDir = createContext(source, receipt)
  try {
    const tag = receipt.candidateTag
    const args = buildDockerArgs({ tag, configurationCommit, helperSourceCommit: source.commit, helperSha256: source.sha256, contextDir })
    run('docker', args, { cwd: SERVER_ROOT })
    verifyBuiltImage({ tag, receipt, baseArtifacts, run })
    process.stdout.write(`Main-dev helper candidate built: ${tag}\n`)
    process.stdout.write(`GenesisBlock helper commit: ${source.commit}\n`)
    process.stdout.write(`GenesisBlock helper SHA-256: ${source.sha256}\n`)
    process.stdout.write('No Compose service was started; no image was pushed.\n')
    return { tag, receipt }
  } finally {
    rmSync(contextDir, { recursive: true, force: true })
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
