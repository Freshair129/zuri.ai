import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
  validateOverlay,
} from '../../deploy/ki17/overlay/check-embedder-overlay.mjs'
import {
  assertBaseImageDigests,
  assertSourceDescriptor,
  buildDockerArgs,
  buildPlan,
  extractDockerOciArchive,
  ociLayoutContextUri,
  ociLayoutContextUriFromAbsolutePath,
  validateLocalOciLayout,
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

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function descriptor(bytes, mediaType) {
  return { mediaType, digest: digest(bytes), size: bytes.length }
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`
}

function tarEntry(name, content = Buffer.alloc(0), type = '0') {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(octal(content.length, 12), 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header[156] = type.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padding = Buffer.alloc((512 - content.length % 512) % 512)
  return [header, content, padding]
}

function makeOciArchive(tempDir, { tamperBlob = false } = {}) {
  const layerBytes = Buffer.from('offline-image-layer-fixture')
  const diffId = digest(Buffer.from('unpacked-rootfs-layer-fixture'))
  const configBytes = Buffer.from(JSON.stringify({
    os: 'linux',
    architecture: 'amd64',
    config: { Cmd: ['node', 'worker.js'], User: 'node' },
    rootfs: { type: 'layers', diff_ids: [diffId] },
  }))
  const layerDescriptor = descriptor(layerBytes, 'application/vnd.oci.image.layer.v1.tar+gzip')
  const configDescriptor = descriptor(configBytes, 'application/vnd.oci.image.config.v1+json')
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: configDescriptor,
    layers: [layerDescriptor],
  }))
  const childIndexBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [{
      ...descriptor(manifestBytes, 'application/vnd.oci.image.manifest.v1+json'),
      platform: { os: 'linux', architecture: 'amd64' },
    }],
  }))
  const childIndexDescriptor = descriptor(childIndexBytes, 'application/vnd.oci.image.index.v1+json')
  const rootIndexBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [childIndexDescriptor],
  }))
  const imageRef = `fixture.invalid/ki17-base@${digest(rootIndexBytes)}`
  const indexBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [descriptor(rootIndexBytes, 'application/vnd.oci.image.index.v1+json')],
  }))
  const blobs = new Map([
    [rootIndexBytes, digest(rootIndexBytes)],
    [childIndexBytes, digest(childIndexBytes)],
    [manifestBytes, digest(manifestBytes)],
    [configBytes, digest(configBytes)],
    [layerBytes, digest(layerBytes)],
  ])
  const entries = [
    tarEntry('blobs/', Buffer.alloc(0), '5'),
    tarEntry('blobs/sha256/', Buffer.alloc(0), '5'),
    tarEntry('oci-layout', Buffer.from('{"imageLayoutVersion":"1.0.0"}')),
    tarEntry('index.json', indexBytes),
  ]
  for (const [bytes, blobDigest] of blobs) {
    const data = tamperBlob && blobDigest === layerDescriptor.digest ? Buffer.from('tampered-image-layer') : bytes
    entries.push(tarEntry(`blobs/sha256/${blobDigest.slice('sha256:'.length)}`, data))
  }
  entries.push(tarEntry('manifest.json', Buffer.from('[]')))
  const archivePath = path.join(tempDir, 'docker-image.tar')
  writeFileSync(archivePath, Buffer.concat([...entries.flat(), Buffer.alloc(1024)]))
  return {
    archivePath,
    imageRef,
    imageInfo: {
      imageId: digest(rootIndexBytes),
      os: 'linux',
      architecture: 'amd64',
      platform: 'linux/amd64',
      rootFsLayers: [diffId],
      repoDigests: [imageRef],
      config: { Cmd: ['node', 'worker.js'], User: 'node' },
    },
    expected: {
      indexDigest: digest(rootIndexBytes),
      daemonImageId: digest(rootIndexBytes),
      manifestDigest: digest(manifestBytes),
      configDigest: digest(configBytes),
      platform: 'linux/amd64',
      layerDigests: [layerDescriptor.digest],
      rootFsDiffIds: [diffId],
    },
  }
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
      localOciLayout: {
        indexDigest: BASE_IMAGE_DIGEST,
        daemonImageId: BASE_IMAGE_DIGEST,
        manifestDigest: `sha256:${'1'.repeat(64)}`,
        configDigest: `sha256:${'2'.repeat(64)}`,
        platform: 'linux/amd64',
        layerDigests: [`sha256:${'3'.repeat(64)}`],
        rootFsDiffIds: [`sha256:${'4'.repeat(64)}`],
      },
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
    const changedLayoutReceipt = { ...receipt, base: { ...receipt.base, localOciLayout: { ...receipt.base.localOciLayout, indexDigest: `sha256:${'f'.repeat(64)}` } } }
    expect(() => validateOverlay({
      phase: 'after', receipt: changedLayoutReceipt, pinsBytes: artifacts.pinsBytes,
      resolvedBytes: artifacts.resolvedBytes, currentHelperBytes: sourceBytes,
    })).toThrow(/BASE_LAYOUT_MISMATCH/)

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
    const baseLayoutDir = 'C:/temporary/base layout'
    const tag = `${CANDIDATE_TAG_PREFIX}${sourceCommit.slice(0, 8)}`
    const dockerArgs = buildDockerArgs({
      tag,
      configurationCommit,
      helperSourceCommit: sourceCommit,
      helperSha256: sourceSha256,
      contextDir,
      baseLayoutDir,
    })
    const plan = buildPlan({ tag, configurationCommit, source: { commit: sourceCommit, sha256: sourceSha256 }, contextDir, baseLayoutDir })
    expect(dockerArgs).toContain(`BASE_IMAGE=${BASE_IMAGE_REF}`)
    expect(dockerArgs).toContain(`helper-source=${contextDir}`)
    expect(dockerArgs).toContain(`base-image=${ociLayoutContextUri(baseLayoutDir, BASE_IMAGE_DIGEST)}`)
    expect(dockerArgs).toContain('--platform=linux/amd64')
    expect(ociLayoutContextUri(baseLayoutDir, BASE_IMAGE_DIGEST)).toContain('@sha256:9bee2c31dc0efee6f2564eab273f9c815961a1635c08a29805849524974163e7')
    expect(ociLayoutContextUri(baseLayoutDir, BASE_IMAGE_DIGEST)).not.toContain('zuri-ai-main-dev-genesis-worker:')
    expect(dockerArgs).toContain(tag)
    expect(dockerArgs.join(' ')).not.toMatch(/compose|--push|push\s/)
    expect(plan).toMatchObject({ deploys: false, pushes: false, tag })
  })

  it('formats local OCI contexts for Buildx Windows and POSIX path parsing without escaping filesystem paths', () => {
    const digest = BASE_IMAGE_DIGEST
    const windowsUri = ociLayoutContextUriFromAbsolutePath('C:/Users/test user/AppData/Local/Temp/base layout', digest)
    const windowsPath = windowsUri.slice('oci-layout://'.length).split('@')[0]
    expect(windowsUri).toBe(`oci-layout://C:/Users/test user/AppData/Local/Temp/base layout@${digest}`)
    expect(windowsPath).toBe('C:/Users/test user/AppData/Local/Temp/base layout')
    expect(windowsPath.indexOf(':')).toBe(1)
    expect(windowsPath[2]).toBe('/')
    expect(windowsUri).not.toContain('%20')

    const posixUri = ociLayoutContextUriFromAbsolutePath('/tmp/test user/base layout', digest)
    expect(posixUri).toBe(`oci-layout:///tmp/test user/base layout@${digest}`)
    expect(() => ociLayoutContextUriFromAbsolutePath('relative/base-layout', digest)).toThrow(/BASE_LAYOUT_INVALID/)
  })

  it('extracts the daemon-saved OCI layout only when the pinned digest, every blob, and inspected platform agree', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ki17-oci-extract-test-'))
    try {
      const fixture = makeOciArchive(tempDir)
      const layoutDir = path.join(tempDir, 'layout')
      const extracted = extractDockerOciArchive(fixture.archivePath, layoutDir, fixture)
      expect(extracted).toEqual(fixture.expected)
      expect(validateLocalOciLayout(layoutDir, fixture)).toEqual(fixture.expected)

      expect(() => validateLocalOciLayout(layoutDir, {
        ...fixture,
        imageInfo: { ...fixture.imageInfo, config: { Cmd: ['node', 'other.js'], User: 'node' } },
      })).toThrow(/BASE_LAYOUT_CONFIG_MISMATCH/)
      expect(() => validateLocalOciLayout(layoutDir, {
        ...fixture,
        imageInfo: { ...fixture.imageInfo, imageId: `sha256:${'f'.repeat(64)}` },
      })).toThrow(/BASE_IMAGE_ID_MISMATCH/)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects a Docker image archive with an altered blob or a different root digest', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ki17-oci-reject-test-'))
    try {
      const tampered = makeOciArchive(tempDir, { tamperBlob: true })
      expect(() => extractDockerOciArchive(tampered.archivePath, path.join(tempDir, 'tampered-layout'), tampered)).toThrow(/BASE_ARCHIVE_BLOB_MISMATCH/)

      const valid = makeOciArchive(tempDir)
      const wrongImageRef = `fixture.invalid/ki17-base@sha256:${'f'.repeat(64)}`
      expect(() => extractDockerOciArchive(valid.archivePath, path.join(tempDir, 'wrong-root-layout'), {
        ...valid,
        imageRef: wrongImageRef,
        imageInfo: { ...valid.imageInfo, imageId: `sha256:${'f'.repeat(64)}`, repoDigests: [wrongImageRef] },
      })).toThrow(/BASE_LAYOUT_DIGEST_MISMATCH/)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('copies only the embedder helper and separate overlay receipt while preserving inherited runtime settings', () => {
    const commands = recipe.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#')).join('\n')
    const copyLines = commands.split('\n').filter((line) => /^COPY\s/.test(line.trim()))
    expect(recipe).not.toMatch(/^\s*#\s*syntax=/m)
    expect(commands).toContain('FROM base-image')
    expect(commands).toContain(`ARG BASE_IMAGE=${BASE_IMAGE_REF}`)
    expect(commands).not.toMatch(/^FROM .*zuri-ai-main-dev-genesis-worker@/m)
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
