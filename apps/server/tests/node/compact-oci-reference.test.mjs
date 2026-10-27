// @spec ADR-115 — selected immutable image references must survive OCI import.
// @tested tests/node/compact-oci-reference.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { manifest, ociLayout } from './compact-fixtures.mjs'
import { verifyOciLayout } from '../../scripts/lib/compact/oci-layout.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compact-oci-reference-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = path.join(root, 'layout'), m = manifest()
  const data = await ociLayout(layout, m)
  return { layout, images: m.images, data }
}

async function editIndex(layout, edit) {
  const file = path.join(layout, 'index.json')
  const index = JSON.parse(await readFile(file, 'utf8'))
  edit(index)
  await writeFile(file, JSON.stringify(index))
}

test('rejects a digest-correct OCI layout without a named descriptor for every selected repository reference', async t => {
  const { layout, images } = await fixture(t)
  await editIndex(layout, index => {
    index.manifests = [index.manifests[0]]
    delete index.manifests[0].annotations
  })
  await assert.rejects(verifyOciLayout(layout, images), { code: 'COMPACT_OCI_INVALID' })
})

test('rejects a digest-correct root descriptor that names an unselected repository', async t => {
  const { layout, images, data } = await fixture(t)
  await editIndex(layout, index => {
    index.manifests[0].annotations = {
      'io.containerd.image.name': `foreign/image@sha256:${data.imageDigest}`,
    }
  })
  await assert.rejects(verifyOciLayout(layout, images), { code: 'COMPACT_OCI_INVALID' })
})

test('accepts an exact containerd image name for every selected repository when all share one digest', async t => {
  const { layout, images } = await fixture(t)
  const references = [...new Set(Object.values(images))].sort()
  await editIndex(layout, index => {
    const descriptor = index.manifests[0]
    index.manifests = references.map(reference => ({
      ...descriptor,
      annotations: { 'io.containerd.image.name': reference },
    }))
  })
  await verifyOciLayout(layout, images)
})

test('accepts a valid full immutable OCI ref.name when no containerd image name is present', async t => {
  const { layout, images } = await fixture(t)
  const references = [...new Set(Object.values(images))].sort()
  await editIndex(layout, index => {
    const descriptor = index.manifests[0]
    index.manifests = references.map(reference => ({
      ...descriptor,
      annotations: { 'org.opencontainers.image.ref.name': reference },
    }))
  })
  await verifyOciLayout(layout, images)
})

test('preserves an OCI tag ref.name when the exact containerd image name is present', async t => {
  const { layout, images } = await fixture(t)
  const reference = Object.values(images)[0]
  await editIndex(layout, index => {
    index.manifests = [{
      ...index.manifests[0],
      annotations: {
        'io.containerd.image.name': reference,
        'org.opencontainers.image.ref.name': 'v1.0.0',
      },
    }]
  })
  await verifyOciLayout(layout, { web: reference })
})

test('rejects a tag-only descriptor because it does not identify the selected immutable image reference', async t => {
  const { layout, images } = await fixture(t)
  await editIndex(layout, index => {
    index.manifests = [{
      ...index.manifests[0],
      annotations: { 'org.opencontainers.image.ref.name': 'latest' },
    }]
  })
  await assert.rejects(verifyOciLayout(layout, { web: Object.values(images)[0] }), { code: 'COMPACT_OCI_INVALID' })
})

test('rejects a foreign immutable OCI ref.name even beside an exact containerd image name', async t => {
  const { layout, images, data } = await fixture(t)
  const reference = Object.values(images)[0]
  await editIndex(layout, index => {
    index.manifests = [{
      ...index.manifests[0],
      annotations: {
        'io.containerd.image.name': reference,
        'org.opencontainers.image.ref.name': `foreign/image@sha256:${data.imageDigest}`,
      },
    }]
  })
  await assert.rejects(verifyOciLayout(layout, { web: reference }), { code: 'COMPACT_OCI_INVALID' })
})

test('rejects selected names mapped to the other valid manifest digest', async t => {
  const { layout, images, data } = await fixture(t)
  const second = Buffer.from(JSON.stringify({
    ...JSON.parse(data.image.toString('utf8')),
    annotations: { 'com.example.build': 'second' },
  }))
  const secondDigest = createHash('sha256').update(second).digest('hex')
  await writeFile(path.join(layout, 'blobs/sha256', secondDigest), second)
  const web = Object.values(images)[0], tools = `test/tools@sha256:${secondDigest}`
  await editIndex(layout, index => {
    const first = index.manifests[0]
    const secondDescriptor = { ...first, digest: `sha256:${secondDigest}`, size: second.length }
    index.manifests = [
      { ...first, annotations: { 'io.containerd.image.name': tools } },
      { ...secondDescriptor, annotations: { 'io.containerd.image.name': web } },
    ]
  })
  await assert.rejects(verifyOciLayout(layout, { web, tools }), { code: 'COMPACT_OCI_INVALID' })
})
