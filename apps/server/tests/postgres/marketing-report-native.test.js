// @req FR-281, FR-282, FR-283 — actual independent runtime-role sessions on an owned fresh Compact target.
// @spec ADR-115, SDD-112
// @tested src/modules/marketing/application/marketing-report-receiver.js
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { PrismaClient } from '@zuri/prisma-postgres'
import * as packageApi from '../../scripts/compact-package.mjs'
import * as baselineApi from '../../scripts/lib/compact/baseline.mjs'
import * as executorApi from '../../scripts/lib/compact/executor.mjs'
import { compactFixture } from '../helpers/compact-postgres-target.mjs'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { setMarketingReportPolicy, createMarketingReportBinding, revokeMarketingReportBinding } from '@/modules/marketing/application/marketing-report-operator'
import { receiveMarketingReport } from '@/modules/marketing/application/marketing-report-receiver'
import { canonicalReportText, reportHash } from '@/modules/marketing/application/marketing-report-wire'
import { readMarketingExternalReport } from '@/modules/marketing/application/marketing-report-read'
const operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
const golden = JSON.parse(await readFile(new URL('../fixtures/marketing-report/go-v01.json', import.meta.url)))
const encode = value => { const { payloadHash, ...body } = value; return canonicalReportText({ ...body, payloadHash: reportHash(body) }) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

describe('Compact PostgreSQL Marketing report runtime', () => {
  let target, db, second, observer
  const completed = new Set(), expected = ['guards', 'providerBoundary', 'triggerDrift', 'acceptBeforeDisable', 'disableBeforeReplay', 'acceptBeforeRevoke', 'revokeBeforeReplay', 'duplicates', 'conflicts', 'versions', 'absentPolicy', 'boundedWait', 'auditRollback', 'commitRollback', 'custody', 'nativePreservation', 'rebind-initiative-business', 'rebind-initiative-plan', 'rebind-plan-business', 'before-insert-initiative-business', 'before-insert-initiative-plan', 'before-insert-plan-business']
  beforeAll(async () => {
    target = await compactFixture({ packageApi, baselineApi, executorApi }); await target.install()
    const url = new URL(`postgresql://localhost/${target.target.database.name}`)
    url.hostname = target.target.database.host; url.port = String(target.target.database.port)
    url.username = target.target.database.runtimeRole; url.password = target.runtimePassword; url.searchParams.set('connection_limit', '1')
    db = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] }); second = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] })
    observer = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] })
    await db.$connect(); await second.$connect()
  }, 120000)
  afterAll(async () => {
    let cleanup = 'FAIL', cleanupError, identity
    try {
      if (target) { const observed = await target.driver.inspect({ manifest: target.manifest, target: target.target }); identity = { targetId: target.target.targetId, project: target.target.project, image: target.manifest.images.postgres, baselineSha256: target.manifest.schemaBaseline.sha256, systemIdentifier: observed.database.systemIdentifier, databaseOid: observed.database.oid, catalogSha256: observed.database.catalogSha256 } }
      await db?.$disconnect(); await second?.$disconnect(); await observer?.$disconnect(); await target?.close(); cleanup = 'PASS'
    } catch (error) { cleanupError = error }
    if (process.env.COMPACT_MARKETING_EVIDENCE_FILE) await writeFile(process.env.COMPACT_MARKETING_EVIDENCE_FILE, JSON.stringify({ environment: 'TEST', implementationBase: 'd5525db188a2cbf8625cebaf9afcce95c836af14', candidate: 'base plus working patch, not an exact production release', ...identity, status: expected.every(name => completed.has(name)) && cleanup === 'PASS' ? 'PASS' : 'FAIL', cleanup, checks: Object.fromEntries(expected.map(name => [name, completed.has(name)])) }, null, 2))
    if (cleanupError) throw cleanupError
  }, 120000)
  async function fixture({ withoutPolicy = false } = {}) {
    const portfolio = await db.portfolio.create({ data: { code: randomUUID(), name: 'Compact synthetic' } })
    const tenant = await db.tenant.create({ data: { code: randomUUID(), name: 'Compact synthetic', portfolioId: portfolio.id } })
    const business = await db.business.create({ data: { code: randomUUID(), name: 'Compact synthetic', tenantId: tenant.id } })
    const plan = await db.marketingPlan.create({ data: { code: randomUUID(), title: 'Synthetic', tenantId: tenant.id, businessId: business.id, createdBy: 'TEST' } })
    const initiative = await db.marketingInitiative.create({ data: { code: randomUUID(), tenantId: tenant.id, businessId: business.id, planId: plan.id, createdBy: 'TEST' } })
    if (withoutPolicy) return { business, tenant, plan, initiative }
    await setMarketingReportPolicy({ db, provider: 'postgresql', viewer: operator, businessId: business.id, expectedVersion: 0, ingestEnabled: false })
    const { binding, credential } = await createMarketingReportBinding({ db, provider: 'postgresql', viewer: operator, businessId: business.id, sourceDeploymentId: golden.source.deploymentId, sourceBusinessId: golden.source.sourceBusinessId })
    await setMarketingReportPolicy({ db, provider: 'postgresql', viewer: operator, businessId: business.id, expectedVersion: 1, ingestEnabled: true })
    const envelope = structuredClone(golden); envelope.target = { bindingId: binding.id, initiativeId: initiative.id }
    return { business, tenant, plan, initiative, binding, credential, raw: encode(envelope), authorization: `Bearer ${credential}` }
  }
  const receive = (f, database = db, raw = f.raw) => receiveMarketingReport({ db: database, provider: 'postgresql', authorization: f.authorization, raw })
  const audits = f => db.auditEvent.count({ where: { businessId: f.business.id, action: 'REPORTED_EVIDENCE_ACCEPTED' } })
  function holdAfter(database, modelName, method, predicate = () => true) {
    let release, reached
    const gate = new Promise(resolve => { release = resolve }), ready = new Promise(resolve => { reached = resolve })
    const wrapped = new Proxy(database, { get(base, key) {
      if (key !== '$transaction') return Reflect.get(base, key)
      return (fn, options) => base.$transaction(tx => fn(new Proxy(tx, { get(transaction, property) {
        if (property !== modelName) return Reflect.get(transaction, property)
        return new Proxy(transaction[property], { get(model, key) { if (key !== method) return Reflect.get(model, key); return async args => { const result = await model[key](args); if (predicate(args)) { reached(); await gate } return result } } })
      } })), options)
    } })
    return { wrapped, ready, release: () => release() }
  }
  async function blockedOnPolicy(pid) {
    let state
    for (let attempt = 0; attempt < 20; attempt++) {
      ;[state] = await observer.$queryRaw`SELECT wait_event_type, EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND relation='"MarketingReportPolicy"'::regclass AND mode='RowShareLock') AS policy, EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND relation='"MarketingReportBinding"'::regclass AND mode='RowShareLock') AS binding FROM pg_stat_activity WHERE pid=${pid}`
      if (state?.wait_event_type === 'Lock') break
      await pause(10)
    }
    expect(state).toMatchObject({ wait_event_type: 'Lock', policy: true, binding: false })
  }
  it('retains report custody guards with narrower runtime privileges and no owner/BYPASSRLS', async () => {
    const [role] = await db.$queryRaw`SELECT current_user AS name, r.rolsuper, r.rolbypassrls, has_table_privilege(current_user,'"MarketingExternalReport"','UPDATE') AS update, has_table_privilege(current_user,'"MarketingExternalReport"','DELETE') AS delete FROM pg_roles r WHERE r.rolname=current_user`
    expect(role).toMatchObject({ name: 'zuri_web_login', rolsuper: false, rolbypassrls: false, update: false, delete: false })
    const triggers = await target.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'marketing_%' ORDER BY tgname")
    expect(triggers.rows.map(row => row.tgname)).toEqual(expect.arrayContaining(['marketing_report_policy_guard', 'marketing_report_binding_guard', 'marketing_external_report_guard', 'marketing_report_audit_guard', 'marketing_report_business_scope_guard', 'marketing_report_initiative_scope_guard', 'marketing_report_plan_scope_guard']))
    const functions = await target.query("SELECT proname,prosecdef,proconfig,has_function_privilege('zuri_web_login',oid,'EXECUTE') AS callable FROM pg_proc WHERE proname IN ('marketing_report_audit_guard','marketing_report_native_scope_guard') ORDER BY proname")
    expect(functions.rows).toHaveLength(2)
    for (const fn of functions.rows) expect(fn).toMatchObject({ prosecdef: true, callable: false, proconfig: ['search_path=public, pg_temp'] })
    completed.add('guards')
  })
  it('orders acceptance before a competing policy disable without disclosing a later replay', async () => {
    const f = await fixture()
    let release, reached
    const gate = new Promise(resolve => { release = resolve }), ready = new Promise(resolve => { reached = resolve })
    const observed = new Proxy(db, { get(base, key) {
      if (key !== '$transaction') return Reflect.get(base, key)
      return (fn, options) => base.$transaction(tx => fn(new Proxy(tx, { get(transaction, property) {
        if (property !== 'marketingReportBinding') return Reflect.get(transaction, property)
        return new Proxy(transaction.marketingReportBinding, { get(model, method) {
          if (method !== 'findUnique') return Reflect.get(model, method)
          return async args => { const result = await model.findUnique(args); if (args.include?.policy) { reached(); await gate } return result }
        } })
      } })), options)
    } })
    const accepting = receive(f, observed)
    await ready
    let settled = false
    const disabling = setMarketingReportPolicy({ db: second, provider: 'postgresql', viewer: operator, businessId: f.business.id, expectedVersion: 2, ingestEnabled: false }).then(value => { settled = true; return { value } }, error => { settled = true; return { error } })
    try { await pause(100); expect(settled).toBe(false) } finally { release(); await Promise.allSettled([accepting, disabling]) }
    expect((await accepting).status).toBe(201); expect((await disabling).error).toBeUndefined()
    await expect(receive(f)).rejects.toMatchObject({ status: 404 })
    completed.add('acceptBeforeDisable')
  })

  it('refuses implicit SQLite selection on a real PostgreSQL client before receipt publication', async () => {
    const f = await fixture()
    await expect(receiveMarketingReport({ db, authorization: f.authorization, raw: f.raw })).rejects.toMatchObject({ status: 503 })
    expect(await audits(f)).toBe(0)
    completed.add('providerBoundary')
  })

  it('detects a disabled custody trigger as installed catalog drift and never repairs it', async () => {
    await target.query('ALTER TABLE "MarketingExternalReport" DISABLE TRIGGER marketing_external_report_guard')
    try { await expect(target.install()).rejects.toMatchObject({ code: 'COMPACT_SCHEMA_DRIFT' }) } finally { await target.query('ALTER TABLE "MarketingExternalReport" ENABLE TRIGGER marketing_external_report_guard') }
    completed.add('triggerDrift')
  })

  it('observes policy-before-binding locks when disable commits before identical replay', async () => {
    const f = await fixture(); await receive(f)
    const [{ pid }] = await second.$queryRaw`SELECT pg_backend_pid() AS pid`
    const hold = holdAfter(db, 'marketingReportPolicy', 'updateMany')
    const disabling = setMarketingReportPolicy({ db: hold.wrapped, provider: 'postgresql', viewer: operator, businessId: f.business.id, expectedVersion: 2, ingestEnabled: false })
    await hold.ready
    const replay = receive(f, second).then(value => ({ value }), error => ({ error }))
    try { await blockedOnPolicy(pid) } finally { hold.release(); await Promise.allSettled([disabling, replay]) }
    expect((await replay).error).toMatchObject({ status: 404 }); expect(await audits(f)).toBe(1)
    completed.add('disableBeforeReplay')
  })

  it('observes acceptance before revoke and refuses disclosure after revocation', async () => {
    const f = await fixture(), hold = holdAfter(db, 'marketingReportBinding', 'findUnique', args => Boolean(args.include?.policy))
    const [{ pid }] = await second.$queryRaw`SELECT pg_backend_pid() AS pid`
    const accepting = receive(f, hold.wrapped); await hold.ready
    const revoking = revokeMarketingReportBinding({ db: second, provider: 'postgresql', viewer: operator, bindingId: f.binding.id, expectedVersion: 1 })
    try { await blockedOnPolicy(pid) } finally { hold.release(); await Promise.allSettled([accepting, revoking]) }
    expect((await accepting).status).toBe(201); expect((await revoking).status).toBe('REVOKED')
    await expect(receive(f)).rejects.toMatchObject({ status: 401 }); expect(await audits(f)).toBe(1)
    completed.add('acceptBeforeRevoke')
  })

  it('observes revoke-before-replay and rereads credential authority after acquiring locks', async () => {
    const f = await fixture(); await receive(f)
    const [{ pid }] = await second.$queryRaw`SELECT pg_backend_pid() AS pid`
    const hold = holdAfter(db, 'marketingReportBinding', 'updateMany')
    const revoking = revokeMarketingReportBinding({ db: hold.wrapped, provider: 'postgresql', viewer: operator, bindingId: f.binding.id, expectedVersion: 1 }); await hold.ready
    const replay = receive(f, second).then(value => ({ value }), error => ({ error }))
    try { await blockedOnPolicy(pid) } finally { hold.release(); await Promise.allSettled([revoking, replay]) }
    expect((await replay).error).toMatchObject({ status: 401 }); expect(await audits(f)).toBe(1)
    completed.add('revokeBeforeReplay')
  })

  it('returns one committed receipt for independent simultaneous identical requests', async () => {
    const f = await fixture(), results = await Promise.all([receive(f), receive(f, second)])
    expect(results.map(result => result.status).sort()).toEqual([200, 201]); expect(results[0].receipt).toEqual(results[1].receipt)
    expect(await audits(f)).toBe(1)
    expect(await db.marketingExternalReport.count({ where: { businessId: f.business.id } })).toBe(1)
    completed.add('duplicates')
  })

  it('never overwrites a winning identity with different canonical bytes or unsupported revisions', async () => {
    const f = await fixture(), changed = JSON.parse(f.raw); changed.campaign.lifecycle = 'paused'
    const results = await Promise.allSettled([receive(f), receive(f, second, encode(changed))])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ status: 409 })
    const row = await db.marketingExternalReport.findFirst({ where: { businessId: f.business.id } })
    expect([f.raw, encode(changed)]).toContain(row.canonicalEnvelope)
    changed.reportRevision = 2
    await expect(receive(f, second, encode(changed))).rejects.toMatchObject({ status: 422 })
    expect(await audits(f)).toBe(1)
    completed.add('conflicts')
  })

  it('serializes competing expected-version policy writes without losing an audited revision', async () => {
    const f = await fixture(), command = database => setMarketingReportPolicy({ db: database, provider: 'postgresql', viewer: operator, businessId: f.business.id, expectedVersion: 2, ingestEnabled: false })
    const results = await Promise.allSettled([command(db), command(second)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ status: 409 })
    expect(await db.marketingReportPolicy.findUnique({ where: { businessId: f.business.id } })).toMatchObject({ version: 3, ingestEnabled: false })
    completed.add('versions')
  })

  it('orders concurrent absent-policy creation through the advisory lock and recheck', async () => {
    const f = await fixture({ withoutPolicy: true }), create = database => setMarketingReportPolicy({ db: database, provider: 'postgresql', viewer: operator, businessId: f.business.id, expectedVersion: 0, ingestEnabled: false })
    const results = await Promise.allSettled([create(db), create(second)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ status: 409 })
    expect(await db.marketingReportPolicy.count({ where: { businessId: f.business.id } })).toBe(1)
    completed.add('absentPolicy')
  })

  it('bounds exhausted contention without emitting a receipt or partial audit', async () => {
    const f = await fixture(); let release, reached
    const gate = new Promise(resolve => { release = resolve }), ready = new Promise(resolve => { reached = resolve })
    const blocker = db.$transaction(async tx => { await tx.$queryRaw`SELECT "businessId" FROM "MarketingReportPolicy" WHERE "businessId"=${f.business.id} FOR UPDATE`; reached(); await gate }, { timeout: 10000 })
    await ready; const started = performance.now()
    try { await expect(receive(f, second)).rejects.toMatchObject({ status: 503 }); expect(performance.now() - started).toBeLessThan(5000) } finally { release(); await blocker }
    expect(await audits(f)).toBe(0); expect(await db.marketingExternalReport.count({ where: { businessId: f.business.id } })).toBe(0)
    completed.add('boundedWait')
  })

  it('rolls back report acceptance when the actual scoped audit insert fails', async () => {
    const f = await fixture()
    await target.query(`CREATE FUNCTION compact_report_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."businessId"='${f.business.id}' AND NEW.action='REPORTED_EVIDENCE_ACCEPTED' THEN RAISE EXCEPTION 'SYNTHETIC_TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER compact_report_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION compact_report_audit_failure()`)
    try { await expect(receive(f)).rejects.toMatchObject({ status: 503 }) } finally { await target.query('DROP TRIGGER compact_report_audit_failure ON "AuditEvent"; DROP FUNCTION compact_report_audit_failure()') }
    expect(await audits(f)).toBe(0); expect(await db.marketingExternalReport.count({ where: { businessId: f.business.id } })).toBe(0)
    completed.add('auditRollback')
  })

  it('does not return a receipt when a deferred constraint rejects the outer commit', async () => {
    const f = await fixture()
    await target.query(`CREATE TABLE compact_report_parent(id integer PRIMARY KEY); CREATE TABLE compact_report_deferred(id text PRIMARY KEY,missing integer REFERENCES compact_report_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE FUNCTION compact_report_commit_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN IF NEW."businessId"='${f.business.id}' THEN INSERT INTO compact_report_deferred VALUES(NEW.id,999); END IF; RETURN NEW; END $$; CREATE TRIGGER compact_report_commit_failure AFTER INSERT ON "MarketingExternalReport" FOR EACH ROW EXECUTE FUNCTION compact_report_commit_failure()`)
    let callbackResolved = false
    const wrapped = new Proxy(db, { get(base, key) { if (key !== '$transaction') return Reflect.get(base, key); return (fn, options) => base.$transaction(async tx => { const result = await fn(tx); callbackResolved = true; return result }, options) } })
    try { await expect(receive(f, wrapped)).rejects.toMatchObject({ status: 503 }); expect(callbackResolved).toBe(true) } finally { await target.query('DROP TRIGGER compact_report_commit_failure ON "MarketingExternalReport"; DROP FUNCTION compact_report_commit_failure(); DROP TABLE compact_report_deferred; DROP TABLE compact_report_parent') }
    expect(await audits(f)).toBe(0); expect(await db.marketingExternalReport.count({ where: { businessId: f.business.id } })).toBe(0)
    completed.add('commitRollback')
  })

  it('retains append-only evidence/audit and linked scope while permitting native content/lifecycle edits', async () => {
    const f = await fixture(); await receive(f)
    const row = await db.marketingExternalReport.findFirst({ where: { businessId: f.business.id } })
    await expect(db.marketingExternalReport.update({ where: { id: row.id }, data: { payloadHash: 'a'.repeat(64) } })).rejects.toBeDefined()
    await expect(db.marketingExternalReport.delete({ where: { id: row.id } })).rejects.toBeDefined()
    await expect(db.auditEvent.update({ where: { id: row.auditEventId }, data: { payloadJson: '{}' } })).rejects.toBeDefined()
    await expect(db.auditEvent.delete({ where: { id: row.auditEventId } })).rejects.toBeDefined()
    const foreign = await fixture({ withoutPolicy: true })
    await expect(db.business.update({ where: { id: f.business.id }, data: { tenantId: foreign.tenant.id } })).rejects.toBeDefined()
    await expect(db.marketingInitiative.update({ where: { id: f.initiative.id }, data: { businessId: foreign.business.id } })).rejects.toBeDefined()
    await db.marketingPlan.update({ where: { id: f.plan.id }, data: { title: 'Edited native content' } })
    await db.marketingInitiative.update({ where: { id: f.initiative.id }, data: { status: 'CLOSED' } })
    const owner = makeViewer({ visibleBusinessIds: [f.business.id], ownedBusinessIds: [f.business.id], visibleDomains: ['growth'] })
    await expect(readMarketingExternalReport({ db, viewer: owner, businessId: f.business.id, reportId: row.id })).resolves.toMatchObject({ canonicalEnvelope: f.raw })
    const stranger = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    await expect(readMarketingExternalReport({ db, viewer: stranger, businessId: f.business.id, reportId: row.id })).rejects.toBeDefined()
    await expect(receive(f)).rejects.toMatchObject({ status: 404 })
    completed.add('custody')
  })

  it('preserves every preexisting native table row across intake and exact replay', async () => {
    const f = await fixture()
    const snapshot = async () => { const result = await target.query(`SELECT jsonb_object_agg(tablename,query_to_xml(format('SELECT to_jsonb(t) AS row FROM public.%I t ORDER BY to_jsonb(t)::text',tablename),false,true,'')::text) AS snapshot FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('MarketingReportPolicy','MarketingReportBinding','MarketingExternalReport','AuditEvent')`); return createHash('sha256').update(JSON.stringify(result.rows[0].snapshot)).digest('hex') }
    const before = await snapshot(); await receive(f); await receive(f, second); expect(await snapshot()).toBe(before)
    completed.add('nativePreservation')
  })

  it.each(['initiative-business', 'initiative-plan', 'plan-business'])('serializes first-report scope-race: %s', async move => {
    const f = await fixture(), foreign = await fixture({ withoutPolicy: true })
    const freePlan = await db.marketingPlan.create({ data: { code: randomUUID(), title: 'Unused foreign plan', tenantId: foreign.tenant.id, businessId: foreign.business.id, createdBy: 'TEST' } })
    const hold = holdAfter(db, 'marketingExternalReport', 'create')
    const [{ pid }] = await second.$queryRaw`SELECT pg_backend_pid() AS pid`
    const accepting = receive(f, hold.wrapped); await hold.ready
    let settled = false
    const operation = move === 'plan-business'
      ? second.marketingPlan.update({ where: { id: f.plan.id }, data: { businessId: foreign.business.id } })
      : second.marketingInitiative.update({ where: { id: f.initiative.id }, data: move === 'initiative-plan' ? { planId: freePlan.id } : { businessId: foreign.business.id } })
    const moving = operation.then(value => { settled = true; return { value } }, error => { settled = true; return { error } })
    try {
      await pause(100); expect(settled).toBe(false)
      const [state] = await observer.$queryRaw`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`
      expect(state.wait_event_type).toBe('Lock')
    } finally { hold.release(); await Promise.allSettled([accepting, moving]) }
    expect((await accepting).status).toBe(201)
    expect((await moving).error).toBeDefined()
    expect(String((await moving).error.message)).toContain('MARKETING_REPORT_NATIVE_SCOPE_IMMUTABLE')
    expect(await db.marketingInitiative.findUnique({ where: { id: f.initiative.id } })).toMatchObject({ businessId: f.business.id, planId: f.plan.id })
    expect(await db.marketingPlan.findUnique({ where: { id: f.plan.id } })).toMatchObject({ businessId: f.business.id })
    completed.add(`rebind-${move}`)
  })

  it.each(['initiative-business', 'initiative-plan', 'plan-business'])('refuses scope-before-insert-race: %s', async move => {
    const f = await fixture(), foreign = await fixture({ withoutPolicy: true })
    const freePlan = await db.marketingPlan.create({ data: { code: randomUUID(), title: 'Unused foreign plan', tenantId: foreign.tenant.id, businessId: foreign.business.id, createdBy: 'TEST' } })
    let release, reached
    const gate = new Promise(resolve => { release = resolve }), ready = new Promise(resolve => { reached = resolve })
    const [{ pid }] = await db.$queryRaw`SELECT pg_backend_pid() AS pid`
    const moving = second.$transaction(async tx => {
      if (move === 'plan-business') await tx.marketingPlan.update({ where: { id: f.plan.id }, data: { businessId: foreign.business.id } })
      else await tx.marketingInitiative.update({ where: { id: f.initiative.id }, data: move === 'initiative-plan' ? { planId: freePlan.id } : { businessId: foreign.business.id } })
      reached(); await gate
    }, { timeout: 10000 })
    await ready
    const accepting = receive(f).then(value => ({ value }), error => ({ error }))
    try {
      let state
      for (let i = 0; i < 20; i++) { [state] = await observer.$queryRaw`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`; if (state?.wait_event_type === 'Lock') break; await pause(10) }
      expect(state.wait_event_type).toBe('Lock')
    } finally { release(); await Promise.allSettled([moving, accepting]) }
    await moving
    expect((await accepting).error).toMatchObject({ status: 404 })
    expect(await db.marketingExternalReport.count({ where: { businessId: f.business.id } })).toBe(0)
    expect(await audits(f)).toBe(0)
    completed.add(`before-insert-${move}`)
  })
})
