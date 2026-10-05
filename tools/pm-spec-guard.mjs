#!/usr/bin/env node

// Approved developer-tooling spec: .brain/rca/2026-10-05-pm-spec-dag-two-day-progress-loop.md
// @tested tools/tests/pm-spec-guard.test.mjs
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACK = path.join(ROOT, '.brain/rca/evidence/2026-10-05-pm-spec-handoff')
const MANIFEST_SHA = 'b5b5bb65e61556c8332260652a9074319f7de0d8f6aa19fbd945c19dc2b014b8'
const PLAN_PATH = 'docs/architecture/project-manager-system/contracts/delivery-plan.candidate.json'
const PACKAGE_ID = 'PMR-025-BUNDLE-DESIGN'
const FILES = {
  before: 'inputs/delivery-plan-v0.9.46b-precomposition.json',
  after: 'inputs/delivery-plan-v0.9.47b-postcomposition.json',
  candidate: 'inputs/pmr-025-design-bundle-v0.1.9-selected.candidate.json',
  predecessor: 'inputs/pmr-025-design-bundle-v0.1.8-predecessor.candidate.json',
  proposal: 'inputs/pmr-025-plan-composition-proposal.candidate.json',
}
const SOURCE_PATHS = {
  planJson: FILES.after, features: 'source/FEATURES.md', featureMap: 'source/FEATURE-MAP.generated.md',
  prd: 'source/PRD-SDD-v1.0.md', requirementIndex: 'source/pm-requirement-index.json',
  idLedger: 'source/id-ledger.json', doc08: 'source/08-EVIDENCE-AND-REVIEW.md',
  doc11: 'source/11-UI-SYSTEM-AND-INTERACTIONS.md', doc20: 'source/20-MULTI-AGENT-DELIVERY-PLAN.md',
}
const CHANGED_ARTIFACTS = {
  deliveryPlan: { before: FILES.before, after: FILES.after, role: 'REVIEW_CONTEXT' },
  pmr025Candidate: { before: FILES.predecessor, after: FILES.candidate, role: 'SEMANTIC_INPUT' },
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = bytes => JSON.parse(bytes.toString('utf8'))
const equal = (actual, expected, message) => assert.deepStrictEqual(actual, expected, message)
const check = (condition, message) => assert.ok(condition, message)
const packageOf = plan => plan.workPackages.find(item => item.id === PACKAGE_ID)
const counts = items => items.reduce((result, item) => {
  result[item.state] = (result[item.state] || 0) + 1
  return result
}, {})

function dagWaves(items) {
  const known = new Set(items.map(item => item.id)), done = new Set(), waves = []
  equal(known.size, items.length, 'Duplicate DAG package')
  while (done.size < items.length) {
    const wave = items.filter(item => !done.has(item.id) && item.dependsOn.every(id => known.has(id) && done.has(id))).map(item => item.id)
    check(wave.length, 'DAG has a cycle or unknown dependency')
    waves.push(wave)
    wave.forEach(id => done.add(id))
  }
  return waves
}

function contained(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function packFile(root, relative) {
  check(typeof relative === 'string' && !relative.includes('\\') && !relative.split('/').includes('..'), 'Invalid snapshot path')
  const absolute = fs.realpathSync(path.resolve(root, relative))
  check(contained(fs.realpathSync(root), absolute), 'Snapshot path escapes pack')
  return fs.readFileSync(absolute)
}

// Read the bounded classic ZIP used by this pack; never extract its paths to disk.
function archivePayloads(bytes) {
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break
  }
  check(end >= 0 && bytes.readUInt32LE(end) === 0x06054b50, 'Missing ZIP directory')
  equal(bytes.readUInt32LE(end + 4), 0, 'Multi-disk ZIP is unsupported')
  const count = bytes.readUInt16LE(end + 10)
  equal(bytes.readUInt16LE(end + 8), count, 'ZIP entry count mismatch')
  check(count !== 65535, 'ZIP64 is unsupported')
  let offset = bytes.readUInt32LE(end + 16)
  const directoryEnd = offset + bytes.readUInt32LE(end + 12)
  equal(directoryEnd, end, 'ZIP directory boundary mismatch')
  const entries = new Map()
  for (let index = 0; index < count; index++) {
    equal(bytes.readUInt32LE(offset), 0x02014b50, 'Invalid ZIP entry')
    check(!(bytes.readUInt16LE(offset + 8) & 1), 'Encrypted ZIP is unsupported')
    const method = bytes.readUInt16LE(offset + 10)
    const size = bytes.readUInt32LE(offset + 20)
    const length = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    check(!entries.has(name), 'Duplicate archive path')
    check(length <= 16 * 1024 * 1024, 'Archive payload exceeds guard limit')
    const local = bytes.readUInt32LE(offset + 42)
    equal(bytes.readUInt32LE(local), 0x04034b50, 'Invalid local ZIP entry')
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
    check(start + size <= bytes.readUInt32LE(end + 16), 'Archive payload overlaps directory')
    const compressed = bytes.subarray(start, start + size)
    check(method === 0 || method === 8, 'Unsupported ZIP compression')
    const payload = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 16 * 1024 * 1024 })
    equal(payload.length, length, 'Archive length mismatch')
    entries.set(name, payload)
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
  }
  equal(offset, directoryEnd, 'ZIP directory length mismatch')
  return entries
}

export function validateComposition(beforeBytes, afterBytes, candidateBytes, proposalBytes) {
  const before = json(beforeBytes), after = json(afterBytes), candidate = json(candidateBytes), proposal = json(proposalBytes)
  const oldPackage = packageOf(before), newPackage = packageOf(after)
  check(oldPackage && newPackage, 'Missing PMR-025 package')
  equal(sha256(beforeBytes), proposal.sourcePlan.sha256, 'Wrong plan preimage')
  equal(sha256(candidateBytes), proposal.reviewedCandidate.sha256, 'Wrong reviewed candidate')
  const changes = proposal.proposedChanges
  equal(changes.workPackageId, PACKAGE_ID, 'Wrong proposed package')
  equal(before.version, changes.planVersion.before, 'Plan before-value mismatch')
  equal(after.version, changes.planVersion.after, 'Plan after-value mismatch')
  equal(after.version, proposal.proposedPlanVersion, 'Proposed version mismatch')
  for (const key of ['state', 'candidateArtifact', 'candidateSha256', 'candidateVersion']) {
    equal(oldPackage[key], changes[key].before, `${key} before-value mismatch`)
    equal(newPackage[key], changes[key].after, `${key} after-value mismatch`)
  }
  equal(oldPackage.previousPlanPointer, changes.previousPlanPointer.before, 'Previous pointer preimage mismatch')
  equal(newPackage.previousPlanPointer, changes.previousPlanPointer.after, 'Previous pointer postimage mismatch')
  for (const [key, value] of Object.entries(changes.latestCandidateReview.before)) {
    equal(oldPackage.latestCandidateReview[key], value, 'Review before-value mismatch')
  }
  equal(newPackage.latestCandidateReview, changes.latestCandidateReview.after, 'Review after-value mismatch')
  equal(newPackage.coordinatorReconciliation, changes.coordinatorReconciliation, 'Coordinator text mismatch')
  const expectedPackage = { ...oldPackage }
  for (const key of ['candidateArtifact', 'candidateSha256', 'candidateVersion', 'previousPlanPointer', 'latestCandidateReview']) {
    expectedPackage[key] = changes[key].after
  }
  expectedPackage.coordinatorReconciliation = changes.coordinatorReconciliation
  const expected = { ...before, version: after.version, workPackages: before.workPackages.map(item => item.id === PACKAGE_ID ? expectedPackage : item), decisionReceipts: after.decisionReceipts }
  equal(after, expected, 'Unexpected composed field change')
  equal(after.decisionReceipts.length, before.decisionReceipts.length + 1, 'Append exactly one receipt')
  equal(after.decisionReceipts.slice(0, -1), before.decisionReceipts, 'Prior receipts changed')
  const receipt = after.decisionReceipts.at(-1)
  check(!before.decisionReceipts.some(item => item.receiptId === receipt.receiptId), 'Duplicate root receipt')
  equal(receipt.reviewedPlanPreimage.sha256, sha256(beforeBytes), 'Receipt preimage mismatch')
  equal(receipt.reviewedCandidate.sha256, sha256(candidateBytes), 'Receipt candidate mismatch')
  equal(receipt.reviewedProposal.sha256, sha256(proposalBytes), 'Receipt proposal mismatch')
  equal(receipt.planVersionAfterComposition, after.version, 'Receipt version mismatch')
  for (const key of ['terraHigh', 'astra', 'lunaCandidateReview']) {
    equal(receipt.decisionMessages[key].proposalSha256, sha256(proposalBytes), 'Decision proposal mismatch')
  }
  equal(receipt.decisionMessages.terraHigh.verdict, 'GO_WITH_LIMITS', 'Missing composition decision')
  equal(receipt.decisionMessages.astra.verdict, 'CONCUR_WITH_LIMITS', 'Missing composition concurrence')
  for (const plan of [before, after]) {
    equal(plan.dispatchable, false, 'Dispatch gate opened')
    equal(plan.implementationAuthorized, false, 'Implementation gate opened')
    equal(plan.repairPolicy.maxAutomaticRepairRounds, 2, 'Repair policy changed')
  }
  equal(candidate.authorization.canonicalRegistration, false, 'Canonical gate opened')
  equal(candidate.authorization.implementationAuthorized, false, 'Candidate implementation gate opened')
  equal(candidate.openQuestions.length, 10, 'Question count changed')
  check(candidate.openQuestions.every(item => item.status === 'OPEN'), 'Owner question closed')
  equal(candidate.additionalOpenQuestion.status, 'OPEN', 'Q11 closed')
  equal(candidate.additionalOpenQuestion.implementationBlock, true, 'Q11 no longer blocks implementation')
  for (const entry of candidate.evidence.historicalBaselineVerification.differingPaths) {
    const pin = candidate.evidence.inputManifest.find(input => input.path === entry.path)
    check(pin, 'Historical comparison is not a pinned input')
    equal(entry.currentWorktreeSha256, pin.currentWorktreeSha256, 'Historical comparison mislabels current provenance')
  }
  equal(newPackage.state, 'CANDIDATE_READY_FOR_REVIEW', 'Candidate promoted')
  return { plan: after, candidate, stateCounts: counts(after.workPackages), receiptId: receipt.receiptId }
}

export function validateDashboard(htmlBytes, planBytes, sourceDigests) {
  const matches = [...htmlBytes.toString('utf8').matchAll(/<script type="application\/json" id="pm-execution-data">([\s\S]*?)<\/script>/g)]
  equal(matches.length, 1, 'Dashboard must have one data payload')
  const data = JSON.parse(matches[0][1]), plan = json(planBytes)
  equal(plan.dispatchable, false, 'Publication cannot open dispatch')
  equal(plan.implementationAuthorized, false, 'Publication cannot authorize implementation')
  equal(data.planSha, sha256(planBytes), 'STALE dashboard plan digest')
  equal(data.planVersion, plan.version, 'STALE dashboard plan version')
  equal(data.sourceDigests, sourceDigests, 'STALE dashboard sources')
  equal(data.dispatchable, plan.dispatchable, 'Dashboard dispatch gate mismatch')
  equal(data.implementationAuthorized, plan.implementationAuthorized, 'Dashboard implementation gate mismatch')
  equal(data.tasks.length, plan.workPackages.length, 'Dashboard task count mismatch')
  const waves = dagWaves(plan.workPackages)
  equal(data.waves.map(wave => [...wave].sort()), waves.map(wave => [...wave].sort()), 'Dashboard DAG waves mismatch')
  for (const item of plan.workPackages) {
    const tasks = data.tasks.filter(task => task.id === item.id)
    equal(tasks.length, 1, 'Missing or duplicate dashboard task')
    equal(tasks[0].state, item.state, 'Dashboard state mismatch')
    equal(tasks[0].dependsOn, item.dependsOn, 'Dashboard dependency mismatch')
    equal(tasks[0].wave, waves.findIndex(wave => wave.includes(item.id)) + 1, 'Dashboard task wave mismatch')
    for (const key of ['title', 'kind', 'requirements', 'entryGate']) {
      equal(tasks[0][key], key === 'requirements' ? (item[key] || []) : item[key], 'Dashboard task projection mismatch')
    }
  }
  equal(data.taskStateCounts, counts(plan.workPackages), 'Dashboard lifecycle counts mismatch')
  equal(data.edgeCount, plan.workPackages.reduce((sum, item) => sum + item.dependsOn.length, 0), 'Dashboard edge count mismatch')
  equal(data.sourceDigests.planJson, data.planSha, 'Dashboard source/plan digest split')
  return data
}

export function verifyHandoff(pack = PACK) {
  const manifestBytes = packFile(pack, 'manifest.json')
  equal(sha256(manifestBytes), MANIFEST_SHA, 'Handoff manifest is not the pinned snapshot')
  const manifest = json(manifestBytes), files = new Map()
  equal(manifest.entries.length, 20, 'Pack entry count mismatch')
  for (const entry of manifest.entries) {
    check(!files.has(entry.snapshotPath), 'Duplicate snapshot path')
    const bytes = packFile(pack, entry.snapshotPath)
    equal(sha256(bytes), entry.sha256, `Snapshot hash mismatch: ${entry.snapshotPath}`)
    equal(bytes.length, entry.bytes, `Snapshot size mismatch: ${entry.snapshotPath}`)
    files.set(entry.snapshotPath, bytes)
  }
  const archiveManifest = json(files.get('inputs/pmr-025-precomposition-manifest.json'))
  const payloads = archivePayloads(files.get('inputs/pmr-025-precomposition-inputs-v0.9.46b.zip'))
  equal(payloads.size, 49, 'Archive entry count mismatch')
  equal(archiveManifest.payloadEntries.length, payloads.size, 'Archive manifest count mismatch')
  const seen = new Set()
  for (const entry of archiveManifest.payloadEntries) {
    check(!seen.has(entry.path), 'Duplicate protected payload')
    seen.add(entry.path)
    const bytes = payloads.get(entry.path)
    check(bytes, 'Missing protected payload')
    equal(bytes.length, entry.bytes, 'Protected payload size mismatch')
    equal(sha256(bytes), entry.sha256, 'Protected payload hash mismatch')
  }
  const result = validateComposition(...['before', 'after', 'candidate', 'proposal'].map(key => files.get(FILES[key])))
  const predecessor = json(files.get(FILES.predecessor))
  for (const key of ['purpose', 'scope', 'preservedContractBoundaries', 'candidateContractBoundary', 'openContractBoundaries', 'proposedSurfaces', 'reviewBlockers', 'openQuestions', 'designDecisions', 'closedFlags', 'openQuestionSummary', 'additionalOpenQuestion']) {
    equal(result.candidate[key], predecessor[key], 'Candidate semantics changed')
  }
  const pins = result.candidate.evidence.inputManifest
  equal(pins.length, 44, 'Input pin count mismatch')
  equal(new Set(pins.map(pin => pin.path)).size, 44, 'Duplicate input pin')
  for (const pin of pins) {
    const digest = sha256(payloads.get(pin.path))
    equal(pin.rawByteSha256, digest, 'Raw input pin mismatch')
    equal(pin.currentWorktreeSha256, digest, 'Current input pin mismatch')
    if (pin.path === PLAN_PATH) equal(digest, sha256(files.get(FILES.before)), 'Review-context plan mismatch')
  }
  equal(pins.filter(pin => pin.path === PLAN_PATH).length, 1, 'Missing review-context plan')
  const sourceDigests = Object.fromEntries(Object.entries(SOURCE_PATHS).map(([key, file]) => [key, sha256(files.get(file))]))
  validateDashboard(files.get('dashboard/pm-execution-progress-r8.html'), files.get(FILES.after), sourceDigests)
  return { status: 'PASS_VALIDATION', manifestSha256: MANIFEST_SHA, snapshotFiles: 20, archivePayloads: 49,
    sourcePinsBefore: 44, sourcePinsAfter: 43, historicalPin: PLAN_PATH, sourceDigests,
    stateCounts: result.stateCounts, receiptId: result.receiptId, dispatchable: false, implementationAuthorized: false,
    historicalChronology: 'UNKNOWN', operationalControls: 'NOT_RUN', reviewerAuthorship: 'UNVERIFIED' }
}

// Future task evidence stays in an operator-owned JSON packet, not a runtime registry.
function citedRecord(bytes, pointer) {
  check(typeof pointer === 'string' && (pointer === '' || pointer.startsWith('/')), 'Missing event evidence locator')
  return pointer === '' ? json(bytes) : pointer.slice(1).split('/').reduce((value, key) => value[key.replaceAll('~1', '/').replaceAll('~0', '~')], json(bytes))
}

export function validateBatch(packet, ancestry = new Set()) {
  equal(packet.schemaVersion, 1, 'Unsupported batch schema')
  const pack = fs.realpathSync(packet.packPath || PACK)
  const handoff = verifyHandoff(pack)
  check(Array.isArray(packet.inputs) && packet.inputs.length > 0, 'Missing frozen read set')
  const seen = new Set()
  const resolved = new Set()
  for (const input of packet.inputs) {
    check(!seen.has(input.path), 'Duplicate frozen input')
    seen.add(input.path)
    const file = fs.realpathSync(input.path)
    check(!resolved.has(file), 'Duplicate resolved frozen input')
    resolved.add(file)
    check(['SEMANTIC_INPUT', 'REVIEW_CONTEXT'].includes(input.role), 'Missing input role')
    equal(sha256(fs.readFileSync(input.path)), input.sha256, 'STALE frozen input')
  }
  const readSetSha256 = sha256(JSON.stringify(packet.inputs))
  equal(packet.readSetSha256, readSetSha256, 'Read-set digest mismatch')
  for (const [file, role] of [[FILES.candidate, 'SEMANTIC_INPUT'], [FILES.before, 'REVIEW_CONTEXT'], ['manifest.json', 'REVIEW_CONTEXT']]) {
    const match = packet.inputs.find(input => fs.realpathSync(input.path) === fs.realpathSync(path.join(pack, file)))
    check(match && match.role === role, 'Missing typed candidate, plan preimage or source manifest')
  }
  let prior
  if (packet.previousPacket) {
    const file = fs.realpathSync(packet.previousPacket.path)
    check(!ancestry.has(file), 'Cyclic batch history')
    ancestry.add(file)
    const bytes = fs.readFileSync(file)
    equal(sha256(bytes), packet.previousPacket.sha256, 'Previous batch hash mismatch')
    check(packet.inputs.some(input => fs.realpathSync(input.path) === file && input.role === 'REVIEW_CONTEXT'), 'Previous packet is not frozen')
    prior = validateBatch(json(bytes), ancestry)
  }
  check(Array.isArray(packet.reviews) && packet.reviews.length > 0, 'Missing review evidence')
  const historyReviews = [...(prior?.historyReviews || []), ...packet.reviews]
  const reviews = new Map(), latest = new Map()
  for (const review of packet.reviews) {
    equal(review.readSetSha256, readSetSha256, 'Review used another snapshot')
    check(packet.inputs.some(input => input.sha256 === review.artifactSha256), 'Review artifact is not frozen')
  }
  for (const review of historyReviews) {
    check(review.id && !reviews.has(review.id), 'Duplicate review ID')
    check(review.reviewer && review.model && review.verdict && review.evidence && Number.isFinite(Date.parse(review.at)), 'Incomplete review evidence')
    const key = JSON.stringify([review.reviewer, review.artifactSha256])
    if (latest.has(key)) {
      equal(review.supersedes, latest.get(key).id, 'Missing verdict supersession')
      check(review.reason && review.verdict !== latest.get(key).verdict, 'Unchanged review repeated')
      check(Date.parse(review.at) >= Date.parse(latest.get(key).at), 'Verdict chronology reversed')
    } else check(!review.supersedes, 'Superseded verdict is absent')
    reviews.set(review.id, review)
    latest.set(key, review)
  }
  const candidateSha = sha256(packFile(pack, FILES.candidate))
  check([...latest.values()].some(review => review.artifactSha256 === candidateSha), 'Missing exact candidate review')
  equal([...packet.finalReviewIds].sort(), [...latest.values()].map(review => review.id).sort(), 'Composition does not reference final verdicts')
  const rounds = new Map(), otherRounds = new Map(), repeats = new Set()
  for (const retry of packet.retries) check(packet.inputs.some(input => input.sha256 === retry.inputSha256), 'Retry input is not frozen')
  const historyRetries = [...(prior?.historyRetries || []), ...packet.retries]
  for (const retry of historyRetries) {
    check(['ACCEPTANCE_REPAIR', 'PROVENANCE_SUCCESSOR', 'TOOL_RETRY', 'NEW_EVIDENCE_REVIEW'].includes(retry.kind), 'Unclassified retry')
    check(retry.inputSha256 && retry.reason && Number.isFinite(Date.parse(retry.at)), 'Incomplete retry record')
    const key = JSON.stringify([retry.kind, retry.inputSha256, retry.reason])
    check(!repeats.has(key), 'Unchanged automatic retry')
    repeats.add(key)
    if (retry.kind === 'ACCEPTANCE_REPAIR') {
      check(retry.acceptanceRevision, 'Missing acceptance revision')
      const next = (rounds.get(retry.acceptanceRevision) || 0) + 1
      equal(retry.round, next, 'Repair round sequence mismatch')
      check(next <= 2, 'Root RCA/scope decision required after two repair rounds')
      rounds.set(retry.acceptanceRevision, next)
    } else {
      check(Number.isInteger(retry.limit) && retry.limit > 0 && Number.isInteger(retry.round) && retry.round > 0 && retry.round <= retry.limit && retry.ownerDecision && retry.stopCondition, 'Missing retry limit or owner decision')
      const group = JSON.stringify([retry.kind, retry.ownerDecision])
      const previous = otherRounds.get(group)
      equal(retry.round, (previous?.round || 0) + 1, 'Retry round sequence mismatch')
      if (previous) equal([retry.limit, retry.stopCondition], [previous.limit, previous.stopCondition], 'Retry decision bounds changed')
      otherRounds.set(group, retry)
    }
  }
  equal(packet.progress.planSha256, handoff.sourceDigests.planJson, 'Progress refers to another plan snapshot')
  equal(packet.progress.stateCounts, handoff.stateCounts, 'Progress lifecycle counts mismatch')
  const changedArtifacts = new Set()
  for (const changed of packet.progress.artifactsChanged) {
    check(changed.beforeSha256 !== changed.afterSha256, 'Unchanged artifact counted as progress')
    const identity = CHANGED_ARTIFACTS[changed.artifact]
    check(identity && !changedArtifacts.has(changed.artifact), 'Unknown or duplicate changed artifact identity')
    changedArtifacts.add(changed.artifact)
    for (const side of ['before', 'after']) {
      const file = fs.realpathSync(path.join(pack, identity[side]))
      const input = packet.inputs.find(input => fs.realpathSync(input.path) === file)
      check(input && input.role === identity.role && input.sha256 === changed[`${side}Sha256`], 'Changed artifact evidence does not match its pinned identity')
    }
  }
  for (const blocker of packet.blockers) check(blocker.owner && blocker.decision && blocker.nextAction, 'Incomplete blocker handoff')
  const events = new Set()
  for (const event of packet.events) {
    check(event.id && !events.has(event.id) && Number.isFinite(Date.parse(event.at)), 'Invalid chronology event')
    events.add(event.id)
    check(['VERIFIED', 'INFERRED', 'UNKNOWN'].includes(event.confidence), 'Missing event confidence')
    if (event.confidence === 'VERIFIED') {
      const bytes = fs.readFileSync(event.evidence.path)
      equal(sha256(bytes), event.evidence.sha256, 'Chronology evidence mismatch')
      check(seen.has(event.evidence.path), 'Chronology evidence is not frozen')
      const record = citedRecord(bytes, event.evidence.pointer)
      equal([record.id, record.at, record.detail], [event.id, event.at, event.detail], 'Event is not present in cited evidence')
      check(event.detail, 'Missing event detail')
    } else check(event.reason, 'Uncertainty needs a reason')
  }
  return { status: 'PASS_VALIDATION', readSetSha256, reviews: reviews.size, retries: packet.retries.length,
    events: packet.events.length, blockers: packet.blockers.length, dispatchable: false, implementationAuthorized: false,
    historyCoverage: 'SUPPLIED_PACKET_CHAIN_ONLY', eventVerification: 'RECORD_CONTENT_ONLY', reviewerAuthorship: 'UNVERIFIED',
    operationalControls: 'NOT_RUN', historyReviews, historyRetries }
}

// Publication is limited to an explicitly named HTML view; this never composes a plan.
function flushExclusive(file, bytes) {
  const descriptor = fs.openSync(file, 'wx+')
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

export function publishDashboard(packet, workspaceRoot = ROOT) {
  const batch = validateBatch(packet)
  const publication = packet.dashboard
  const allowed = path.resolve(workspaceRoot, '.brain/pm-spec-views/pm-execution-progress.html')
  equal(path.resolve(publication.target), allowed, 'Target is outside the dashboard publication allowlist')
  const target = fs.realpathSync(publication.target)
  check(contained(fs.realpathSync(workspaceRoot), target), 'Dashboard target escapes workspace')
  equal(target, path.join(fs.realpathSync(workspaceRoot), '.brain/pm-spec-views/pm-execution-progress.html'), 'Redirected dashboard target is not allowed')
  check(path.extname(target).toLowerCase() === '.html', 'Publication target must be HTML')
  check(!contained(fs.realpathSync(PACK), target), 'Pinned evidence cannot be published over')
  check(!packet.inputs.some(input => fs.realpathSync(input.path) === target), 'Frozen input cannot be a publication target')
  const preimage = fs.readFileSync(target)
  equal(sha256(preimage), publication.preimageSha256, 'Publication preimage changed')
  const proposed = fs.readFileSync(publication.proposedPath), plan = fs.readFileSync(publication.planPath)
  check(packet.inputs.some(input => fs.realpathSync(input.path) === fs.realpathSync(publication.proposedPath)), 'Dashboard postimage is not frozen')
  check(packet.inputs.some(input => fs.realpathSync(input.path) === fs.realpathSync(publication.planPath)), 'Dashboard plan is not frozen')
  const pack = fs.realpathSync(packet.packPath || PACK)
  equal(fs.realpathSync(publication.planPath), fs.realpathSync(path.join(pack, FILES.after)), 'Publication plan is not the selected snapshot')
  check(batch.historyReviews.some(review => packet.finalReviewIds.includes(review.id) && review.artifactSha256 === sha256(proposed) && review.verdict === 'PASS'), 'Missing exact postimage PASS review')
  const payloadPattern = /(<script type="application\/json" id="pm-execution-data">)[\s\S]*?(<\/script>)/g
  const beforeBlocks = [...preimage.toString('utf8').matchAll(payloadPattern)]
  const afterBlocks = [...proposed.toString('utf8').matchAll(payloadPattern)]
  equal(beforeBlocks.length, 1, 'Preimage must contain one data payload')
  equal(afterBlocks.length, 1, 'Postimage must contain one data payload')
  const literal = preimage.toString('utf8').replace(payloadPattern, () => afterBlocks[0][0])
  equal(Buffer.from(literal), proposed, 'Dashboard changed outside the literal data block')
  equal(Object.keys(publication.sources).sort(), Object.keys(SOURCE_PATHS).sort(), 'Missing dashboard source paths')
  const sourceDigests = Object.fromEntries(Object.entries(publication.sources).map(([key, file]) => {
    equal(fs.realpathSync(file), fs.realpathSync(path.join(pack, SOURCE_PATHS[key])), 'Wrong dashboard source identity')
    check(packet.inputs.some(input => fs.realpathSync(input.path) === fs.realpathSync(file)), 'Dashboard source is not frozen')
    return [key, sha256(fs.readFileSync(file))]
  }))
  equal(sourceDigests.planJson, sha256(plan), 'Dashboard source plan mismatch')
  validateDashboard(proposed, plan, sourceDigests)
  const stem = path.join(path.dirname(target), `.pm-dashboard-${randomUUID()}`)
  const temporary = `${stem}.tmp`, backup = `${stem}.preimage`
  let renamed = false
  try {
    flushExclusive(backup, preimage)
    equal(sha256(fs.readFileSync(backup)), publication.preimageSha256, 'Dashboard preimage backup mismatch')
    flushExclusive(temporary, proposed)
    validateBatch(packet)
    equal(sha256(fs.readFileSync(target)), publication.preimageSha256, 'Publication preimage changed before rename')
    fs.renameSync(temporary, target)
    renamed = true
    equal(sha256(fs.readFileSync(target)), sha256(proposed), 'Publication readback mismatch')
    validateDashboard(fs.readFileSync(target), plan, sourceDigests)
    fs.unlinkSync(backup)
    return { status: 'PUBLISHED_VIEW_ONLY', sha256: sha256(proposed), dispatchable: false, implementationAuthorized: false }
  } catch (error) {
    // On readback failure, retain rollback bytes without another target write.
    if (renamed) error.message += `; inspect target before restoring verified preimage ${backup}`
    else if (fs.existsSync(backup)) fs.unlinkSync(backup)
    throw error
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function main(args) {
  if (args[0] === 'handoff' && args.length <= 2) return verifyHandoff(args[1] || PACK)
  if (['batch', 'publish-dashboard'].includes(args[0]) && args.length === 2) {
    const packet = json(fs.readFileSync(args[1]))
    if (args[0] === 'publish-dashboard') return publishDashboard(packet)
    const { historyReviews, historyRetries, ...result } = validateBatch(packet)
    return result
  }
  throw new Error('Usage: node tools/pm-spec-guard.mjs handoff [pack] | batch <packet.json> | publish-dashboard <packet.json>')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`) }
  catch (error) { process.stderr.write(`FAIL: ${error.message}\n`); process.exitCode = 1 }
}
