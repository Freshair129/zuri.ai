// @req FR-220 — the harness credential: minted once for the approving person with
//   the report scope, ACTIVE only when an operator approved it, authenticated by
//   hash, refused when revoked or malformed, activated or revoked only by an
//   operator with a version check, and never returned as key material after mint.
// @spec ADR-087 D2, D3; SEC-025
// @tested tests/unit/harness-credential.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  authenticateHarnessCredential,
  decideHarnessCredential,
  describeHarnessReporters,
  listHarnessCredentials,
  looksLikeHarnessCredential,
  mayApproveHarnessPairing,
  mintHarnessCredential,
} from '@/modules/identity/harness-credential'
import { makeViewer } from '../factories/viewer.js'

function fakeDb() {
  const rows = []
  const audits = []
  const db = {
    harnessCredential: {
      create: vi.fn(async ({ data }) => { const row = { id: `hc-${rows.length + 1}`, installationId: `inst-${rows.length + 1}`, createdAt: new Date(), version: 1, lastUsedAt: null, revokedAt: null, ...data }; rows.push(row); return row }),
      findUnique: vi.fn(async ({ where }) => rows.find((r) => (where.id ? r.id === where.id : r.keyHash === where.keyHash)) || null),
      findMany: vi.fn(async ({ where } = {}) => (where?.installationId ? rows.filter((r) => where.installationId.in.includes(r.installationId)) : rows)),
      update: vi.fn(async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id)
        for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v
        return row
      }),
    },
    person: {
      findUnique: vi.fn(async () => ({ displayName: 'Ploy' })),
      findMany: vi.fn(async () => [{ id: 'per-1', displayName: 'Ploy' }]),
    },
    auditEvent: { create: vi.fn(async ({ data }) => { audits.push(data); return data }) },
  }
  return { db, rows, audits }
}

const member = makeViewer({ role: 'MEMBER', visibleBusinessIds: ['b-1'], principal: { id: 'per-1', code: 'PER-1', displayName: 'Ploy' } })
const operator = makeViewer({ role: 'DEV', principal: { id: 'per-op', code: 'PER-OP', displayName: 'Owen' } })

describe('FR-220 harness credential', () => {
  it('lets an operator or a person with a visible Business approve, never a bare signup', () => {
    expect(mayApproveHarnessPairing(member)).toBe(true)
    expect(mayApproveHarnessPairing(operator)).toBe(true)
    expect(mayApproveHarnessPairing(makeViewer({ role: 'MEMBER', visibleBusinessIds: [] }))).toBe(false)
    expect(mayApproveHarnessPairing(null)).toBe(false)
  })

  it('mints once for the approving person: hashed, prefixed, report-scoped, pending unless an operator approved', async () => {
    const { db, rows, audits } = fakeDb()
    const { key, credential } = await mintHarnessCredential({ viewer: member, harness: 'CLAUDE_CODE', deviceLabel: 'DESKTOP-VETATMQ', osUser: 'pc', db })
    expect(key).toMatch(/^hrnk_[\w-]{43}$/)
    expect(rows[0]).toMatchObject({ personId: 'per-1', scope: 'PROGRAMME_USAGE_REPORT', status: 'PENDING_ACTIVATION', deviceLabel: 'DESKTOP-VETATMQ', osUser: 'pc' })
    expect(rows[0].keyHash).not.toContain(key)
    expect(key.startsWith(rows[0].keyPrefix)).toBe(true)
    expect(credential).not.toHaveProperty('keyHash')
    expect(JSON.stringify(audits)).not.toContain(key)
    const byOperator = await mintHarnessCredential({ viewer: operator, harness: 'CODEX', deviceLabel: 'ci-box', db })
    expect(byOperator.credential.status).toBe('ACTIVE')
  })

  it('authenticates by hash, refuses a revoked, unknown or malformed key, and records last use', async () => {
    const { db } = fakeDb()
    const { key } = await mintHarnessCredential({ viewer: operator, harness: 'CODEX', deviceLabel: 'ci-box', db })
    const found = await authenticateHarnessCredential({ authorization: `Bearer ${key}`, db })
    expect(found).toMatchObject({ status: 'ACTIVE', personDisplayName: 'Ploy', installationId: 'inst-1' })
    expect(db.harnessCredential.update).toHaveBeenCalled()
    expect(await authenticateHarnessCredential({ authorization: `Bearer hrnk_${'z'.repeat(43)}`, db })).toBeNull()
    expect(await authenticateHarnessCredential({ authorization: key, db })).toBeNull()
    expect(looksLikeHarnessCredential(`Bearer ${key}`)).toBe(true)
    expect(looksLikeHarnessCredential(`Bearer ${'x'.repeat(40)}`)).toBe(false)
    await decideHarnessCredential({ viewer: operator, id: 'hc-1', action: 'revoke', version: 1, db })
    expect(await authenticateHarnessCredential({ authorization: `Bearer ${key}`, db })).toBeNull()
  })

  it('lets only an operator list, activate and revoke, with a version check', async () => {
    const { db, audits } = fakeDb()
    await mintHarnessCredential({ viewer: member, harness: 'CLAUDE_CODE', deviceLabel: 'laptop', db })
    await expect(listHarnessCredentials({ viewer: member, db })).rejects.toMatchObject({ status: 404 })
    await expect(decideHarnessCredential({ viewer: member, id: 'hc-1', action: 'activate', version: 1, db })).rejects.toMatchObject({ status: 404 })
    const { devices } = await listHarnessCredentials({ viewer: operator, db })
    expect(devices[0]).toMatchObject({ personDisplayName: 'Ploy', status: 'PENDING_ACTIVATION' })
    expect(devices[0]).not.toHaveProperty('keyHash')
    await expect(decideHarnessCredential({ viewer: operator, id: 'hc-1', action: 'activate', version: 9, db })).rejects.toMatchObject({ status: 409 })
    const activated = await decideHarnessCredential({ viewer: operator, id: 'hc-1', action: 'activate', version: 1, db })
    expect(activated.device.status).toBe('ACTIVE')
    await expect(decideHarnessCredential({ viewer: operator, id: 'hc-1', action: 'activate', version: 2, db })).rejects.toMatchObject({ message: 'HARNESS_DEVICE_NOT_PENDING' })
    expect(audits.map((a) => a.action)).toEqual(['MINTED', 'ACTIVATED'])
  })

  it('describes reporters without key material, and answers nothing when the table is absent', async () => {
    const { db } = fakeDb()
    await mintHarnessCredential({ viewer: member, harness: 'CODEX', deviceLabel: 'laptop', db })
    expect(await describeHarnessReporters({ installationIds: ['inst-1', null], db })).toEqual({ 'inst-1': { deviceLabel: 'laptop', harness: 'CODEX', personDisplayName: 'Ploy' } })
    const broken = { harnessCredential: { findMany: vi.fn(async () => { throw new Error('relation does not exist') }) } }
    expect(await describeHarnessReporters({ installationIds: ['inst-1'], db: broken })).toEqual({})
  })
})

describe('FR-220 routes', () => {
  const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
  it('keeps approve behind a browser viewer, poll behind the device secret, devices behind the operator, and whoami on the credential', () => {
    expect(read('src/app/api/platform/harness-pairing/approve/route.js')).toMatch(/resolveRequestViewer[\s\S]*browser: true/)
    expect(read('src/app/api/platform/harness-pairing/poll/route.js')).toMatch(/Bearer \(\[\\w-\]\{43\}\)/)
    expect(read('src/app/api/platform/harness-pairing/start/route.js')).not.toMatch(/mintHarnessCredential|resolveRequestViewer/)
    expect(read('src/app/api/platform/harness-devices/route.js')).toMatch(/resolveRequestViewer[\s\S]*listHarnessCredentials/)
    expect(read('src/app/api/platform/harness-devices/[id]/route.js')).toMatch(/export async function PATCH/)
    const whoami = read('src/app/api/platform/programme-usage-reports/whoami/route.js')
    expect(whoami).toMatch(/authenticateHarnessCredential/)
    expect(whoami).not.toMatch(/keyHash|keyPrefix|personId/)
    // The credential is never a viewer: identity's session resolver does not know it.
    expect(read('src/modules/identity/request-viewer.js')).not.toMatch(/hrnk|harness/i)
  })
})
