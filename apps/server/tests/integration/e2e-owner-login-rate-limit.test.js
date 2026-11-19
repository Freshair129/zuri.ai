import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { consumeLoginRateLimits, passwordLoginRateLimitKeys, passkeyLoginRateLimitKeys, totpVerificationRateLimitKey } from '@/modules/identity/rate-limit'

// @req FR-046, FR-296 — fixture isolation must not disable the persisted limiter.
// @spec ADR-017, SEC-008, SEC-026
// @tested tests/integration/e2e-owner-login-rate-limit.test.js
const require = createRequire(import.meta.url)
const { ownerLoginBucketFilter, createOwnerLoginIsolation } = require('../e2e/owner-login-isolation.cjs')
const created = new Set()
const headers = new Headers()
const now = new Date('2026-11-17T00:00:00Z')

async function seedBucket(key, count) {
  created.add(key)
  await prisma.rateLimitBucket.create({ data: { key, count, windowStart: now } })
}

afterEach(async () => {
  if (created.size) await prisma.rateLimitBucket.deleteMany({ where: { key: { in: [...created] } } })
  created.clear()
})

it('prepares fresh fixtures while repeated attempts in the same context remain limited', async () => {
  const username = `e2e-owner-${randomUUID()}@example.test`
  const key = passwordLoginRateLimitKeys(username, headers).identifier
  await seedBucket(key, 50)
  const attempt = () => consumeLoginRateLimits({ username, headers, db: prisma, now: () => now })
  await expect(attempt()).rejects.toMatchObject({ status: 429 })

  const prepare = createOwnerLoginIsolation(async (identity) => {
    // The shared integration database is not the E2E fixture database. Limit this
    // probe to rows this test owns, including the preservation controls below.
    await prisma.rateLimitBucket.deleteMany({ where: { AND: [
      ownerLoginBucketFilter(identity), { key: { in: [...created] } },
    ] } })
  })
  const context = {}
  await prepare(context, username)
  await attempt()
  expect((await prisma.rateLimitBucket.findUnique({ where: { key } })).count).toBe(1)

  await prisma.rateLimitBucket.update({ where: { key }, data: { count: 50 } })
  await prepare(context, username)
  await expect(attempt()).rejects.toMatchObject({ status: 429 })
  await prepare({}, username)
  await attempt()
  expect((await prisma.rateLimitBucket.findUnique({ where: { key } })).count).toBe(1)
})

it('preserves other identifiers, non-loopback address buckets, MFA and passkey budgets', async () => {
  const owner = `e2e-owner-${randomUUID()}@example.test`
  const other = `other-${randomUUID()}@example.test`
  const address = `2001:db8:${randomUUID().replace(/-/g, '').slice(0, 24).match(/.{4}/g).join(':')}`
  const ownerKey = passwordLoginRateLimitKeys(owner, headers).identifier
  const controls = [
    passwordLoginRateLimitKeys(other, headers).identifier,
    passwordLoginRateLimitKeys(other, new Headers({ 'x-forwarded-for': address }), {}).identifierAddress,
    passwordLoginRateLimitKeys(owner, new Headers({ 'x-forwarded-for': address }), {}).address,
    totpVerificationRateLimitKey(randomUUID()),
    passkeyLoginRateLimitKeys(randomUUID(), headers, {}).identifier,
  ]
  for (const key of [ownerKey, ...controls]) await seedBucket(key, 7)
  await prisma.rateLimitBucket.deleteMany({ where: { AND: [
    ownerLoginBucketFilter(owner), { key: { in: [...created] } },
  ] } })
  expect(await prisma.rateLimitBucket.findUnique({ where: { key: ownerKey } })).toBeNull()
  for (const key of controls) expect((await prisma.rateLimitBucket.findUnique({ where: { key } })).count).toBe(7)
})

it('matches the current production key derivation without broad-prefix deletion', () => {
  const username = `e2e-owner-${randomUUID()}@example.test`
  const filter = ownerLoginBucketFilter(` ${username.toUpperCase()} `)
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const keys = passwordLoginRateLimitKeys(username, new Headers({ 'x-forwarded-for': address }), {})
    expect(filter.OR[0].key).toBe(keys.identifier)
    expect(keys.identifierAddress.startsWith(filter.OR[1].key.startsWith)).toBe(true)
    expect(filter.OR[2].key.in).toContain(keys.address)
  }
})
