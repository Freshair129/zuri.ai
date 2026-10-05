// @req FR-281, FR-282, FR-283 — actual migrated SQLite / Prisma 5.22 multi-client QA.
// Runs only with explicitly prepared test-owned baseline/client; never ambient DB.
import { afterAll, describe, expect, test, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { receiveMarketingReport, receiverRetryable } from '@/modules/marketing/application/marketing-report-receiver'
import { canonicalReportText, reportHash } from '@/modules/marketing/application/marketing-report-wire'
import { setMarketingReportPolicy, createMarketingReportBinding, revokeMarketingReportBinding } from '@/modules/marketing/application/marketing-report-operator'
import { assertMarketingReportBackupSafe } from '@/modules/marketing/application/marketing-report-backup'
import { readMarketingExternalReport } from '@/modules/marketing/application/marketing-report-read'
import { extractSnapshot, exportSnapshot, previewSnapshot, validateSnapshotRecovery, previewImport, importSnapshot } from '@/modules/project-manager/application/backup-service'
import { POST } from '@/app/api/growth/external-marketing-reports/route'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { createSessionPort } from '@/modules/identity/session-port'
import { makeViewer } from '../factories/viewer'

const routeDatabase = vi.hoisted(() => ({ db: null, calls: 0 }))
vi.mock('@/lib/db', () => ({ default: {}, prisma: {} }))
vi.mock('@/modules/marketing/infrastructure/marketing-report-database', () => ({ marketingReportDatabase: () => { routeDatabase.calls++; return routeDatabase.db } }))

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')
const qa = process.env.ZURI_REPORT_QA_HOME, clientPath = process.env.ZURI_REPORT_QA_CLIENT
const configured = Boolean(qa && clientPath)
if ((qa || clientPath) && (!configured || !resolve(qa).includes('p3-receiver-native-qa'))) throw new Error('ISOLATED_MARKETING_REPORT_QA_REQUIRED')
const below = path => { const relation = relative(resolve(qa), resolve(path)); if (relation.startsWith('..') || isAbsolute(relation)) throw new Error('QA_PATH_ESCAPE'); return resolve(path) }
const { PrismaClient } = configured ? require(below(clientPath)) : { PrismaClient: null }
const golden = JSON.parse(readFileSync(new URL('../fixtures/marketing-report/go-v01.json', import.meta.url)))
const operator = makeViewer({ role: 'DEV', visibleBusinessIds: [], visibleDomains: [], principal: null })
const clients = []
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function database() {
  mkdirSync(qa, { recursive: true })
  const file = below(resolve(qa, 'marketing-report-' + randomUUID() + '.sqlite')), sql = new DatabaseSync(file)
  sql.exec('BEGIN;')
  sql.exec(readFileSync(below(resolve(qa, 'base.sql')), 'utf8'))
  sql.exec(readFileSync(new URL('../../prisma/migrations/20261005120000_marketing_external_report/migration.sql', import.meta.url), 'utf8'))
  sql.exec('COMMIT;'); sql.close()
  const url = 'file:' + file.replaceAll('\\', '/') + '?socket_timeout=1&connection_limit=1'
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] })
  const second = new PrismaClient({ datasources: { db: { url } }, log: [] })
  clients.push(db, second)
  return { db, second, file }
}
async function fixture() {
  const instance = database(), { db } = instance
  await db.$connect(); await instance.second.$connect()
  const portfolio = await db.portfolio.create({ data: { code: randomUUID(), name: 'Synthetic QA' } })
  const tenant = await db.tenant.create({ data: { code: randomUUID(), name: 'Synthetic QA', portfolioId: portfolio.id } })
  const business = await db.business.create({ data: { code: randomUUID(), name: 'Synthetic QA', tenantId: tenant.id } })
  const plan = await db.marketingPlan.create({ data: { tenantId: tenant.id, businessId: business.id, code: 'QA', title: 'Synthetic QA', createdBy: 'qa' } })
  const initiative = await db.marketingInitiative.create({ data: { tenantId: tenant.id, businessId: business.id, planId: plan.id, code: 'QA', createdBy: 'qa' } })
  await setMarketingReportPolicy({ db, viewer: operator, businessId: business.id, expectedVersion: 0, ingestEnabled: false })
  const { binding, credential } = await createMarketingReportBinding({ db, viewer: operator, businessId: business.id, sourceDeploymentId: golden.source.deploymentId, sourceBusinessId: golden.source.sourceBusinessId })
  const envelope = structuredClone(golden); envelope.target = { bindingId: binding.id, initiativeId: initiative.id }
  const bytes = encode(envelope), authorization = 'Bearer ' + credential
  return { ...instance, business, tenant, plan, initiative, binding, credential, bytes, authorization }
}
function encode(value) { const { payloadHash, ...content } = value; return canonicalReportText({ ...content, payloadHash: reportHash(content) }) }
const enable = f => setMarketingReportPolicy({ db: f.db, viewer: operator, businessId: f.business.id, expectedVersion: 1, ingestEnabled: true })
const ingest = (f, db = f.db, bytes = f.bytes) => receiveMarketingReport({ db, authorization: f.authorization, raw: bytes })
const acceptedAudits = db => db.auditEvent.count({ where: { action: 'REPORTED_EVIDENCE_ACCEPTED' } })
async function nativeSnapshot(db) {
  return db.$transaction(async tx => {
    const tables = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    const rows = {}
    for (const { name } of tables) {
      if (['MarketingReportPolicy', 'MarketingReportBinding', 'MarketingExternalReport', 'AuditEvent'].includes(name)) continue
      rows[name] = await tx.$queryRawUnsafe('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
    }
    return JSON.stringify(rows, (_, value) => typeof value === 'bigint' ? value.toString() : value)
  }, { timeout: 20000 })
}
afterAll(async () => { await Promise.all(clients.map(client => client.$disconnect())) })

describe.skipIf(!configured)('native external report custody (NOT_RUN without explicit isolated QA)', () => {
  test('deny default, trusted operator CAS, one durable report/audit and identical receipt replay', async () => {
    const f = await fixture()
    await expect(ingest(f)).rejects.toMatchObject({ status: 404 })
    const owner = makeViewer({ visibleBusinessIds: [f.business.id], ownedBusinessIds: [f.business.id], visibleDomains: ['growth'] })
    await expect(setMarketingReportPolicy({ db: f.db, viewer: owner, businessId: f.business.id, expectedVersion: 1, ingestEnabled: true })).rejects.toMatchObject({ status: 403 })
    await enable(f)
    await expect(setMarketingReportPolicy({ db: f.db, viewer: operator, businessId: f.business.id, expectedVersion: 1, ingestEnabled: false })).rejects.toMatchObject({ status: 409 })
    const first = await ingest(f), replay = await ingest(f, f.second)
    expect(first.status).toBe(201); expect(replay).toEqual({ status: 200, receipt: first.receipt })
    expect(await f.db.marketingExternalReport.count()).toBe(1); expect(await acceptedAudits(f.db)).toBe(1)
    const stored = await f.db.marketingExternalReport.findFirst()
    expect(stored.canonicalEnvelope).toBe(f.bytes); expect(stored.retainUntil.getTime() - stored.acceptedAt.getTime()).toBe(90 * 86400000)
    expect(await f.db.person.count()).toBe(0)
    expect(await f.db.marketingPlan.count()).toBe(1); expect(await f.db.marketingInitiative.count()).toBe(1)
    expect(await f.db.marketingPlanVersion.count()).toBe(0); expect(await f.db.marketingReview.count()).toBe(0); expect(await f.db.marketingDecision.count()).toBe(0)
    const audits = await f.db.auditEvent.findMany(); expect(JSON.stringify(audits)).not.toContain(f.credential)
    expect(JSON.stringify(audits)).not.toContain((await f.db.marketingReportBinding.findFirst()).keyHash)
    const changed = JSON.parse(f.bytes); changed.campaign.lifecycle = 'paused'
    await expect(ingest(f, f.db, encode(changed))).rejects.toMatchObject({ status: 409 })
    expect(await f.db.marketingExternalReport.count()).toBe(1); expect(await acceptedAudits(f.db)).toBe(1)
  })
  test('policy disable, revoked key and current native target state deny even identical replay', async () => {
    const f = await fixture(); await enable(f); await ingest(f)
    await setMarketingReportPolicy({ db: f.db, viewer: operator, businessId: f.business.id, expectedVersion: 2, ingestEnabled: false })
    await expect(ingest(f)).rejects.toMatchObject({ status: 404 })
    await setMarketingReportPolicy({ db: f.db, viewer: operator, businessId: f.business.id, expectedVersion: 3, ingestEnabled: true })
    await f.db.marketingInitiative.update({ where: { id: f.initiative.id }, data: { status: 'CLOSED', closureReason: 'synthetic QA' } })
    await expect(ingest(f)).rejects.toMatchObject({ status: 404 })
    await f.db.marketingInitiative.update({ where: { id: f.initiative.id }, data: { status: 'OPEN' } })
    await f.db.business.update({ where: { id: f.business.id }, data: { status: 'INACTIVE' } })
    await expect(ingest(f)).rejects.toMatchObject({ status: 404 })
    await f.db.business.update({ where: { id: f.business.id }, data: { status: 'ACTIVE' } })
    await revokeMarketingReportBinding({ db: f.db, viewer: operator, bindingId: f.binding.id, expectedVersion: 1 })
    await expect(ingest(f)).rejects.toMatchObject({ status: 401 })
    expect(await f.db.marketingExternalReport.count()).toBe(1); expect(await acceptedAudits(f.db)).toBe(1)
  })
  test('actual Next route uses only report bearer, commits exact receipt and denies foreign source/target hints', async () => {
    const f = await fixture(); await enable(f); routeDatabase.db = f.db
    const request = (authorization, body = f.bytes) => new Request('https://receiver.invalid/api/growth/external-marketing-reports', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}), Cookie: 'session=synthetic-human-session' } })
    const before = routeDatabase.calls
    for (const authorization of [null, 'Bearer enterprise-key', 'Bearer session-key']) {
      const response = await POST(request(authorization)); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(routeDatabase.calls).toBe(before); expect(await acceptedAudits(f.db)).toBe(0)
    const first = await POST(request(f.authorization)); expect(first.status).toBe(201)
    const receipt = await first.json(), replay = await POST(request(f.authorization)); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(receipt)
    for (const mutate of [r => { r.source.sourceBusinessId = randomUUID() }, r => { r.source.deploymentId = 'different-deployment' }, r => { r.target.bindingId = randomUUID() }, r => { r.target.initiativeId = randomUUID() }]) {
      const value = JSON.parse(f.bytes); mutate(value); expect((await POST(request(f.authorization, encode(value)))).status).toBe(404)
    }
    expect(await acceptedAudits(f.db)).toBe(1)
    const reportOnly = new Request('https://receiver.invalid/api/enterprise/import', { headers: { Authorization: f.authorization } })
    expect(await resolveApiAccessViewer(reportOnly, { db: f.db })).toBeNull()
    expect(await createSessionPort({ db: f.db, env: { NODE_ENV: 'production' } }).read(reportOnly)).toEqual({ state: 'UNAUTHENTICATED' })
    expect(await f.db.apiAccessKey.count()).toBe(0); expect(await f.db.person.count()).toBe(0)
  })
  test('every preexisting native table retains its rows across accept and replay', async () => {
    const f = await fixture(); await enable(f); const before = await nativeSnapshot(f.db)
    const expected = [...readFileSync(below(resolve(qa, 'base.sql')), 'utf8').matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]).filter(name => name !== 'AuditEvent').sort()
    expect(Object.keys(JSON.parse(before))).toEqual(expected)
    await ingest(f); await ingest(f, f.second)
    expect(await nativeSnapshot(f.db)).toBe(before)
  })
  test.skipIf(!process.env.ZURI_REPORT_GO_SOURCE)('actual Go transport survives committed response loss and validates the original receipt on explicit same-byte replay', async () => {
    const f = await fixture(); await enable(f); routeDatabase.db = f.db
    const { requestMarketingReceipt } = await import(/* @vite-ignore */ pathToFileURL(resolve(process.env.ZURI_REPORT_GO_SOURCE, 'apps/api/marketing-report-delivery.mjs')).href)
    let calls = 0, firstReceipt
    const server = createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks); expect(raw.toString()).toBe(f.bytes)
      const result = await POST(new Request('https://receiver.invalid/api/growth/external-marketing-reports', { method: 'POST', body: raw, headers: { Authorization: request.headers.authorization, 'Content-Type': 'application/json' } }))
      const receipt = await result.json(); calls++
      if (calls === 1) { expect(result.status).toBe(201); firstReceipt = receipt; response.destroy(); return }
      response.writeHead(result.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(receipt))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const binding = { origin: 'https://receiver.invalid', credential: f.credential }
    const fetchImpl = (url, options) => { expect(url).toBe(binding.origin + '/api/growth/external-marketing-reports'); return fetch('http://127.0.0.1:' + server.address().port + '/api/growth/external-marketing-reports', options) }
    const send = () => requestMarketingReceipt({ binding, canonicalEnvelope: f.bytes, envelope: JSON.parse(f.bytes), fetchImpl })
    try {
      expect((await send()).outcome).toBe('UNKNOWN'); expect(await f.db.marketingExternalReport.count()).toBe(1)
      const recovered = await send(); expect(recovered.outcome).toBe('ACK'); expect(recovered.receipt).toEqual(firstReceipt)
      expect(calls).toBe(2); expect(await acceptedAudits(f.db)).toBe(1)
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    // This qualifies HTTP/receiver recovery, not the still-pending PostgreSQL
    // sender Claim/Complete/Settle ledger or a real cross-system deployment.
  })
  test('private evidence reads recheck Guest, foreign Business/Tenant and hidden domain while retaining native inactive read semantics', async () => {
    const f = await fixture(); await enable(f); await ingest(f); const row = await f.db.marketingExternalReport.findFirst()
    const viewer = makeViewer({ visibleBusinessIds: [f.business.id], ownedBusinessIds: [], visibleDomains: ['growth'], domainsByBusinessId: { [f.business.id]: ['growth'] } })
    expect((await readMarketingExternalReport({ db: f.db, viewer, businessId: f.business.id, reportId: row.id })).canonicalEnvelope).toBe(f.bytes)
    for (const denied of [makeViewer({ visibleBusinessIds: [], visibleDomains: [], domainsByBusinessId: {} }), makeViewer({ visibleBusinessIds: [randomUUID()], visibleDomains: [] }), makeViewer({ visibleBusinessIds: [f.business.id], visibleDomains: [], domainsByBusinessId: { [f.business.id]: [] } })]) await expect(readMarketingExternalReport({ db: f.db, viewer: denied, businessId: f.business.id, reportId: row.id })).rejects.toMatchObject({ status: 404 })
    const foreignTenant = await f.db.tenant.create({ data: { code: randomUUID(), name: 'Foreign synthetic QA', portfolioId: (await f.db.portfolio.findFirst()).id } })
    const foreignBusiness = await f.db.business.create({ data: { code: randomUUID(), name: 'Foreign synthetic QA', tenantId: foreignTenant.id } })
    const foreignPlan = await f.db.marketingPlan.create({ data: { tenantId: foreignTenant.id, businessId: foreignBusiness.id, code: 'QA', title: 'Foreign synthetic QA', createdBy: 'qa' } })
    const foreignInitiative = await f.db.marketingInitiative.create({ data: { tenantId: foreignTenant.id, businessId: foreignBusiness.id, planId: foreignPlan.id, code: 'QA', createdBy: 'qa' } })
    const foreignViewer = makeViewer({ visibleBusinessIds: [foreignBusiness.id], ownedBusinessIds: [], visibleDomains: ['growth'], domainsByBusinessId: { [foreignBusiness.id]: ['growth'] } })
    await expect(readMarketingExternalReport({ db: f.db, viewer: foreignViewer, businessId: foreignBusiness.id, reportId: row.id })).rejects.toMatchObject({ status: 404 })
    await expect(readMarketingExternalReport({ db: f.db, viewer: foreignViewer, businessId: f.business.id, reportId: row.id })).rejects.toMatchObject({ status: 404 })
    const crossed = JSON.parse(f.bytes); crossed.target.initiativeId = foreignInitiative.id
    await expect(ingest(f, f.db, encode(crossed))).rejects.toMatchObject({ status: 404 })
    await f.db.business.update({ where: { id: f.business.id }, data: { status: 'INACTIVE' } })
    expect((await readMarketingExternalReport({ db: f.db, viewer, businessId: f.business.id, reportId: row.id })).id).toBe(row.id)
    await expect(ingest(f)).rejects.toMatchObject({ status: 404 })
  })
  test('all legacy backup service entry points fail closed without mutating a nonempty machine custody database', async () => {
    const f = await fixture(); await enable(f); await ingest(f)
    const before = await f.db.auditEvent.count(), oldRows = await f.db.marketingExternalReport.findMany()
    for (const operation of [() => extractSnapshot({ db: f.db }), () => exportSnapshot({ db: f.db }), () => previewImport({ schemaVersion: '1.0', tables: {} }, { db: f.db, viewer: operator }), () => importSnapshot({ schemaVersion: '1.0', tables: {} }, { db: f.db, viewer: operator, confirm: true })]) await expect(operation()).rejects.toMatchObject({ code: 'MARKETING_REPORT_LEGACY_BACKUP_UNSUPPORTED' })
    for (const name of ['marketingReportPolicy', 'marketingReportBinding', 'marketingExternalReport', 'MarketingExternalReport']) {
      const unsupported = { schemaVersion: '1.0', tables: { [name]: [] } }
      expect(previewSnapshot(unsupported).valid).toBe(false); expect(validateSnapshotRecovery(unsupported).valid).toBe(false)
    }
    expect(await f.db.auditEvent.count()).toBe(before); expect(await f.db.marketingExternalReport.findMany()).toEqual(oldRows)
  })
  test('separate native clients race to one identity; changed bytes never overwrite the winner', async () => {
    const f = await fixture(); await enable(f)
    const results = await Promise.all([ingest(f), ingest(f, f.second)])
    expect(results.map(result => result.status).sort()).toEqual([200, 201]); expect(results[0].receipt).toEqual(results[1].receipt)
    expect(await acceptedAudits(f.db)).toBe(1)
    const g = await fixture(); await enable(g); const changed = JSON.parse(g.bytes); changed.campaign.lifecycle = 'paused'
    const race = await Promise.allSettled([ingest(g), ingest(g, g.second, encode(changed))])
    expect(race.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(race.find(result => result.status === 'rejected').reason.status).toBe(409)
    expect(await acceptedAudits(g.db)).toBe(1)
  })
  test('audit/report failure and actual deferred outer commit failure cannot emit receipt or leave partial evidence', async () => {
    for (const failure of ['audit', 'report', 'commit']) {
      const f = await fixture(); await enable(f)
      if (failure === 'audit') await f.db.$executeRawUnsafe(`CREATE TRIGGER qa_failure BEFORE INSERT ON "AuditEvent" WHEN NEW."action"='REPORTED_EVIDENCE_ACCEPTED' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`)
      if (failure === 'report') await f.db.$executeRawUnsafe(`CREATE TRIGGER qa_failure BEFORE INSERT ON "MarketingExternalReport" BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`)
      if (failure === 'commit') {
        await f.db.$executeRawUnsafe('CREATE TABLE qa_parent (id INTEGER PRIMARY KEY)')
        await f.db.$executeRawUnsafe('CREATE TABLE qa_commit_guard (id TEXT PRIMARY KEY, missing INTEGER REFERENCES qa_parent(id) DEFERRABLE INITIALLY DEFERRED)')
        await f.db.$executeRawUnsafe(`CREATE TRIGGER qa_failure AFTER INSERT ON "MarketingExternalReport" BEGIN INSERT INTO qa_commit_guard VALUES (NEW."id",999); END`)
      }
      await expect(ingest(f)).rejects.toMatchObject({ status: 503 })
      expect(await f.second.marketingExternalReport.count()).toBe(0); expect(await acceptedAudits(f.second)).toBe(0)
      await f.second.$executeRawUnsafe('DROP TRIGGER qa_failure')
      expect((await ingest(f, f.second)).status).toBe(201)
    }
  })
  test('SQLite first-write gate observes a disable committed while a contender waits; lock exhaustion is bounded', async () => {
    const f = await fixture(); await enable(f); await ingest(f)
    let acquired, release; const ready = new Promise(resolve => { acquired = resolve }), gate = new Promise(resolve => { release = resolve })
    const disabling = f.db.$transaction(async tx => {
      await tx.marketingReportPolicy.update({ where: { businessId: f.business.id }, data: { ingestEnabled: false, version: { increment: 1 } } })
      acquired(); await gate
    }, { timeout: 10000 })
    await ready
    const pending = ingest(f, f.second); await pause(100); release(); await disabling
    await expect(pending).rejects.toMatchObject({ status: 404 }); expect(await acceptedAudits(f.db)).toBe(1)
    let locked, unlock; const lockReady = new Promise(resolve => { locked = resolve }), hold = new Promise(resolve => { unlock = resolve })
    const blocker = f.db.$transaction(async tx => { await tx.$executeRaw`UPDATE "MarketingReportBinding" SET "id"="id" WHERE "id"=${f.binding.id}`; locked(); await hold }, { timeout: 10000 })
    await lockReady
    const start = performance.now()
    try { await expect(ingest(f, f.second)).rejects.toMatchObject({ status: 503 }); expect(performance.now() - start).toBeLessThan(5000) } finally { unlock(); await blocker }
    expect(receiverRetryable({ code: 'P1008' })).toBe(true); expect(receiverRetryable({ code: 'P2010', meta: { code: '5' } })).toBe(true)
    expect(receiverRetryable({ code: 'P2010', meta: { code: '1' } })).toBe(false); expect(receiverRetryable({ code: 'P2002', meta: { target: ['id'] } })).toBe(false)
  })
  test('a contention retry reauthorizes a revocation committed between attempts', async () => {
    const f = await fixture(); await enable(f); await ingest(f)
    let acquired, release; const ready = new Promise(resolve => { acquired = resolve }), gate = new Promise(resolve => { release = resolve })
    const revoking = f.db.$transaction(async tx => {
      await tx.marketingReportBinding.update({ where: { id: f.binding.id }, data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } } })
      await tx.auditEvent.create({ data: { tenantId: f.tenant.id, businessId: f.business.id, entityType: 'MARKETING_REPORT_BINDING', entityId: f.binding.id, action: 'REVOKED', actorId: 'synthetic-qa-operator' } })
      acquired(); await gate
    }, { timeout: 10000 })
    await ready
    let attempts = 0
    const observed = { $transaction: (...args) => { attempts++; return f.second.$transaction(...args) } }
    const pending = ingest(f, observed).then(value => ({ value }), error => ({ error }))
    await pause(1600); release(); await revoking
    expect((await pending).error).toMatchObject({ status: 401 }); expect(attempts).toBeGreaterThan(1)
    expect(await f.db.marketingExternalReport.count()).toBe(1); expect(await acceptedAudits(f.db)).toBe(1)
  })
  test('native constraints retain report/audit/scope while permitting native content and lifecycle edits', async () => {
    const f = await fixture(); await enable(f); await ingest(f); const row = await f.db.marketingExternalReport.findFirst()
    for (const statement of [
      `UPDATE "MarketingExternalReport" SET "payloadHash"='${'a'.repeat(64)}'`, 'DELETE FROM "MarketingExternalReport"',
      `UPDATE "AuditEvent" SET "payloadJson"='{}' WHERE "id"='${row.auditEventId}'`, `DELETE FROM "AuditEvent" WHERE "id"='${row.auditEventId}'`,
      `UPDATE "MarketingReportBinding" SET "sourceDeploymentId"='other'`, 'DELETE FROM "MarketingReportBinding"', 'DELETE FROM "MarketingReportPolicy"',
      `UPDATE "Business" SET "tenantId"='other' WHERE "id"='${f.business.id}'`,
      `UPDATE "MarketingInitiative" SET "businessId"='other' WHERE "id"='${f.initiative.id}'`,
      `UPDATE "MarketingPlan" SET "businessId"='other' WHERE "id"='${f.plan.id}'`,
    ]) await expect(f.db.$executeRawUnsafe(statement)).rejects.toBeDefined()
    await f.db.marketingPlan.update({ where: { id: f.plan.id }, data: { title: 'Edited native content' } })
    await f.db.marketingInitiative.update({ where: { id: f.initiative.id }, data: { status: 'CLOSED' } })
    expect((await f.db.marketingExternalReport.findFirst()).canonicalEnvelope).toBe(f.bytes)
    await expect(assertMarketingReportBackupSafe(f.db)).rejects.toMatchObject({ code: 'MARKETING_REPORT_LEGACY_BACKUP_UNSUPPORTED' })
    const empty = database(); await expect(assertMarketingReportBackupSafe(empty.db, { tables: { marketingExternalReport: [] } })).rejects.toMatchObject({ status: 409 })
    const backup = below(resolve(qa, 'backup-' + randomUUID() + '.sqlite'))
    // VACUUM INTO creates a consistent whole-database copy including triggers;
    // no active raw file/journal copy or real restoration is used.
    await f.db.$executeRawUnsafe(`VACUUM INTO '${backup.replaceAll("'", "''")}'`)
    const restored = new PrismaClient({ datasources: { db: { url: 'file:' + backup.replaceAll('\\', '/') + '?socket_timeout=1' } }, log: [] }); clients.push(restored)
    const copied = await restored.marketingExternalReport.findFirst(); expect(copied.canonicalEnvelope).toBe(row.canonicalEnvelope); expect(copied.acceptedAt).toEqual(row.acceptedAt); expect(copied.auditEventId).toBe(row.auditEventId)
    await expect(restored.marketingExternalReport.deleteMany()).rejects.toBeDefined()
    await expect(ingest(f, restored)).rejects.toMatchObject({ status: 404 })
  })
})
