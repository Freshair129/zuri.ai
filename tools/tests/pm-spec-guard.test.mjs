// Approved developer-tooling spec: .brain/rca/2026-10-05-pm-spec-dag-two-day-progress-loop.md
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { publishDashboard, sha256, validateBatch, validateComposition, validateDashboard, verifyHandoff } from '../pm-spec-guard.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PACK = path.join(ROOT, '.brain/rca/evidence/2026-10-05-pm-spec-handoff')
const TOOL = path.join(ROOT, 'tools/pm-spec-guard.mjs')
const input = file => fs.readFileSync(path.join(PACK, file))
const parse = file => JSON.parse(input(file).toString())
const encode = value => Buffer.from(JSON.stringify(value))
const SOURCES = {
  planJson: 'inputs/delivery-plan-v0.9.47b-postcomposition.json',
  features: 'source/FEATURES.md', featureMap: 'source/FEATURE-MAP.generated.md', prd: 'source/PRD-SDD-v1.0.md',
  requirementIndex: 'source/pm-requirement-index.json', idLedger: 'source/id-ledger.json',
  doc08: 'source/08-EVIDENCE-AND-REVIEW.md', doc11: 'source/11-UI-SYSTEM-AND-INTERACTIONS.md', doc20: 'source/20-MULTI-AGENT-DELIVERY-PLAN.md',
}
const html = () => input('dashboard/pm-execution-progress-r8.html')
const plan = () => input(SOURCES.planJson)
const data = () => JSON.parse(html().toString().match(/id="pm-execution-data">([\s\S]*?)<\/script>/)[1])
function dashboard(change) {
  const payload = data()
  change(payload)
  return Buffer.from(html().toString().replace(/(<script type="application\/json" id="pm-execution-data">)[\s\S]*?(<\/script>)/, (_match, start, end) => `${start}${JSON.stringify(payload)}${end}`))
}
function composition(change) {
  const after = parse(SOURCES.planJson)
  change(after)
  return validateComposition(input('inputs/delivery-plan-v0.9.46b-precomposition.json'), encode(after),
    input('inputs/pmr-025-design-bundle-v0.1.9-selected.candidate.json'), input('inputs/pmr-025-plan-composition-proposal.candidate.json'))
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'zai-pm-spec-guard-'))
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(tmpdir()))
    assert.ok(path.basename(root).startsWith('zai-pm-spec-guard-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const target = path.join(root, '.brain/pm-spec-views/pm-execution-progress.html'), proposed = path.join(root, 'proposed.html')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const preimage = dashboard(value => { value.dashboardRevision = 'previous' })
  fs.writeFileSync(target, preimage)
  fs.writeFileSync(proposed, html())
  const sources = Object.fromEntries(Object.entries(SOURCES).map(([key, file]) => [key, path.join(PACK, file)]))
  const candidate = path.join(PACK, 'inputs/pmr-025-design-bundle-v0.1.9-selected.candidate.json')
  const before = path.join(PACK, 'inputs/delivery-plan-v0.9.46b-precomposition.json')
  const manifest = path.join(PACK, 'manifest.json')
  const inputs = [...Object.values(sources), candidate, before, manifest, proposed].map(file => ({ path: file, sha256: sha256(fs.readFileSync(file)), role: [sources.planJson, before, manifest].includes(file) ? 'REVIEW_CONTEXT' : 'SEMANTIC_INPUT' }))
  const readSetSha256 = sha256(JSON.stringify(inputs))
  const packet = {
    schemaVersion: 1, inputs, readSetSha256,
    reviews: [{ id: 'review-1', reviewer: 'independent', model: 'fixture-model', verdict: 'PASS', evidence: 'fixture-only',
      at: '2026-10-05T10:00:00+07:00', artifactSha256: sha256(html()), readSetSha256 },
    { id: 'candidate-review', reviewer: 'independent', model: 'fixture-model', verdict: 'PASS', evidence: 'fixture-only',
      at: '2026-10-05T10:00:00+07:00', artifactSha256: sha256(fs.readFileSync(candidate)), readSetSha256 }],
    finalReviewIds: ['candidate-review', 'review-1'], retries: [],
    progress: { planSha256: sha256(plan()), stateCounts: verifyHandoff().stateCounts, artifactsChanged: [] },
    blockers: [{ owner: 'domain-owner', decision: 'Q11 remains OPEN', nextAction: 'Owner contract decision' }],
    events: [{ id: 'historical-unknown', at: '2026-10-05T03:55:00+07:00', confidence: 'UNKNOWN', reason: 'Original command log absent' }],
    dashboard: { target, preimageSha256: sha256(fs.readFileSync(target)), proposedPath: proposed, planPath: sources.planJson, sources },
  }
  return { root, target, proposed, packet, preimage }
}

function refreeze(packet) {
  packet.inputs.forEach(input => { input.sha256 = sha256(fs.readFileSync(input.path)) })
  packet.readSetSha256 = sha256(JSON.stringify(packet.inputs))
  packet.reviews.forEach(review => { review.readSetSha256 = packet.readSetSha256 })
}

test('pinned handoff verifies payloads and intentional 44→43 plan context without granting authority', () => {
  const result = verifyHandoff()
  assert.equal(result.snapshotFiles, 20)
  assert.equal(result.archivePayloads, 49)
  assert.equal(result.sourcePinsBefore, 44)
  assert.equal(result.sourcePinsAfter, 43)
  assert.equal(result.dispatchable, false)
  assert.equal(result.implementationAuthorized, false)
  assert.equal(result.historicalChronology, 'UNKNOWN')
  assert.equal(result.operationalControls, 'NOT_RUN')
  assert.equal(result.stateCounts.ACCEPTED, 3)
})

test('changed snapshot and rehashed manifest are both refused', t => {
  const { root } = fixture(t)
  const copy = path.join(root, 'pack')
  fs.cpSync(PACK, copy, { recursive: true })
  const candidate = path.join(copy, 'inputs/pmr-025-design-bundle-v0.1.9-selected.candidate.json')
  fs.appendFileSync(candidate, ' ')
  assert.throws(() => verifyHandoff(copy), /Snapshot hash mismatch/)
  const manifest = path.join(copy, 'manifest.json')
  const changed = JSON.parse(fs.readFileSync(manifest))
  const entry = changed.entries.find(item => item.snapshotPath.endsWith('v0.1.9-selected.candidate.json'))
  entry.sha256 = sha256(fs.readFileSync(candidate))
  entry.bytes = fs.statSync(candidate).size
  fs.writeFileSync(manifest, JSON.stringify(changed))
  assert.throws(() => verifyHandoff(copy), /not the pinned snapshot/)
})

test('composition refuses unrelated package edits, gate promotion and receipt rewrites', () => {
  assert.throws(() => composition(after => { after.workPackages[0].title += ' changed' }), /Unexpected composed field/)
  assert.throws(() => composition(after => { after.dispatchable = true }), /Unexpected composed field/)
  assert.throws(() => composition(after => { after.workPackages[5].state = 'ACCEPTED' }), /state after-value/)
  assert.throws(() => composition(after => { after.decisionReceipts[0].verdict = 'FORGED' }), /Prior receipts changed/)
  assert.throws(() => composition(after => { after.decisionReceipts.at(-1).reviewedProposal.sha256 = '0'.repeat(64) }), /Receipt proposal mismatch/)
})

test('dashboard refuses stale plan/source hashes, stale states and duplicate payloads', () => {
  const digests = data().sourceDigests
  assert.throws(() => validateDashboard(dashboard(value => { value.planSha = '0'.repeat(64) }), plan(), digests), /STALE dashboard plan/)
  assert.throws(() => validateDashboard(dashboard(value => { value.sourceDigests.doc20 = '0'.repeat(64) }), plan(), digests), /STALE dashboard sources/)
  assert.throws(() => validateDashboard(dashboard(value => { value.tasks[0].state = 'PLANNED' }), plan(), digests), /Dashboard state/)
  assert.throws(() => validateDashboard(Buffer.concat([html(), html()]), plan(), digests), /one data payload/)
})

test('batch binds every review to one frozen read set and preserves UNKNOWN events', t => {
  const { packet } = fixture(t)
  assert.equal(validateBatch(packet).events, 1)
  packet.reviews[0].readSetSha256 = '0'.repeat(64)
  assert.throws(() => validateBatch(packet), /another snapshot/)
})

test('source changed during review is STALE without editing the frozen candidate', t => {
  const { packet, proposed } = fixture(t)
  fs.appendFileSync(proposed, ' ')
  assert.throws(() => validateBatch(packet), /STALE frozen input/)
})

test('changed verdict on identical bytes requires explicit supersession and final reference', t => {
  const { packet } = fixture(t)
  packet.reviews.push({ ...packet.reviews[0], id: 'review-2', verdict: 'HOLD', at: '2026-10-05T10:01:00+07:00' })
  assert.throws(() => validateBatch(packet), /supersession/)
  Object.assign(packet.reviews[2], { supersedes: 'review-1', reason: 'Additional fixture evidence' })
  assert.throws(() => validateBatch(packet), /final verdicts/)
  packet.finalReviewIds = ['candidate-review', 'review-2']
  assert.equal(validateBatch(packet).reviews, 3)
})

test('unchanged reviews and identical retry reasons cannot make another automatic round', t => {
  const { packet } = fixture(t)
  packet.reviews.push({ ...packet.reviews[0], id: 'repeat', supersedes: 'review-1', reason: 'Same result' })
  assert.throws(() => validateBatch(packet), /Unchanged review repeated/)
  packet.reviews.pop()
  const retry = { kind: 'ACCEPTANCE_REPAIR', acceptanceRevision: 'revision-1', round: 1, inputSha256: packet.inputs[0].sha256, reason: 'same failure', at: '2026-10-05T10:02:00+07:00' }
  packet.retries = [retry, { ...retry, round: 2 }]
  assert.throws(() => validateBatch(packet), /Unchanged automatic retry/)
})

test('third acceptance repair round requires root RCA instead of automatic retry', t => {
  const { packet } = fixture(t)
  packet.retries = [1, 2, 3].map(round => ({ kind: 'ACCEPTANCE_REPAIR', acceptanceRevision: 'revision-1', round,
    inputSha256: packet.inputs[0].sha256, reason: `failure-${round}`, at: '2026-10-05T10:02:00+07:00' }))
  assert.throws(() => validateBatch(packet), /after two repair rounds/)
  packet.retries.pop()
  assert.equal(validateBatch(packet).retries, 2)
})

test('tool retries require their own integer limit, stop condition and recorded decision', t => {
  const { packet } = fixture(t)
  packet.retries = [{ kind: 'TOOL_RETRY', round: 1, inputSha256: packet.inputs[0].sha256, reason: 'flush failure', at: '2026-10-05T10:02:00+07:00' }]
  assert.throws(() => validateBatch(packet), /retry limit or owner/)
  Object.assign(packet.retries[0], { limit: 1, stopCondition: 'One attempt then root inspection', ownerDecision: 'fixture-only-decision' })
  assert.equal(validateBatch(packet).retries, 1)
  packet.retries[0].round = 0.5
  assert.throws(() => validateBatch(packet), /retry limit or owner/)
})

test('verified chronology requires an exact frozen event record; missing history remains UNKNOWN', t => {
  const { packet, root } = fixture(t)
  packet.events[0].confidence = 'VERIFIED'
  packet.events[0].evidence = { path: packet.inputs[0].path, sha256: '0'.repeat(64) }
  assert.throws(() => validateBatch(packet), /Chronology evidence mismatch/)
  packet.events[0].evidence.sha256 = packet.inputs[0].sha256
  packet.events[0].evidence.pointer = ''
  packet.events[0].detail = 'Fixture command record'
  assert.throws(() => validateBatch(packet), /Event is not present/)
  const record = path.join(root, 'event.json')
  fs.writeFileSync(record, JSON.stringify({ id: packet.events[0].id, at: packet.events[0].at, detail: packet.events[0].detail }))
  packet.inputs.push({ path: record, sha256: sha256(fs.readFileSync(record)), role: 'REVIEW_CONTEXT' })
  refreeze(packet)
  packet.events[0].evidence = { path: record, sha256: sha256(fs.readFileSync(record)), pointer: '' }
  assert.equal(validateBatch(packet).events, 1)
  delete packet.blockers[0].owner
  assert.throws(() => validateBatch(packet), /blocker handoff/)
})

test('Windows writable flush and readback publish only the chosen view', t => {
  const { packet, target, root } = fixture(t)
  const result = publishDashboard(packet, root)
  assert.equal(result.status, 'PUBLISHED_VIEW_ONLY')
  assert.equal(result.implementationAuthorized, false)
  assert.deepEqual(fs.readFileSync(target), html())
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['pm-execution-progress.html'])
})

test('rejected postimage leaves preimage intact and creates no temporary files', t => {
  const { packet, proposed, target, root, preimage } = fixture(t)
  fs.writeFileSync(proposed, dashboard(value => { value.planSha = '0'.repeat(64) }))
  refreeze(packet)
  packet.reviews[0].artifactSha256 = packet.inputs.at(-1).sha256
  assert.throws(() => publishDashboard(packet, root), /STALE dashboard plan/)
  assert.deepEqual(fs.readFileSync(target), preimage)
  assert.equal(fs.readdirSync(path.dirname(target)).length, 1)
})

test('fsync failure and a raced preimage both abort without replacing the target', t => {
  const { packet, target, root, preimage } = fixture(t)
  const mock = t.mock.method(fs, 'fsyncSync', () => { throw new Error('fixture flush failure') })
  assert.throws(() => publishDashboard(packet, root), /fixture flush failure/)
  mock.mock.restore()
  assert.deepEqual(fs.readFileSync(target), preimage)
  assert.equal(fs.readdirSync(path.dirname(target)).length, 1)
  const flush = fs.fsyncSync
  t.mock.method(fs, 'fsyncSync', descriptor => { flush(descriptor); fs.writeFileSync(target, 'concurrent view') })
  assert.throws(() => publishDashboard(packet, root), /preimage changed before rename/)
  assert.equal(fs.readFileSync(target).toString(), 'concurrent view')
  assert.equal(fs.readdirSync(path.dirname(target)).length, 1)
})

test('failed readback stays FAIL and preserves rollback bytes without overwriting a concurrent writer', t => {
  const { packet, target, root, preimage } = fixture(t)
  const rename = fs.renameSync
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); fs.writeFileSync(to, 'concurrent changed view') })
  assert.throws(() => publishDashboard(packet, root), /readback mismatch[\s\S]*verified preimage/)
  assert.equal(fs.readFileSync(target).toString(), 'concurrent changed view')
  const backups = fs.readdirSync(path.dirname(target)).filter(file => file.endsWith('.preimage'))
  assert.equal(backups.length, 1)
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(target), backups[0])), preimage)
})

test('publication refuses evidence-pack targets and frozen input targets', t => {
  const { packet, proposed, root } = fixture(t)
  packet.dashboard.target = path.join(PACK, 'dashboard/pm-execution-progress-r8.html')
  assert.throws(() => publishDashboard(packet, root), /publication allowlist/)
  packet.dashboard.target = proposed
  assert.throws(() => publishDashboard(packet, root), /publication allowlist/)
})

test('CLI returns nonzero for rejected batches and never opens implementation authority', t => {
  const { packet, root } = fixture(t)
  packet.reviews[0].readSetSha256 = '0'.repeat(64)
  const file = path.join(root, 'packet.json')
  fs.writeFileSync(file, JSON.stringify(packet))
  const result = spawnSync(process.execPath, [TOOL, 'batch', file], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /FAIL:.*another snapshot/)
  const valid = spawnSync(process.execPath, [TOOL, 'handoff'], { encoding: 'utf8' })
  assert.equal(valid.status, 0, valid.stderr)
  assert.equal(JSON.parse(valid.stdout).implementationAuthorized, false)
})

test('batch requires typed candidate, reviewed preimage, pinned manifest and an exact candidate review', t => {
  const { packet } = fixture(t)
  for (const suffix of ['v0.1.9-selected.candidate.json', 'v0.9.46b-precomposition.json', 'manifest.json']) {
    const input = packet.inputs.find(item => item.path.endsWith(suffix))
    const role = input.role
    input.role = role === 'SEMANTIC_INPUT' ? 'REVIEW_CONTEXT' : 'SEMANTIC_INPUT'
    refreeze(packet)
    assert.throws(() => validateBatch(packet), /Missing typed candidate/)
    input.role = role
  }
  refreeze(packet)
  packet.reviews.pop()
  packet.finalReviewIds = ['review-1']
  assert.throws(() => validateBatch(packet), /Missing exact candidate review/)
})

test('publication requires exact postimage PASS, the allowed target and pinned source identities', t => {
  const { packet, proposed, root, target, preimage } = fixture(t)
  packet.reviews[0].verdict = 'HOLD'
  assert.throws(() => publishDashboard(packet, root), /exact postimage PASS/)
  packet.reviews[0].verdict = 'PASS'
  packet.dashboard.target = path.join(root, 'unrelated.html')
  assert.throws(() => publishDashboard(packet, root), /publication allowlist/)
  packet.dashboard.target = target
  const original = packet.dashboard.sources.doc20
  packet.dashboard.sources.doc20 = packet.dashboard.sources.doc08
  assert.throws(() => publishDashboard(packet, root), /Wrong dashboard source identity/)
  packet.dashboard.sources.doc20 = original
  fs.appendFileSync(proposed, '<script>changed outside payload</script>')
  refreeze(packet)
  packet.reviews[0].artifactSha256 = sha256(fs.readFileSync(proposed))
  assert.throws(() => publishDashboard(packet, root), /outside the literal data block/)
  assert.deepEqual(fs.readFileSync(target), preimage)
})

test('progress counts and artifact changes require the exact plan and frozen before/after evidence', t => {
  const { packet } = fixture(t)
  packet.progress.stateCounts.ACCEPTED++
  assert.throws(() => validateBatch(packet), /lifecycle counts mismatch/)
  packet.progress.stateCounts = verifyHandoff().stateCounts
  packet.progress.artifactsChanged = [{ beforeSha256: packet.inputs[0].sha256, afterSha256: packet.inputs[0].sha256 }]
  assert.throws(() => validateBatch(packet), /Unchanged artifact counted/)
  packet.progress.artifactsChanged[0].afterSha256 = '0'.repeat(64)
  assert.throws(() => validateBatch(packet), /changed artifact identity/)
  packet.progress.artifactsChanged[0].artifact = 'deliveryPlan'
  assert.throws(() => validateBatch(packet), /does not match its pinned identity/)
  packet.progress.artifactsChanged[0] = { artifact: 'deliveryPlan',
    beforeSha256: packet.inputs.find(input => input.path.endsWith('v0.9.46b-precomposition.json')).sha256,
    afterSha256: packet.inputs[0].sha256 }
  assert.equal(validateBatch(packet).status, 'PASS_VALIDATION')
  packet.progress.artifactsChanged[0].beforeSha256 = packet.inputs[1].sha256
  packet.progress.artifactsChanged[0].afterSha256 = packet.inputs[8].sha256
  assert.throws(() => validateBatch(packet), /does not match its pinned identity/)
})

test('supplied batch chain preserves reviews and cannot reset acceptance retry rounds', t => {
  const { packet, root } = fixture(t)
  packet.retries = [1, 2].map(round => ({ kind: 'ACCEPTANCE_REPAIR', acceptanceRevision: 'same-revision', round,
    inputSha256: packet.inputs[0].sha256, reason: `failure-${round}`, at: '2026-10-05T10:02:00+07:00' }))
  assert.equal(validateBatch(packet).retries, 2)
  const previous = path.join(root, 'previous-packet.json')
  fs.writeFileSync(previous, JSON.stringify(packet))
  packet.previousPacket = { path: previous, sha256: sha256(fs.readFileSync(previous)) }
  packet.inputs.push({ ...packet.previousPacket, role: 'REVIEW_CONTEXT' })
  // Prior retries resolve against their original immutable packet, not this new read set.
  packet.inputs = packet.inputs.filter(input => !input.path.endsWith('v0.9.47b-postcomposition.json'))
  packet.reviews = [{ ...packet.reviews[0], id: 'review-2', verdict: 'HOLD', supersedes: 'review-1',
    reason: 'Additional record', at: '2026-10-05T10:03:00+07:00' }]
  packet.finalReviewIds = ['candidate-review', 'review-2']
  packet.retries = []
  refreeze(packet)
  const result = validateBatch(packet)
  assert.equal(result.historyReviews.length, 3)
  assert.equal(result.historyCoverage, 'SUPPLIED_PACKET_CHAIN_ONLY')
  packet.retries = [{ kind: 'ACCEPTANCE_REPAIR', acceptanceRevision: 'same-revision', round: 1,
    inputSha256: packet.inputs[0].sha256, reason: 'failure-3', at: '2026-10-05T10:04:00+07:00' }]
  assert.throws(() => validateBatch(packet), /Repair round sequence mismatch/)
  packet.retries[0].round = 3
  assert.throws(() => validateBatch(packet), /after two repair rounds/)
  fs.appendFileSync(previous, ' ')
  assert.throws(() => validateBatch(packet), /STALE frozen input/)
})

test('DAG projection refuses incorrect waves and task attributes', () => {
  const digests = data().sourceDigests
  assert.throws(() => validateDashboard(dashboard(value => { value.waves[0].pop() }), plan(), digests), /DAG waves mismatch/)
  assert.throws(() => validateDashboard(dashboard(value => { value.tasks[0].wave++ }), plan(), digests), /task wave mismatch/)
  assert.throws(() => validateDashboard(dashboard(value => { value.tasks[0].title += ' changed' }), plan(), digests), /task projection mismatch/)
})

test('literal payload replacement preserves dollar tokens instead of interpreting replacement syntax', t => {
  const { packet, proposed, target, root } = fixture(t)
  fs.writeFileSync(proposed, dashboard(value => { value.fixtureLiteral = '$& $1 $$' }))
  refreeze(packet)
  packet.reviews[0].artifactSha256 = sha256(fs.readFileSync(proposed))
  assert.equal(publishDashboard(packet, root).status, 'PUBLISHED_VIEW_ONLY')
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(proposed))
  assert.match(fs.readFileSync(target).toString(), /\$& \$1 \$\$/)
})
