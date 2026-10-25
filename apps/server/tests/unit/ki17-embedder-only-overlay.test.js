import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
  validateOverlay,
} from '../../deploy/ki17/overlay/check-embedder-overlay.mjs'
import {
  assertBaseImageDigests,
  assertSourceDescriptor,
  buildDockerArgs,
  buildPlan,
  verifySourceCheckout,
} from '../../scripts/build-ki17-embedder-only.mjs'

// @spec ADR-075 — verify the helper overlay preserves the qualified KI17 runtime tuple.
// @tested tests/unit/ki17-embedder-only-overlay.test.js
const recipePath = path.resolve('deploy/ki17/overlay/embedder-only.Dockerfile')
const checkerPath = path.resolve('deploy/ki17/overlay/check-embedder-overlay.mjs')
const recipe = readFileSync(recipePath, 'utf8')
const checker = readFileSync(checkerPath, 'utf8')
const sourceBytes = Buffer.from('def embed_batch(texts):\n    return texts\n', 'utf8')
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex')
const gitBlobSha1 = createHash('sha1').update(`blob ${sourceBytes.length}\0`).update(sourceBytes).digest('hex')
const sourceCommit = 'a'.repeat(40)
const configurationCommit = 'c'.repeat(40)
const expectedCommits = {
  msp: 'd0d48c1a8e833478525d9a6ce5ee16af2c85444d',
  gks: 'ecf1e4de269e949406a6a5f791f9ff8fe30c9578',
  genesisblock: BASE_GENESISBLOCK_COMMIT,
}
const expectedRuntime = {
  node: '24.18.0',
  python: '3.12',
  modelRepository: 'intfloat/multilingual-e5-small',
  modelRevision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
}

function baseArtifacts(overrides = {}) {
  const pins = {
    profile: 'stdio',
    runtime: { ...expectedRuntime },
    repositories: Object.fromEntries(Object.entries(expectedCommits).map(([name, commit]) => [name, { commit }])),
  }
  const resolved = {
    profile: 'stdio',
    runtime: { ...expectedRuntime },
    contexts: Object.entries(expectedCommits).map(([name, commit]) => ({ name, commit })),
  }
  Object.assign(pins, overrides.pins ?? {})
  Object.assign(resolved, overrides.resolved ?? {})
  return {
    pins,
    resolved,
    pinsBytes: Buffer.from(JSON.stringify(pins)),
    resolvedBytes: Buffer.from(JSON.stringify(resolved)),
  }
}

function receiptFor(artifacts = baseArtifacts(), helper = sourceBytes) {
  return {
    schemaVersion: 1,
    id: 'zuri-ki17-e5-batch32-helper-overlay-v1',
    profile: OVERLAY_PROFILE,
    scope: 'main-dev-only',
    candidateTag: `${CANDIDATE_TAG_PREFIX}${sourceCommit.slice(0, 8)}`,
    configurationCommit,
    base: {
      imageRef: BASE_IMAGE_REF,
      profile: 'stdio',
      pinsSha256: createHash('sha256').update(artifacts.pinsBytes).digest('hex'),
      resolvedSha256: createHash('sha256').update(artifacts.resolvedBytes).digest('hex'),
      previousEmbedderSha256: BASE_EMBEDDER_SHA256,
      runtime: { ...expectedRuntime },
      commits: { ...expectedCommits },
    },
    source: {
      repository: HELPER_REPOSITORY,
      origin: HELPER_ORIGIN,
      commit: sourceCommit,
      path: HELPER_PATH,
      gitBlobSha1,
      sha256: createHash('sha256').update(helper).digest('hex'),
    },
    overlay: {
      targetPath: HELPER_TARGET,
      helperSha256: createHash('sha256').update(helper).digest('hex'),
    },
  }
}

describe('KI17 helper-only main-dev image overlay', () => {
  it('binds the replacement helper to an unchanged base tuple and a separate source receipt', () => {
    const artifacts = baseArtifacts()
    const receipt = receiptFor(artifacts)
    const verified = validateOverlay({
      phase: 'after',
      receipt,
      pinsBytes: artifacts.pinsBytes,
      resolvedBytes: artifacts.resolvedBytes,
      currentHelperBytes: sourceBytes,
    })
    expect(verified).toMatchObject({
      profile: 'main-dev-e5-batch32',
      baseImageRef: BASE_IMAGE_REF,
      baseGenesisBlockCommit: BASE_GENESISBLOCK_COMMIT,
      helperSourceCommit: sourceCommit,
      helperSha256: sourceSha256,
    })
  })

  it('rejects default pin, model revision, or helper digest drift', () => {
    const artifacts = baseArtifacts()
    const receipt = receiptFor(artifacts)
    const changedResolved = Buffer.from(JSON.stringify({
      ...artifacts.resolved,
      contexts: artifacts.resolved.contexts.map((context) => context.name === 'genesisblock' ? { ...context, commit: 'f'.repeat(40) } : context),
    }))
    const changedReceipt = receiptFor({ ...artifacts, resolvedBytes: changedResolved })
    expect(() => validateOverlay({
      phase: 'after', receipt: changedReceipt, pinsBytes: artifacts.pinsBytes,
      resolvedBytes: changedResolved, currentHelperBytes: sourceBytes,
    })).toThrow(/BASE_PIN_MISMATCH/)
    expect(() => validateOverlay({
      phase: 'after', receipt, pinsBytes: artifacts.pinsBytes,
      resolvedBytes: artifacts.resolvedBytes, currentHelperBytes: Buffer.from('different helper'),
    })).toThrow(/SOURCE_HASH_MISMATCH/)
    expect(() => validateOverlay({
      phase: 'after', receipt, pinsBytes: artifacts.pinsBytes,
      resolvedBytes: artifacts.resolvedBytes, currentHelperBytes: sourceBytes,
      expectedSourceCommit: 'f'.repeat(40), expectedSourceSha256: sourceSha256,
    })).toThrow(/SOURCE_MISMATCH/)

    const changedPins = baseArtifacts({ pins: { runtime: { ...expectedRuntime, modelRevision: 'f'.repeat(40) } } })
    const changedPinsReceipt = receiptFor(changedPins)
    expect(() => validateOverlay({
      phase: 'after', receipt: changedPinsReceipt, pinsBytes: changedPins.pinsBytes,
      resolvedBytes: changedPins.resolvedBytes, currentHelperBytes: sourceBytes,
    })).toThrow(/BASE_RUNTIME_MISMATCH/)
  })

  it('requires an official, clean, exact GenesisBlock source commit and matching LF blob SHA', () => {
    expect(assertSourceDescriptor({
      origin: 'git@github.com:Freshair129/GenesisBlock.git',
      head: sourceCommit,
      requestedCommit: sourceCommit,
      cleanStatus: '',
      bytes: sourceBytes,
      expectedSha256: sourceSha256,
      gitBlobSha1,
    })).toMatchObject({ repository: HELPER_REPOSITORY, commit: sourceCommit, path: HELPER_PATH, sha256: sourceSha256 })
    expect(() => assertSourceDescriptor({
      origin: 'https://example.invalid/GenesisBlock.git', head: sourceCommit, requestedCommit: sourceCommit,
      cleanStatus: '', bytes: sourceBytes, expectedSha256: sourceSha256, gitBlobSha1,
    })).toThrow(/SOURCE_ORIGIN_INVALID/)
    expect(() => assertSourceDescriptor({
      origin: HELPER_ORIGIN, head: sourceCommit, requestedCommit: sourceCommit,
      cleanStatus: ' M genesisrag17-worker/src/embedder.py', bytes: sourceBytes,
      expectedSha256: sourceSha256, gitBlobSha1,
    })).toThrow(/SOURCE_DIRTY/)
    expect(() => assertSourceDescriptor({
      origin: HELPER_ORIGIN, head: sourceCommit, requestedCommit: sourceCommit,
      cleanStatus: '', bytes: Buffer.from('changed'), expectedSha256: sourceSha256, gitBlobSha1,
    })).toThrow(/SOURCE_HASH_MISMATCH/)
    expect(() => assertSourceDescriptor({
      origin: HELPER_ORIGIN, head: sourceCommit, requestedCommit: sourceCommit,
      cleanStatus: '', bytes: Buffer.from('bad\r\nline'), expectedSha256: createHash('sha256').update('bad\r\nline').digest('hex'), gitBlobSha1,
    })).toThrow(/SOURCE_NOT_LF/)
  })

  it('reads only the committed helper blob from an exact clean source checkout', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'ki17-source-test-'))
    try {
      const calls = []
      const outputs = [
        HELPER_ORIGIN,
        sourceCommit,
        '',
        sourceBytes,
        gitBlobSha1,
      ]
      const source = verifySourceCheckout({ helperSourceRepo: repo, sourceCommit, sourceSha256 }, {
        run: (_command, args, options) => {
          calls.push({ args, options })
          return outputs.shift()
        },
      })
      expect(source.sha256).toBe(sourceSha256)
      expect(calls[3].args.slice(-1)[0]).toBe(`${sourceCommit}:${HELPER_PATH}`)
      expect(calls[3].options.binary).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('requires the exact immutable base and builds only a deterministic local main-dev tag', () => {
    expect(assertBaseImageDigests(JSON.stringify([BASE_IMAGE_REF]))).toBe(BASE_IMAGE_REF)
    expect(() => assertBaseImageDigests(JSON.stringify(['zuri-ai-main-dev-genesis-worker:latest']))).toThrow(/BASE_DIGEST_MISMATCH/)

    const contextDir = 'C:/temporary/helper-context'
    const tag = `${CANDIDATE_TAG_PREFIX}${sourceCommit.slice(0, 8)}`
    const dockerArgs = buildDockerArgs({
      tag,
      configurationCommit,
      helperSourceCommit: sourceCommit,
      helperSha256: sourceSha256,
      contextDir,
    })
    const plan = buildPlan({ tag, configurationCommit, source: { commit: sourceCommit, sha256: sourceSha256 }, contextDir })
    expect(dockerArgs).toContain(`BASE_IMAGE=${BASE_IMAGE_REF}`)
    expect(dockerArgs).toContain(`helper-source=${contextDir}`)
    expect(dockerArgs).toContain(tag)
    expect(dockerArgs.join(' ')).not.toMatch(/compose|--push|push\s/)
    expect(plan).toMatchObject({ deploys: false, pushes: false, tag })
  })

  it('copies only the embedder helper and separate overlay receipt while preserving inherited runtime settings', () => {
    const commands = recipe.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#')).join('\n')
    const copyLines = commands.split('\n').filter((line) => /^COPY\s/.test(line.trim()))
    expect(commands).toContain(`ARG BASE_IMAGE=${BASE_IMAGE_REF}`)
    expect(commands).toContain('KI17_EMBEDDER_BASE_IMAGE_MISMATCH')
    expect(copyLines).toHaveLength(3)
    expect(copyLines[0]).toContain('COPY --from=helper-source /embedder.py /tmp/e5-helper-overlay/embedder.py')
    expect(copyLines[1]).toContain('COPY --from=helper-source /overlay-receipt.json /tmp/e5-helper-overlay/overlay-receipt.json')
    expect(copyLines[2]).toContain('check-embedder-overlay.mjs /tmp/e5-helper-overlay/check-embedder-overlay.mjs')
    expect(commands).toContain('/opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py')
    expect(commands).toContain(OVERLAY_RECEIPT_PATH)
    expect(commands).not.toMatch(/^\s*(?:ENV|CMD|ENTRYPOINT)\s/m)
    expect(commands).toContain('USER node')
    expect(checker).toContain('baseGenesisBlockCommit')
    expect(checker).toContain('BASE_IMAGE_REF')
  })
})
