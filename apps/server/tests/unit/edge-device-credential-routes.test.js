// @req FR-144 — what the credential routes are, in source terms.
// @spec SEC-025, SEC-001, SEC-008
// @tested tests/unit/edge-device-credential-routes.test.js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative) => readFileSync(path.join(process.cwd(), relative), 'utf8')

const COLLECTION = 'src/app/api/platform/edge-devices/credentials/route.js'
const ITEM = 'src/app/api/platform/edge-devices/credentials/[id]/route.js'
const EDGE_ROUTES = [
  'src/app/api/edge/extraction-jobs/claim/route.js',
  'src/app/api/edge/extraction-jobs/[id]/complete/route.js',
  'src/app/api/edge/extraction-jobs/[id]/fail/route.js',
  'src/app/api/edge/extraction-jobs/[id]/evidence/route.js',
]

describe('FR-144 credential route contract', () => {
  it('mints and lists on the collection, revokes on the item', () => {
    const collection = read(COLLECTION)
    expect(collection).toMatch(/export async function GET/)
    expect(collection).toMatch(/export async function POST/)
    expect(collection).not.toMatch(/export async function DELETE/)
    expect(read(ITEM)).toMatch(/export async function DELETE/)
  })

  it('resolves a browser viewer on every operator-facing method', () => {
    // These three are governed by a person, not a device: an owner pairs the
    // device. The device's own routes are the ones that must NOT read a session.
    for (const file of [COLLECTION, ITEM]) {
      expect(read(file)).toMatch(/resolveRequestViewer/)
      expect(read(file)).not.toMatch(/resolveEdgeDeviceContext/)
    }
  })

  it('device routes authenticate as a device and never as a person', () => {
    for (const file of EDGE_ROUTES) {
      const source = read(file)
      expect(source).toMatch(/resolveEdgeDeviceContext/)
      expect(source).not.toMatch(/resolveRequestViewer/)
      // Every one refuses without a credential rather than falling through.
      expect(source).toMatch(/401/)
    }
  })

  it('the claim route answers an empty queue with 204 and takes no body', () => {
    const source = read('src/app/api/edge/extraction-jobs/claim/route.js')
    expect(source).toMatch(/status: 204/)
    expect(source).toMatch(/takes no body/)
  })

  it('the evidence route serves bytes and names no storage location', () => {
    const source = read('src/app/api/edge/extraction-jobs/[id]/evidence/route.js')
    expect(source).toMatch(/Content-Type/)
    expect(source).toMatch(/no-store/)
    // ADR-041 D3 — the cloud serves the object; it never hands out a way to fetch it.
    expect(source).not.toMatch(/signedUrl|createSignedUrl|publicUrl/)
  })
})
