import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** WF02 local persistence primitive. It records assertions; it does not authenticate them. */
export const LEDGER_SCHEMA_VERSION = 1;
export const BUSY_TIMEOUT_MS = 1000;
export const PARK_MAPPING_DIGEST = 'sha256:fafbecdcec41731f72e555944bde202a946389d53be311a6c1199d2f8245413d';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'DEFERRED', 'NEEDS_DECISION', 'PARKED']);
const TRANSITIONS = new Map([
  ['READY', new Set(['RUNNING', 'COMPLETED', 'FAILED', 'DEFERRED', 'NEEDS_DECISION'])],
  ['RUNNING', new Set(['COMPLETED', 'FAILED', 'DEFERRED', 'NEEDS_DECISION'])],
  ['COMPLETED', new Set()], ['FAILED', new Set()], ['DEFERRED', new Set()],
  ['NEEDS_DECISION', new Set()], ['PARKED', new Set()],
]);
const DIGEST = /^(?:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/;
const HEX_DIGEST = /^[a-f0-9]{64}$/;
const REQUIRED_TABLES = [
  'ledger_meta', 'node_state', 'assignments', 'canonical_pr', 'transitions', 'requests',
  'request_conflicts', 'outbox_events', 'park_records', 'consumer_inbox',
  'consumer_applications', 'consumer_node_state',
];

export class LedgerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.details = details;
  }
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LedgerError('INVALID_REQUEST', 'JSON numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new LedgerError('INVALID_REQUEST', 'Request data must be plain JSON values.');
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}
function json(value) { return JSON.stringify(canonicalize(value)); }
function hashObject(value) { return digest(json(value)); }
function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new LedgerError('INVALID_REQUEST', `${name} is required.`);
  return value;
}
function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new LedgerError('INVALID_REQUEST', `${name} must be an explicit positive safe integer.`);
  return value;
}
function verifyDigest(value, name) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new LedgerError('INVALID_REQUEST', `${name} must be a SHA-256 digest.`);
  return value;
}
function safeLedgerId(value) { return requiredText(value, 'ledgerId'); }
function keyFor(ledgerId) { return digest(ledgerId); }
function databasePath(stateRoot, ledgerId) { return path.join(stateRoot, 'ledgers', `${keyFor(ledgerId)}.sqlite`); }
function quarantinePath(stateRoot, ledgerId) { return path.join(stateRoot, 'quarantine', keyFor(ledgerId)); }
function sameIdentity(a, b) { return Boolean(a && b && a.dev === b.dev && a.ino === b.ino); }
function asIdentity(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
async function identityAt(file) {
  try {
    const stat = await fsp.lstat(file, { bigint: false });
    if (!stat.isFile() || stat.isSymbolicLink()) return { unsafe: true, identity: asIdentity(stat) };
    return { exists: true, identity: asIdentity(stat) };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, identity: null };
    throw error;
  }
}
function probeHook(probe, name, detail = {}) {
  if (!probe) return;
  if (typeof probe !== 'function') throw new LedgerError('INVALID_PROBE', 'Probe must be a synchronous local test hook.');
  const value = probe(name, Object.freeze({ ...detail }));
  if (value && typeof value.then === 'function') throw new LedgerError('INVALID_PROBE', 'Probe hooks must be synchronous.');
}

function sqliteError(error) {
  const message = String(error?.message ?? error);
  if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(message)) {
    return new LedgerError('BUSY', 'The bounded SQLite write wait expired; no application retry was performed.', { busyWaitMs: BUSY_TIMEOUT_MS });
  }
  if (error instanceof LedgerError) return error;
  return new LedgerError('SQLITE_ERROR', message);
}

function assertMetaSchema(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names = new Set(rows.map((row) => row.name));
  const missing = REQUIRED_TABLES.filter((name) => !names.has(name));
  if (missing.length) throw new LedgerError('INCOMPLETE_INITIALIZATION', 'Required ledger schema objects are missing.', { missing });
}

function checkIntegrity(db) {
  const result = db.prepare('PRAGMA integrity_check').all();
  if (result.length !== 1 || result[0].integrity_check !== 'ok') {
    throw new LedgerError('INTEGRITY_FAILURE', 'SQLite integrity_check did not return exactly ok.', { result });
  }
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) throw new LedgerError('FOREIGN_KEY_FAILURE', 'SQLite foreign_key_check returned violations.', { violations: fk });
  assertMetaSchema(db);
}

function readSnapshot(db, ledgerId, anchor) {
  db.exec('BEGIN');
  try {
    checkIntegrity(db);
    const value = checkHistory(db, ledgerId, anchor);
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function checkHistory(db, ledgerId, expectedPrefixAnchor) {
  const meta = db.prepare('SELECT * FROM ledger_meta WHERE singleton=1').get();
  if (!meta) throw new LedgerError('INCOMPLETE_INITIALIZATION', 'Ledger metadata is absent.');
  if (meta.schema_version !== LEDGER_SCHEMA_VERSION) throw new LedgerError('UNSUPPORTED_SCHEMA', 'Ledger schema version is not supported.', { actual: meta.schema_version, supported: LEDGER_SCHEMA_VERSION });
  if (meta.ledger_id !== ledgerId) throw new LedgerError('LEDGER_ID_MISMATCH', 'The opened store belongs to a different ledger identity.', { actualLedgerId: meta.ledger_id });

  const rows = db.prepare('SELECT sequence, previous_hash, current_hash, event_id, request_digest, event_type, record_json, created_at FROM transitions ORDER BY sequence').all();
  const genesis = digest(`zuri-delivery-ledger/v1/genesis/${ledgerId}`);
  let prior = genesis;
  if (expectedPrefixAnchor.sequence === 0 && expectedPrefixAnchor.hash !== genesis) {
    throw new LedgerError('ANCHOR_MISMATCH', 'The supplied sequence-zero anchor is not this ledger’s genesis anchor.', { actualHead: { sequence: meta.head_sequence, hash: meta.head_hash } });
  }
  let knownPrefixFound = expectedPrefixAnchor.sequence === 0;
  let lastSequence = 0;
  const latest = new Map();
  for (const row of rows) {
    const nextSequence = lastSequence + 1;
    if (row.sequence !== nextSequence || row.previous_hash !== prior) throw new LedgerError('HISTORY_GAP', 'Transition sequence or previous hash is inconsistent.', { sequence: row.sequence, expectedSequence: nextSequence });
    let record;
    try { record = JSON.parse(row.record_json); } catch { throw new LedgerError('MALFORMED_HISTORY', 'A transition record is not valid JSON.', { sequence: row.sequence }); }
    if (json(record) !== row.record_json) throw new LedgerError('MALFORMED_HISTORY', 'A transition record is not canonical JSON.', { sequence: row.sequence });
    if (record.eventId !== row.event_id || record.requestDigest !== row.request_digest) throw new LedgerError('TRANSITION_IDENTITY_MISMATCH', 'Embedded transition identity differs from its immutable row.', { sequence: row.sequence });
    row.record = record;
    const expectedHash = hashObject({
      sequence: row.sequence, previousHash: row.previous_hash, eventId: row.event_id,
      requestDigest: row.request_digest, eventType: row.event_type, recordJson: row.record_json, createdAt: row.created_at,
    });
    if (expectedHash !== row.current_hash) throw new LedgerError('CHAIN_HASH_MISMATCH', 'A transition hash does not match its immutable record.', { sequence: row.sequence });
    prior = row.current_hash;
    lastSequence = row.sequence;
    if (row.sequence === expectedPrefixAnchor.sequence) {
      if (row.current_hash !== expectedPrefixAnchor.hash) throw new LedgerError('ANCHOR_MISMATCH', 'The trusted prefix anchor differs from the stored chain.', { sequence: row.sequence, storedHash: row.current_hash });
      knownPrefixFound = true;
    }
    const node = record.node;
    if (node?.nodeId && Number.isSafeInteger(node.acceptanceRevision)) {
      const key = `${node.nodeId}\u0000${node.acceptanceRevision}`;
      latest.set(key, { nodeId: node.nodeId, acceptanceRevision: node.acceptanceRevision, status: record.afterState, version: record.version, attempt: record.attempt, assignmentId: record.assignmentId, actor: latest.get(key)?.actor ?? record.actor, authorityReceiptRef: record.authorityReceiptRef, planDigest: record.planDigest, policyDigest: record.policyDigest, inputDigest: record.inputDigest, outputDigest: record.outputDigest, runDisposition: record.lifecycleRunDisposition ?? null });
    }
  }
  if (!knownPrefixFound || lastSequence < expectedPrefixAnchor.sequence) throw new LedgerError('ANCHOR_ROLLBACK', 'The caller’s known prefix is absent from the ledger history.', { expectedPrefixAnchor, actualHead: { sequence: lastSequence, hash: prior } });
  if (meta.head_sequence !== lastSequence || meta.head_hash !== prior) throw new LedgerError('HEAD_MISMATCH', 'Ledger metadata head differs from immutable transition history.', { metadata: { sequence: meta.head_sequence, hash: meta.head_hash }, history: { sequence: lastSequence, hash: prior } });

  const projections = db.prepare('SELECT node_id, acceptance_revision, status, version, attempt, assignment_id, assigned_actor, authority_receipt_ref, plan_digest, policy_digest, input_digest, output_digest, run_disposition FROM node_state ORDER BY node_id, acceptance_revision').all();
  if (projections.length !== latest.size) throw new LedgerError('PROJECTION_MISMATCH', 'Node projection row count differs from transition history.', { projectionCount: projections.length, historyCount: latest.size });
  for (const row of projections) {
    const expected = latest.get(`${row.node_id}\u0000${row.acceptance_revision}`);
    if (!expected || row.status !== expected.status || row.version !== expected.version || row.attempt !== expected.attempt || row.assignment_id !== expected.assignmentId || row.assigned_actor !== expected.actor || row.authority_receipt_ref !== expected.authorityReceiptRef || row.plan_digest !== expected.planDigest || row.policy_digest !== expected.policyDigest || row.input_digest !== expected.inputDigest || row.output_digest !== expected.outputDigest || row.run_disposition !== expected.runDisposition) {
      throw new LedgerError('PROJECTION_MISMATCH', 'Node projection disagrees with the immutable transition fold.', { nodeId: row.node_id, acceptanceRevision: row.acceptance_revision });
    }
  }
  const transitionBySequence = new Map(rows.map((row) => [row.sequence, row]));
  const transitionByEvent = new Map(rows.map((row) => [row.event_id, row]));
  const requests = db.prepare('SELECT * FROM requests ORDER BY created_at,event_id').all();
  const requestById = new Map();
  const receiptOnlyRequests = [];
  for (const row of requests) {
    if (digest(row.request_json) !== row.request_digest) throw new LedgerError('REQUEST_DIGEST_MISMATCH', 'A retained request digest does not match its canonical bytes.', { eventId: row.event_id });
    let req; let outcome;
    try { req = JSON.parse(row.request_json); outcome = JSON.parse(row.outcome_json); } catch { throw new LedgerError('REQUEST_MALFORMED', 'A retained request or receipt is not valid JSON.', { eventId: row.event_id }); }
    if (json(req) !== row.request_json || json(outcome) !== row.outcome_json || req.eventId !== row.event_id) throw new LedgerError('REQUEST_MALFORMED', 'A retained request or receipt is not canonical or its event id changed.', { eventId: row.event_id });
    if (row.transition_sequence !== null) {
      const transition = transitionBySequence.get(row.transition_sequence);
      if (!transition || transition.event_id !== row.event_id || transition.request_digest !== row.request_digest) throw new LedgerError('REQUEST_TRANSITION_MISMATCH', 'Request receipt does not point to its exact immutable transition.', { eventId: row.event_id });
      if (outcome.ok !== true || outcome.code !== 'COMMITTED' || outcome.eventId !== row.event_id || outcome.requestDigest !== row.request_digest || outcome.eventType !== transition.event_type || outcome.sequence !== transition.sequence || outcome.hash !== transition.current_hash || outcome.anchor?.sequence !== transition.sequence || outcome.anchor?.hash !== transition.current_hash || (Object.hasOwn(outcome.receipt ?? {}, 'status') && outcome.receipt.status !== transition.record.afterState)) throw new LedgerError('REQUEST_RECEIPT_MISMATCH', 'Stored committed receipt differs from its immutable transition.', { eventId: row.event_id });
    } else {
      if (transitionByEvent.has(row.event_id)) throw new LedgerError('REQUEST_TRANSITION_MISMATCH', 'A request marked receipt-only unexpectedly has a transition.', { eventId: row.event_id });
      receiptOnlyRequests.push({ row, req, outcome });
    }
    requestById.set(row.event_id, row);
  }
  const conflicts = db.prepare('SELECT * FROM request_conflicts ORDER BY original_event_id,conflicting_digest').all();
  const conflictEventIds = new Set();
  for (const conflict of conflicts) {
    const original = requestById.get(conflict.original_event_id);
    const transition = transitionBySequence.get(conflict.transition_sequence);
    let attempted;
    try { attempted = JSON.parse(conflict.conflicting_request_json); } catch { throw new LedgerError('CONFLICT_MALFORMED', 'Conflicting request bytes are malformed.', { eventId: conflict.original_event_id }); }
    if (!original || digest(conflict.conflicting_request_json) !== conflict.conflicting_digest || json(attempted) !== conflict.conflicting_request_json || attempted.eventId !== conflict.original_event_id || !transition || transition.event_id !== conflict.conflict_event_id || transition.event_type !== 'EVENT_ID_PAYLOAD_CONFLICT' || transition.request_digest !== conflict.conflicting_digest) {
      throw new LedgerError('CONFLICT_HISTORY_MISMATCH', 'A durable event conflict lost or changed one of its original or attempted requests.', { eventId: conflict.original_event_id });
    }
    conflictEventIds.add(conflict.conflict_event_id);
  }
  for (const row of rows) {
    if (!requestById.has(row.event_id) && !conflictEventIds.has(row.event_id)) throw new LedgerError('UNCLAIMED_TRANSITION', 'A transition has no immutable request receipt or conflict receipt.', { eventId: row.event_id });
  }
  const assignmentRows = db.prepare('SELECT * FROM assignments ORDER BY assignment_id').all();
  if (assignmentRows.length !== projections.length) throw new LedgerError('ASSIGNMENT_HISTORY_MISMATCH', 'Assignment and admitted projection counts differ.');
  if (assignmentRows.length !== rows.filter((row) => row.event_type === 'ADMITTED').length) throw new LedgerError('ASSIGNMENT_HISTORY_MISMATCH', 'Every admission must have exactly one immutable assignment.');
  for (const assignment of assignmentRows) {
    const state = db.prepare('SELECT * FROM node_state WHERE node_id=? AND acceptance_revision=?').get(assignment.node_id, assignment.acceptance_revision);
    const created = transitionByEvent.get(assignment.created_event_id);
    const admission = created?.record;
    if (!state || state.assignment_id !== assignment.assignment_id || state.attempt !== assignment.attempt || state.assigned_actor !== assignment.actor || !created || created.event_type !== 'ADMITTED' || admission.node?.nodeId !== assignment.node_id || admission.node?.acceptanceRevision !== assignment.acceptance_revision || admission.assignmentId !== assignment.assignment_id || admission.attempt !== assignment.attempt || admission.actor !== assignment.actor || admission.authorityReceiptRef !== assignment.authority_receipt_ref) throw new LedgerError('ASSIGNMENT_HISTORY_MISMATCH', 'An assignment differs from its immutable admission or projection.', { assignmentId: assignment.assignment_id });
  }
  const prRows = db.prepare('SELECT * FROM canonical_pr ORDER BY node_id,acceptance_revision').all();
  if (prRows.length !== rows.filter((row) => row.event_type === 'CANONICAL_PR_BOUND').length) throw new LedgerError('CANONICAL_PR_HISTORY_MISMATCH', 'Every canonical PR binding must retain exactly one immutable identity.');
  for (const pr of prRows) {
    const transition = transitionByEvent.get(pr.event_id);
    let identity;
    try { identity = JSON.parse(pr.pr_json); } catch { throw new LedgerError('CANONICAL_PR_MALFORMED', 'Canonical PR identity is malformed.', { eventId: pr.event_id }); }
    if (json(identity) !== pr.pr_json || !transition || transition.event_type !== 'CANONICAL_PR_BOUND' || json(transition.record.details.canonicalPr) !== pr.pr_json || transition.record.details.observedReceiptRef !== pr.observed_receipt_ref || transition.record.node.nodeId !== pr.node_id || transition.record.node.acceptanceRevision !== pr.acceptance_revision) throw new LedgerError('CANONICAL_PR_HISTORY_MISMATCH', 'Canonical PR identity differs from its immutable event.', { eventId: pr.event_id });
    const bindingRequestRow = requestById.get(pr.event_id);
    let bindingRequest;
    try { bindingRequest = bindingRequestRow ? JSON.parse(bindingRequestRow.request_json) : null; } catch {}
    if (!bindingRequestRow || bindingRequestRow.transition_sequence !== transition.sequence || !bindingRequest
      || bindingRequest.eventId !== pr.event_id || bindingRequest.nodeId !== pr.node_id || bindingRequest.acceptanceRevision !== pr.acceptance_revision
      || !bindingRequest.pr || typeof bindingRequest.pr !== 'object' || Array.isArray(bindingRequest.pr) || json(bindingRequest.pr) !== pr.pr_json
      || bindingRequest.observedReceiptRef !== pr.observed_receipt_ref || bindingRequest.assignmentId !== transition.record.assignmentId
      || bindingRequest.actor !== transition.record.actor || bindingRequest.authorityReceiptRef !== transition.record.authorityReceiptRef
      || !Number.isSafeInteger(bindingRequest.expectedVersion) || bindingRequest.expectedVersion < 1
      || transition.record.version !== bindingRequest.expectedVersion + 1) {
      throw new LedgerError('CANONICAL_PR_HISTORY_MISMATCH', 'Canonical PR binding request does not prove the durable identity recorded by its transition.', { eventId: pr.event_id });
    }
  }
  for (const { row, req, outcome } of receiptOnlyRequests) {
    const pr = prRows.find((candidate) => candidate.node_id === req.nodeId && candidate.acceptance_revision === req.acceptanceRevision);
    const binding = pr ? transitionByEvent.get(pr.event_id) : null;
    const current = req.nodeId && Number.isSafeInteger(req.acceptanceRevision)
      ? latest.get(`${req.nodeId}\u0000${req.acceptanceRevision}`)
      : null;
    let identity;
    try { identity = pr ? JSON.parse(pr.pr_json) : null; } catch {}
    const expectedOutcome = pr ? {
      ok: true,
      code: 'EXISTING_CANONICAL_PR',
      eventId: pr.event_id,
      durableWritePerformed: true,
      canonicalPr: identity,
    } : null;
    if (!pr || !binding || binding.event_type !== 'CANONICAL_PR_BOUND' || !current
      || req.eventId !== row.event_id || req.nodeId !== pr.node_id || req.acceptanceRevision !== pr.acceptance_revision
      || !Number.isSafeInteger(req.expectedVersion) || req.expectedVersion < binding.record.version || req.expectedVersion > current.version
      || req.assignmentId !== binding.record.assignmentId || req.actor !== binding.record.actor
      || typeof req.authorityReceiptRef !== 'string' || !req.authorityReceiptRef.trim()
      || req.observedReceiptRef !== pr.observed_receipt_ref
      || !req.pr || typeof req.pr !== 'object' || Array.isArray(req.pr) || json(req.pr) !== pr.pr_json
      || json(outcome) !== json(expectedOutcome)) {
      throw new LedgerError('RECEIPT_ONLY_OUTCOME_MISMATCH', 'Receipt-only outcome does not match its canonical request, durable PR identity, and hashed binding provenance.', { eventId: row.event_id });
    }
  }
  const parkRows = db.prepare('SELECT * FROM park_records ORDER BY node_id,acceptance_revision').all();
  if (parkRows.length !== rows.filter((row) => row.event_type === 'PARKED').length) throw new LedgerError('PARK_HISTORY_MISMATCH', 'Every PARK transition must retain exactly one complete raw record.');
  for (const park of parkRows) {
    const transition = transitionByEvent.get(park.event_id);
    let raw;
    try { raw = JSON.parse(park.raw_record_json); } catch { throw new LedgerError('PARK_RECORD_MALFORMED', 'Raw PARK record is malformed.', { eventId: park.event_id }); }
    if (!transition || transition.event_type !== 'PARKED' || transition.record.afterState !== 'PARKED' || transition.record.lifecycleRunDisposition !== raw.runDisposition || transition.record.details.mappingDigest !== park.mapping_digest || transition.record.details.mappingDigest !== PARK_MAPPING_DIGEST || json(transition.record.details.parkRecord) !== json(raw) || park.lifecycle_disposition !== 'PARKED' || transition.record.node.nodeId !== park.node_id || transition.record.node.acceptanceRevision !== park.acceptance_revision) throw new LedgerError('PARK_HISTORY_MISMATCH', 'Raw PARK record, mapping digest and independent lifecycle disposition disagree.', { eventId: park.event_id });
  }
  const outboxRows = db.prepare('SELECT o.event_id, o.transition_sequence, o.payload_json, o.payload_digest, t.current_hash FROM outbox_events o JOIN transitions t ON t.sequence=o.transition_sequence ORDER BY o.transition_sequence').all();
  if (outboxRows.length !== rows.length) throw new LedgerError('OUTBOX_GAP', 'Every committed transition must have exactly one outbox event.', { transitions: rows.length, outbox: outboxRows.length });
  for (let i = 0; i < outboxRows.length; i += 1) {
    const row = outboxRows[i];
    if (row.transition_sequence !== rows[i].sequence || row.event_id !== rows[i].event_id || digest(row.payload_json) !== row.payload_digest) throw new LedgerError('OUTBOX_MISMATCH', 'Outbox event is missing, reordered or has changed bytes.', { sequence: row.transition_sequence });
    const transition = rows[i];
    const expectedPayload = json({ eventId: transition.event_id, sequence: transition.sequence, hash: transition.current_hash, type: transition.event_type, data: transition.record });
    if (row.payload_json !== expectedPayload) throw new LedgerError('OUTBOX_TRANSITION_MISMATCH', 'Outbox payload differs from its exact hashed transition.', { sequence: row.transition_sequence });
  }
  const inbox = db.prepare('SELECT i.*,a.application_json FROM consumer_inbox i LEFT JOIN consumer_applications a ON a.application_id=i.application_id ORDER BY i.consumer_id,i.event_id').all();
  const apps = db.prepare('SELECT * FROM consumer_applications ORDER BY consumer_id,event_id').all();
  if (inbox.length !== apps.length || inbox.some((row) => row.application_json == null)) throw new LedgerError('CONSUMER_INBOX_EFFECT_MISMATCH', 'Consumer inbox and actual durable application rows are not one-to-one.');
  const latestConsumer = new Map();
  for (const row of inbox) {
    const outbox = db.prepare('SELECT payload_digest FROM outbox_events WHERE event_id=?').get(row.event_id);
    if (!outbox || outbox.payload_digest !== row.payload_digest) throw new LedgerError('CONSUMER_INBOX_EFFECT_MISMATCH', 'Consumer inbox receipt does not bind the exact outbox payload.', { consumerId: row.consumer_id, eventId: row.event_id });
    let application;
    try { application = JSON.parse(row.application_json); } catch { throw new LedgerError('CONSUMER_APPLICATION_MALFORMED', 'Consumer application row is malformed.', { applicationId: row.application_id }); }
    if (json(application) !== row.application_json || application.consumerId !== row.consumer_id || application.eventId !== row.event_id || application.payloadDigest !== row.payload_digest) throw new LedgerError('CONSUMER_INBOX_EFFECT_MISMATCH', 'Actual application bytes do not match the transactional inbox receipt.', { applicationId: row.application_id });
    const node = application.node;
    if (node?.nodeId && Number.isSafeInteger(node.acceptanceRevision) && Number.isSafeInteger(application.version)) {
      const key = `${row.consumer_id}\u0000${node.nodeId}\u0000${node.acceptanceRevision}`;
      const previous = latestConsumer.get(key);
      if (!previous || application.version > previous.version) latestConsumer.set(key, { consumerId: row.consumer_id, nodeId: node.nodeId, acceptanceRevision: node.acceptanceRevision, status: application.status, version: application.version, lastEventId: row.event_id, updatedAt: application.appliedAt });
    }
  }
  const consumerProjection = db.prepare('SELECT * FROM consumer_node_state ORDER BY consumer_id,node_id,acceptance_revision').all();
  if (consumerProjection.length !== latestConsumer.size) throw new LedgerError('CONSUMER_EFFECT_PROJECTION_MISMATCH', 'Consumer effect projection row count differs from applied inbox history.');
  for (const row of consumerProjection) {
    const expected = latestConsumer.get(`${row.consumer_id}\u0000${row.node_id}\u0000${row.acceptance_revision}`);
    if (!expected || row.status !== expected.status || row.version !== expected.version || row.last_event_id !== expected.lastEventId) throw new LedgerError('CONSUMER_EFFECT_PROJECTION_MISMATCH', 'Consumer effect projection differs from actual local applications.', { consumerId: row.consumer_id, nodeId: row.node_id });
  }
  return { meta, rows, head: { sequence: meta.head_sequence, hash: meta.head_hash }, latest };
}

async function captureStateFiles(dbPath) {
  const files = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${dbPath}${suffix}`;
    try {
      const lstat = await fsp.lstat(source);
      if (!lstat.isFile() || lstat.isSymbolicLink()) throw new Error(`Unsafe ledger state component: ${source}`);
      const bytes = await fsp.readFile(source);
      files.push({ suffix: suffix || 'database', name: path.basename(source), bytes, present: true, sha256: digest(bytes) });
    } catch (error) {
      if (error.code === 'ENOENT') files.push({ suffix: suffix || 'database', name: path.basename(source), bytes: null, present: false, sha256: null });
      else throw error;
    }
  }
  return files;
}

function captureStateFilesSync(dbPath) {
  const files = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${dbPath}${suffix}`;
    try {
      const stat = fs.lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe ledger state component: ${source}`);
      const bytes = fs.readFileSync(source);
      files.push({ suffix: suffix || 'database', name: path.basename(source), bytes, present: true, sha256: digest(bytes) });
    } catch (error) {
      if (error.code === 'ENOENT') files.push({ suffix: suffix || 'database', name: path.basename(source), bytes: null, present: false, sha256: null });
      else throw error;
    }
  }
  return files;
}

async function preserveSnapshot(stage, files, directory = 'raw') {
  const manifestFiles = [];
  for (const file of files ?? []) {
    if (!file.present) {
      manifestFiles.push({ suffix: file.suffix, present: false, bytes: 0, sha256: null, snapshot: null });
      continue;
    }
    const target = path.join(stage, directory, file.name ?? `ledger.sqlite${file.suffix === 'database' ? '' : file.suffix}`);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const handle = await fsp.open(target, 'wx');
    try { await handle.writeFile(file.bytes); await handle.sync(); } finally { await handle.close(); }
    manifestFiles.push({ suffix: file.suffix, present: true, bytes: file.bytes.length, sha256: digest(file.bytes), snapshot: path.relative(stage, target).replaceAll(path.sep, '/') });
  }
  return manifestFiles;
}

async function quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason, detail = {}, originalIdentity = null, unexpectedCreation = false, preservedFiles = null, observedFiles = null }) {
  const final = quarantinePath(stateRoot, ledgerId);
  try {
    try {
      const existing = JSON.parse(await fsp.readFile(path.join(final, 'manifest.json'), 'utf8'));
      return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: true, persistence: 'DURABLE', quarantined: true, reason: existing.reason, manifest: existing };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(final);
    await fsp.mkdir(parent, { recursive: true });
    const stage = `${final}.stage-${randomUUID()}`;
    await fsp.mkdir(stage, { recursive: false });
    const captured = preservedFiles ?? await captureStateFiles(dbPath);
    const files = await preserveSnapshot(stage, captured, 'raw');
    const observed = observedFiles ? await preserveSnapshot(stage, observedFiles, 'observed') : null;
    const manifest = {
      format: 'wf02-independent-quarantine/v1', ledgerId, reason, detail,
      expectedPrefixAnchor: expectedPrefixAnchor ?? null, originalFileIdentity: originalIdentity,
      unexpectedCreation, preservedStateFiles: files, observedFailureStateFiles: observed,
      createdAt: new Date().toISOString(), preservation: 'Evidence snapshot only; never restored, repaired or opened for recovery.',
    };
    const manifestPath = path.join(stage, 'manifest.json');
    const manifestHandle = await fsp.open(manifestPath, 'wx');
    try { await manifestHandle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); await manifestHandle.sync(); } finally { await manifestHandle.close(); }
    try {
      await fsp.rename(stage, final);
    } catch (error) {
      try {
        const existing = JSON.parse(await fsp.readFile(path.join(final, 'manifest.json'), 'utf8'));
        return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: true, persistence: 'DURABLE', quarantined: true, reason: existing.reason, manifest: existing };
      } catch { throw error; }
    }
    return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: true, persistence: 'DURABLE', quarantined: true, reason, manifest };
  } catch (error) {
    return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: false, persistence: 'UNAVAILABLE', quarantined: false, reason, detail: { message: String(error?.message ?? error), requestedReason: reason } };
  }
}

function preserveSnapshotSync(stage, files, directory = 'raw') {
  const manifestFiles = [];
  for (const file of files ?? []) {
    if (!file.present) { manifestFiles.push({ suffix: file.suffix, present: false, bytes: 0, sha256: null, snapshot: null }); continue; }
    const target = path.join(stage, directory, file.name ?? `ledger.sqlite${file.suffix === 'database' ? '' : file.suffix}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const fd = fs.openSync(target, 'wx');
    try { fs.writeFileSync(fd, file.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    manifestFiles.push({ suffix: file.suffix, present: true, bytes: file.bytes.length, sha256: digest(file.bytes), snapshot: path.relative(stage, target).replaceAll(path.sep, '/') });
  }
  return manifestFiles;
}

function quarantineStoreSync({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason, detail = {}, originalIdentity = null, preservedFiles = null }) {
  const final = quarantinePath(stateRoot, ledgerId);
  try {
    if (fs.existsSync(final)) {
      const existing = JSON.parse(fs.readFileSync(path.join(final, 'manifest.json'), 'utf8'));
      return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: true, persistence: 'DURABLE', quarantined: true, reason: existing.reason, manifest: existing };
    }
    fs.mkdirSync(path.dirname(final), { recursive: true });
    const stage = `${final}.stage-${randomUUID()}`;
    fs.mkdirSync(stage, { recursive: false });
    const preservedStateFiles = preserveSnapshotSync(stage, preservedFiles ?? captureStateFilesSync(dbPath), 'raw');
    const manifest = { format: 'wf02-independent-quarantine/v1', ledgerId, reason, detail, expectedPrefixAnchor, originalFileIdentity: originalIdentity, unexpectedCreation: false, preservedStateFiles, observedFailureStateFiles: null, createdAt: new Date().toISOString(), preservation: 'Evidence snapshot only; never restored, repaired or opened for recovery.' };
    const fd = fs.openSync(path.join(stage, 'manifest.json'), 'wx');
    try { fs.writeFileSync(fd, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(stage, final);
    return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: true, persistence: 'DURABLE', quarantined: true, reason, manifest };
  } catch (error) {
    return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: false, persistence: 'UNAVAILABLE', quarantined: false, reason, detail: { message: String(error?.message ?? error), requestedReason: reason } };
  }
}

function makeResult(code, message, details = {}) { return { ok: false, code, message, durableWritePerformed: false, ...details }; }

function initialHash(ledgerId) { return digest(`zuri-delivery-ledger/v1/genesis/${ledgerId}`); }

export async function createLedger({ stateRoot, ledgerId, probe } = {}) {
  let db = null;
  let dbPath = null;
  let claimed = false;
  let claimedIdentity = null;
  let claimedFiles = null;
  let stateRootResolved = null;
  let ledgerKey = null;
  try {
    ledgerId = safeLedgerId(ledgerId);
    if (typeof stateRoot !== 'string' || !stateRoot.trim()) throw new LedgerError('INVALID_REQUEST', 'stateRoot is required.');
    stateRootResolved = path.resolve(stateRoot);
    ledgerKey = ledgerId;
    dbPath = databasePath(stateRootResolved, ledgerId);
    if (fs.existsSync(quarantinePath(stateRootResolved, ledgerId))) return makeResult('QUARANTINED', 'This ledger identity is independently quarantined; creation is disabled.');
    await fsp.mkdir(path.dirname(dbPath), { recursive: true });
    let claim;
    try { claim = await fsp.open(dbPath, 'wx'); } catch (error) {
      if (error.code === 'EEXIST') return makeResult('ALREADY_EXISTS', 'CREATE_ONLY refuses to overwrite or adopt an existing path.');
      throw error;
    }
    claimed = true;
    try { await claim.sync(); } finally { await claim.close(); }
    const claimStat = await identityAt(dbPath);
    if (!claimStat.exists || claimStat.unsafe) throw new LedgerError('CREATE_PATH_IDENTITY_CHANGED', 'The exclusive initial path disappeared or became unsafe.');
    claimedIdentity = claimStat.identity;
    claimedFiles = await captureStateFiles(dbPath);
    probeHook(probe, 'create.afterClaim', { ledgerId, dbPath, identity: claimedIdentity });
    db = new DatabaseSync(dbPath, { timeout: BUSY_TIMEOUT_MS, enableForeignKeyConstraints: true });
    const openedIdentity = await identityAt(dbPath);
    if (!openedIdentity.exists || openedIdentity.unsafe || !sameIdentity(claimedIdentity, openedIdentity.identity)) {
      throw new LedgerError('CREATE_PATH_IDENTITY_CHANGED', 'CREATE_ONLY path identity changed between exclusive claim and SQLite open.', { claimedIdentity, openedIdentity });
    }
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
    const journal = db.prepare('PRAGMA journal_mode').get()?.journal_mode;
    const synchronous = db.prepare('PRAGMA synchronous').get()?.synchronous;
    if (String(journal).toLowerCase() !== 'wal' || synchronous !== 2) throw new LedgerError('PRAGMA_UNAVAILABLE', 'SQLite did not apply WAL with synchronous=FULL.', { journal, synchronous });
    const schema = fs.readFileSync(new URL('./contracts/ledger.sql', import.meta.url), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(schema);
      const now = new Date().toISOString();
      db.prepare('INSERT INTO ledger_meta(singleton,schema_version,ledger_id,created_at,head_sequence,head_hash) VALUES(1,?,?,?,?,?)')
        .run(LEDGER_SCHEMA_VERSION, ledgerId, now, 0, initialHash(ledgerId));
      probeHook(probe, 'create.beforeCommit', { ledgerId, dbPath, identity: claimedIdentity });
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    checkIntegrity(db);
    checkHistory(db, ledgerId, { sequence: 0, hash: initialHash(ledgerId) });
    const identity = await identityAt(dbPath);
    if (!identity.exists || identity.unsafe || !sameIdentity(claimedIdentity, identity.identity)) throw new LedgerError('CREATE_PATH_IDENTITY_CHANGED', 'CREATE_ONLY path identity changed while initializing.', { claimedIdentity, currentIdentity: identity });
    probeHook(probe, 'create.afterCommit', { ledgerId, dbPath, identity: identity.identity });
    return { ok: true, code: 'CREATED', ledger: new Ledger({ db, dbPath, stateRoot: stateRootResolved, ledgerId, identity: identity.identity, trustedAnchor: { sequence: 0, hash: initialHash(ledgerId) }, probe }), anchor: { sequence: 0, hash: initialHash(ledgerId) }, durableWritePerformed: true };
  } catch (error) {
    const failure = sqliteError(error);
    let failureFiles = null;
    try { if (claimed && dbPath) failureFiles = await captureStateFiles(dbPath); } catch {}
    try { db?.close(); } catch {}
    if (claimed && dbPath && stateRootResolved && ledgerKey) {
      let observedFiles = null;
      try { observedFiles = await captureStateFiles(dbPath); } catch {}
      const preserveOriginal = failure.code === 'CREATE_PATH_IDENTITY_CHANGED' ? claimedFiles : failureFiles;
      const quarantine = await quarantineStore({
        stateRoot: stateRootResolved, ledgerId: ledgerKey, dbPath,
        expectedPrefixAnchor: { sequence: 0, hash: initialHash(ledgerKey) },
        reason: 'CREATE_INITIALIZATION_FAILURE',
        detail: { failureCode: failure.code, failureMessage: failure.message, failureDetails: failure.details, claimedIdentity, currentIdentity: await identityAt(dbPath) },
        originalIdentity: claimedIdentity, unexpectedCreation: failure.code === 'CREATE_PATH_IDENTITY_CHANGED',
        preservedFiles: preserveOriginal ?? failureFiles, observedFiles,
      });
      return { ...quarantine, path: dbPath, incompleteStoreRetained: true, initializationFailure: { code: failure.code, message: failure.message, details: failure.details } };
    }
    return makeResult(failure.code ?? 'CREATE_FAILED', failure.message, failure.details);
  }
}
function validateCallerAnchor(expectedLedgerId, expectedPrefixAnchor) {
  if (typeof expectedLedgerId !== 'string' || !expectedLedgerId.trim()) throw new LedgerError('CALLER_INPUT_REQUIRED', 'expectedLedgerId is mandatory on reopen.');
  if (!expectedPrefixAnchor || !Number.isSafeInteger(expectedPrefixAnchor.sequence) || expectedPrefixAnchor.sequence < 0 || !HEX_DIGEST.test(expectedPrefixAnchor.hash ?? '')) {
    throw new LedgerError('CALLER_INPUT_REQUIRED', 'expectedPrefixAnchor {sequence, hash} is mandatory and must be well-formed.');
  }
}

export async function openLedger({ stateRoot, ledgerId, expectedLedgerId, expectedPrefixAnchor, probe } = {}) {
  let dbPath;
  let beforeIdentity = null;
  try {
    validateCallerAnchor(expectedLedgerId, expectedPrefixAnchor);
    if (typeof stateRoot !== 'string' || !stateRoot.trim()) throw new LedgerError('CALLER_INPUT_REQUIRED', 'stateRoot is required.');
    ledgerId = safeLedgerId(ledgerId ?? expectedLedgerId);
    if (ledgerId !== expectedLedgerId) return makeResult('LEDGER_ID_MISMATCH', 'Expected ledger identity differs from the selected local ledger key; no store was opened or changed.');
    stateRoot = path.resolve(stateRoot);
    dbPath = databasePath(stateRoot, ledgerId);
    if (fs.existsSync(quarantinePath(stateRoot, ledgerId))) return makeResult('QUARANTINED', 'This ledger identity is independently quarantined; reopen and writes are disabled.');
    const before = await identityAt(dbPath);
    if (!before.exists || before.unsafe) {
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: before.unsafe ? 'UNSAFE_STATE_PATH' : 'MISSING_LEDGER_HISTORY', detail: { before }, originalIdentity: before.identity });
    }
    beforeIdentity = before.identity;
    const preservedFiles = await captureStateFiles(dbPath);
    const afterCapture = await identityAt(dbPath);
    if (!afterCapture.exists || !sameIdentity(beforeIdentity, afterCapture.identity)) {
      const observedFiles = await captureStateFiles(dbPath);
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: 'RESUME_PATH_IDENTITY_CHANGED', detail: { beforeIdentity, afterCapture }, originalIdentity: beforeIdentity, preservedFiles, observedFiles });
    }
    let ro;
    try { ro = new DatabaseSync(dbPath, { readOnly: true, timeout: BUSY_TIMEOUT_MS, enableForeignKeyConstraints: true }); }
    catch (error) {
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: 'READ_ONLY_OPEN_FAILURE', detail: { message: String(error?.message ?? error) }, originalIdentity: beforeIdentity, preservedFiles });
    }
    let validated;
    try {
      validated = readSnapshot(ro, expectedLedgerId, expectedPrefixAnchor);
    } catch (error) {
      ro.close();
      if (error.code === 'LEDGER_ID_MISMATCH') return makeResult(error.code, error.message, error.details);
      if (error.code === 'CALLER_INPUT_REQUIRED') return makeResult(error.code, error.message, error.details);
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: error.code ?? 'HISTORY_INVALID', detail: { message: error.message, details: error.details }, originalIdentity: beforeIdentity, preservedFiles });
    }
    probeHook(probe, 'resume.afterReadonlyValidation', { ledgerId: expectedLedgerId, dbPath, identity: beforeIdentity, head: validated.head });
    const beforeWritable = await identityAt(dbPath);
    if (!beforeWritable.exists || beforeWritable.unsafe || !sameIdentity(beforeIdentity, beforeWritable.identity)) {
      ro.close();
      const observedFiles = await captureStateFiles(dbPath);
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: 'RESUME_PATH_IDENTITY_CHANGED', detail: { checkedIdentity: beforeIdentity, preWritableIdentity: beforeWritable, unexpectedCreation: false }, originalIdentity: beforeIdentity, preservedFiles, observedFiles });
    }
    let rw;
    try { rw = new DatabaseSync(dbPath, { timeout: BUSY_TIMEOUT_MS, enableForeignKeyConstraints: true }); }
    catch (error) {
      ro.close();
      const afterFailedOpen = await identityAt(dbPath);
      const observedFiles = await captureStateFiles(dbPath);
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: 'WRITABLE_OPEN_FAILURE', detail: { message: String(error?.message ?? error), beforeIdentity, afterFailedOpen }, originalIdentity: beforeIdentity, unexpectedCreation: !beforeWritable.exists && afterFailedOpen.exists, preservedFiles, observedFiles });
    }
    const afterWritable = await identityAt(dbPath);
    if (!afterWritable.exists || afterWritable.unsafe || !sameIdentity(beforeIdentity, afterWritable.identity)) {
      try { rw.close(); } catch {}
      ro.close();
      const observedFiles = await captureStateFiles(dbPath);
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: 'RESUME_PATH_IDENTITY_CHANGED', detail: { checkedIdentity: beforeIdentity, afterWritableIdentity: afterWritable }, originalIdentity: beforeIdentity, unexpectedCreation: true, preservedFiles, observedFiles });
    }
    let postOpenRo;
    try {
      postOpenRo = new DatabaseSync(dbPath, { readOnly: true, timeout: BUSY_TIMEOUT_MS, enableForeignKeyConstraints: true });
      const afterValidation = readSnapshot(postOpenRo, expectedLedgerId, expectedPrefixAnchor);
      if (afterValidation.head.sequence < validated.head.sequence || (afterValidation.head.sequence === validated.head.sequence && afterValidation.head.hash !== validated.head.hash)) throw new LedgerError('REOPEN_CHANGED', 'Ledger history moved backwards or changed at an observed sequence while reopening.');
    } catch (error) {
      try { postOpenRo?.close(); } catch {}
      try { rw.close(); } catch {}
      ro.close();
      if (error.code === 'LEDGER_ID_MISMATCH') return makeResult(error.code, error.message, error.details);
      const observedFiles = await captureStateFiles(dbPath);
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: error.code ?? 'POST_OPEN_REVALIDATION_FAILURE', detail: { message: error.message, details: error.details }, originalIdentity: beforeIdentity, preservedFiles, observedFiles });
    }
    postOpenRo.close();
    ro.close();
    const finalIdentity = await identityAt(dbPath);
    if (!finalIdentity.exists || !sameIdentity(beforeIdentity, finalIdentity.identity)) {
      rw.close();
      const observedFiles = await captureStateFiles(dbPath);
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: 'RESUME_PATH_IDENTITY_CHANGED', detail: { checkedIdentity: beforeIdentity, finalIdentity }, originalIdentity: beforeIdentity, preservedFiles, observedFiles });
    }
    try {
      rw.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
      const journal = rw.prepare('PRAGMA journal_mode').get()?.journal_mode;
      const synchronous = rw.prepare('PRAGMA synchronous').get()?.synchronous;
      if (String(journal).toLowerCase() !== 'wal' || synchronous !== 2) throw new LedgerError('PRAGMA_UNAVAILABLE', 'SQLite did not apply WAL with synchronous=FULL.', { journal, synchronous });
      const final = readSnapshot(rw, expectedLedgerId, expectedPrefixAnchor);
      return { ok: true, code: 'OPENED', ledger: new Ledger({ db: rw, dbPath, stateRoot, ledgerId, identity: finalIdentity.identity, trustedAnchor: expectedPrefixAnchor, probe }), anchor: final.head, durableWritePerformed: false };
    } catch (error) {
      rw.close();
      const observedFiles = await captureStateFiles(dbPath);
      return await quarantineStore({ stateRoot, ledgerId, dbPath, expectedPrefixAnchor, reason: error.code ?? 'POST_PRAGMA_INTEGRITY_FAILURE', detail: { message: error.message, details: error.details }, originalIdentity: beforeIdentity, preservedFiles, observedFiles });
    }
  } catch (error) {
    const e = sqliteError(error);
    return makeResult(e.code, e.message, e.details);
  }
}

function metadataForNode(record) {
  return {
    nodeId: record.nodeId ?? record.node_id,
    acceptanceRevision: record.acceptanceRevision ?? record.acceptance_revision,
    packetId: record.packetId ?? record.packet_id,
    lineageId: record.lineageId ?? record.lineage_id,
  };
}

function validateRequestIdentity(input) {
  requiredText(input?.eventId, 'eventId');
  requiredText(input?.nodeId, 'nodeId');
  positiveInteger(input?.acceptanceRevision, 'acceptanceRevision');
}

function checkActorAndAssignment(state, input) {
  if (state.status === 'PARKED') throw new LedgerError('PARKED_FENCE', 'Local mutations are fenced after PARK.');
  if (state.assignment_id !== input.assignmentId) throw new LedgerError('ASSIGNMENT_MISMATCH', 'The action does not name the stored assignment.');
  if (state.assigned_actor !== input.actor) throw new LedgerError('ACTOR_MISMATCH', 'The actor assertion differs from the stored assignment actor.');
  requiredText(input.authorityReceiptRef, 'authorityReceiptRef');
}

function currentDigest(input, field, state = null) {
  const value = input[field] ?? state?.[`${field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`];
  return verifyDigest(value, field);
}

export class Ledger {
  constructor({ db, dbPath, stateRoot, ledgerId, identity, trustedAnchor, probe }) {
    this.db = db;
    this.dbPath = dbPath;
    this.stateRoot = stateRoot;
    this.ledgerId = ledgerId;
    this.identity = identity;
    this.trustedAnchor = trustedAnchor ?? { sequence: 0, hash: initialHash(ledgerId) };
    this.probe = probe;
    this.closed = false;
  }

  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
  _assertOpen() { if (this.closed) throw new LedgerError('CLOSED', 'Ledger connection is closed.'); }
  _identityQuarantineRefusal() {
    try {
      fs.lstatSync(quarantinePath(this.stateRoot, this.ledgerId));
      return makeResult('QUARANTINED', 'This ledger identity is independently quarantined; all open handles are fenced.', { quarantined: true });
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      return makeResult('QUARANTINE_STATE_UNAVAILABLE', 'The ledger identity quarantine state cannot be verified; the operation is refused.', { quarantineCheckFailed: true, errorCode: error.code ?? 'UNKNOWN' });
    }
  }
  _assertIdentityActive() {
    const refusal = this._identityQuarantineRefusal();
    if (refusal) throw new LedgerError(refusal.code, refusal.message, {
      quarantined: refusal.quarantined === true,
      quarantineCheckFailed: refusal.quarantineCheckFailed === true,
      errorCode: refusal.errorCode,
    });
  }
  _anchor() {
    const row = this.db.prepare('SELECT head_sequence, head_hash FROM ledger_meta WHERE singleton=1').get();
    return { sequence: row.head_sequence, hash: row.head_hash };
  }
  _tx(fn) {
    this._assertOpen();
    const initialRefusal = this._identityQuarantineRefusal();
    if (initialRefusal) return { ok: false, result: initialRefusal };
    let healthPhase = false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this._assertIdentityActive();
        healthPhase = true;
        checkIntegrity(this.db);
        const verified = checkHistory(this.db, this.ledgerId, this.trustedAnchor);
        this.trustedAnchor = verified.head;
        healthPhase = false;
        const value = fn();
        if (value?.durableWritePerformed) probeHook(this.probe, 'transaction.beforeCommit', { eventId: value.eventId ?? value.conflictEventId ?? null, eventType: value.eventType ?? value.code ?? null });
        this._assertIdentityActive();
        this.db.exec('COMMIT');
        const after = this._anchor();
        this.trustedAnchor = after;
        if (value?.durableWritePerformed && value.ok && !value.anchor) value.anchor = after;
        return { ok: true, value };
      } catch (error) {
        let stateSnapshot = null;
        const failureCode = sqliteError(error).code;
        const validationFailure = (healthPhase && failureCode !== 'BUSY') || ['TERMINAL_EVENT_ID_PAYLOAD_CONFLICT', 'TRUSTED_HEALTH_PREFIX_DIVERGENCE'].includes(failureCode);
        if (validationFailure) {
          try { stateSnapshot = captureStateFilesSync(this.dbPath); } catch {}
        }
        try { this.db.exec('ROLLBACK'); } catch {}
        if (validationFailure) {
          try { this.db.close(); } catch {}
          this.closed = true;
          return { ok: false, result: quarantineStoreSync({ stateRoot: this.stateRoot, ledgerId: this.ledgerId, dbPath: this.dbPath, expectedPrefixAnchor: failureCode === 'TRUSTED_HEALTH_PREFIX_DIVERGENCE' ? error.details.expectedPrefixAnchor : this.trustedAnchor, reason: error.code ?? 'HISTORY_INVALID', detail: { message: error.message, details: error.details }, originalIdentity: this.identity, preservedFiles: stateSnapshot }) };
        }
        throw error;
      }
    } catch (error) {
      const e = sqliteError(error);
      if (e.code === 'BUSY') return { ok: false, result: makeResult('BUSY', e.message, e.details) };
      if (e instanceof LedgerError) return { ok: false, result: makeResult(e.code, e.message, e.details) };
      return { ok: false, result: makeResult(e.code, e.message, e.details) };
    }
  }
  _append(event) {
    const meta = this.db.prepare('SELECT head_sequence, head_hash FROM ledger_meta WHERE singleton=1').get();
    const sequence = meta.head_sequence + 1;
    const createdAt = new Date().toISOString();
    const recordJson = json(event.record);
    const previousHash = meta.head_hash;
    const currentHash = hashObject({ sequence, previousHash, eventId: event.eventId, requestDigest: event.requestDigest, eventType: event.eventType, recordJson, createdAt });
    this.db.prepare('INSERT INTO transitions(sequence,previous_hash,current_hash,event_id,request_digest,event_type,record_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(sequence, previousHash, currentHash, event.eventId, event.requestDigest, event.eventType, recordJson, createdAt);
    const payload = { eventId: event.eventId, sequence, hash: currentHash, type: event.eventType, data: event.record };
    const payloadJson = json(payload);
    this.db.prepare('INSERT INTO outbox_events(event_id,transition_sequence,payload_json,payload_digest,created_at) VALUES(?,?,?,?,?)')
      .run(event.eventId, sequence, payloadJson, digest(payloadJson), createdAt);
    this.db.prepare('UPDATE ledger_meta SET head_sequence=?, head_hash=? WHERE singleton=1').run(sequence, currentHash);
    return { sequence, hash: currentHash, previousHash, createdAt, payload, payloadDigest: digest(payloadJson) };
  }
  _recordRequest(eventId, requestDigest, requestJson, outcome, sequence = null) {
    const createdAt = new Date().toISOString();
    this.db.prepare('INSERT INTO requests(event_id,request_digest,request_json,outcome_json,transition_sequence,created_at) VALUES(?,?,?,?,?,?)')
      .run(eventId, requestDigest, requestJson, json(outcome), sequence, createdAt);
  }
  _request(input) {
    requiredText(input?.eventId, 'eventId');
    const requestJson = json(input);
    return { eventId: input.eventId, requestJson, requestDigest: digest(requestJson) };
  }
  _replayFast(request) {
    // All replay claims go through _tx health and a consistent SQLite snapshot.
    return null;
  }
  _replayInTransaction(request) {
    const original = this.db.prepare('SELECT request_digest, request_json, outcome_json, transition_sequence FROM requests WHERE event_id=?').get(request.eventId);
    if (!original) return null;
    if (original.request_digest === request.requestDigest) return { ...JSON.parse(original.outcome_json), replay: true, durableWritePerformed: false };
    const priorConflict = this.db.prepare('SELECT transition_sequence, conflict_event_id FROM request_conflicts WHERE original_event_id=? AND conflicting_digest=?').get(request.eventId, request.requestDigest);
    if (priorConflict) return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: false, conflictReplay: true, originalEventId: request.eventId, conflictEventId: priorConflict.conflict_event_id, sequence: priorConflict.transition_sequence, anchor: this._anchor() };
    const originalRequest = JSON.parse(original.request_json);
    const nodeKey = { nodeId: originalRequest.nodeId, acceptanceRevision: originalRequest.acceptanceRevision };
    if (!nodeKey.nodeId || !Number.isSafeInteger(nodeKey.acceptanceRevision)) return makeResult('NEEDS_DECISION', 'Conflicting event bytes found but the retained request lacks node identity.');
    const state = this.db.prepare('SELECT * FROM node_state WHERE node_id=? AND acceptance_revision=?').get(nodeKey.nodeId, nodeKey.acceptanceRevision);
    if (!state) return makeResult('NEEDS_DECISION', 'Conflicting event bytes found but no matching projection exists.', { originalEventId: request.eventId });
    if (TERMINAL.has(state.status)) throw new LedgerError('TERMINAL_EVENT_ID_PAYLOAD_CONFLICT', 'Conflicting replay cannot rewrite a terminal lifecycle disposition.', { originalEventId: request.eventId, originalDigest: original.request_digest, attemptedDigest: request.requestDigest, originalRequestJson: original.request_json, attemptedRequestJson: request.requestJson, nodeId: nodeKey.nodeId, acceptanceRevision: nodeKey.acceptanceRevision, terminalStatus: state.status });
    const conflictEventId = `event-conflict:${digest(`${request.eventId}\u0000${request.requestDigest}`)}`;
    const version = state.version + 1;
    const record = this._fullRecord({
      node: nodeKey, state, beforeState: state.status, afterState: 'NEEDS_DECISION', version,
      actor: 'local-ledger-conflict-detector', authorityReceiptRef: state.authority_receipt_ref,
      eventId: conflictEventId, requestDigest: request.requestDigest, lifecycleRunDisposition: 'NEEDS_DECISION',
      details: { originalEventId: request.eventId, originalDigest: original.request_digest, attemptedDigest: request.requestDigest, originalRequestJson: original.request_json, attemptedRequestJson: request.requestJson },
    });
    const appended = this._append({ eventId: conflictEventId, requestDigest: request.requestDigest, eventType: 'EVENT_ID_PAYLOAD_CONFLICT', record });
    const changed = this.db.prepare("UPDATE node_state SET status='NEEDS_DECISION', version=?, run_disposition='NEEDS_DECISION', updated_at=? WHERE node_id=? AND acceptance_revision=? AND version=?")
      .run(version, appended.createdAt, nodeKey.nodeId, nodeKey.acceptanceRevision, state.version);
    if (Number(changed.changes) !== 1) throw new LedgerError('CAS_MISMATCH', 'Node changed while recording event conflict.');
    this.db.prepare('INSERT INTO request_conflicts(original_event_id,conflicting_digest,conflicting_request_json,conflict_event_id,transition_sequence,created_at) VALUES(?,?,?,?,?,?)')
      .run(request.eventId, request.requestDigest, request.requestJson, conflictEventId, appended.sequence, appended.createdAt);
    return { ok: false, code: 'NEEDS_DECISION', durableWritePerformed: true, originalEventId: request.eventId, conflictEventId, sequence: appended.sequence, anchor: { sequence: appended.sequence, hash: appended.hash } };
  }
  _fullRecord({ node, state, beforeState, afterState, version, actor, authorityReceiptRef, eventId, requestDigest, attempt, planDigest, policyDigest, inputDigest, outputDigest, assignmentId, lifecycleRunDisposition = null, details = {} }) {
    return {
      eventId, requestDigest, node: { nodeId: node.nodeId, acceptanceRevision: node.acceptanceRevision, packetId: node.packetId ?? state?.packet_id, lineageId: node.lineageId ?? state?.lineage_id },
      beforeState, afterState, version, attempt: attempt ?? state?.attempt, assignmentId: assignmentId ?? state?.assignment_id,
      actor, authorityReceiptRef,
      planDigest: planDigest ?? state?.plan_digest, policyDigest: policyDigest ?? state?.policy_digest,
      inputDigest: inputDigest ?? state?.input_digest, outputDigest: outputDigest ?? state?.output_digest,
      lifecycleRunDisposition, details,
    };
  }
  _commitOutcome({ request, eventType, record, outcome, stateMutation }) {
    const appended = this._append({ eventId: request.eventId, requestDigest: request.requestDigest, eventType, record });
    stateMutation?.(appended);
    const result = { ok: true, code: 'COMMITTED', eventId: request.eventId, requestDigest: request.requestDigest, eventType, sequence: appended.sequence, hash: appended.hash, anchor: { sequence: appended.sequence, hash: appended.hash }, receipt: outcome, durableWritePerformed: true };
    this._recordRequest(request.eventId, request.requestDigest, request.requestJson, result, appended.sequence);
    return result;
  }

  admit(input) {
    let request;
    try {
      validateRequestIdentity(input);
      positiveInteger(input.attempt, 'attempt');
      positiveInteger(input.acceptanceRevision, 'acceptanceRevision');
      if (input.expectedVersion !== 0) throw new LedgerError('INVALID_REQUEST', 'Initial admission requires expectedVersion 0.');
      requiredText(input.packetId, 'packetId'); requiredText(input.lineageId, 'lineageId');
      requiredText(input.assignmentId, 'assignmentId'); requiredText(input.actor, 'actor'); requiredText(input.authorityReceiptRef, 'authorityReceiptRef');
      verifyDigest(input.planDigest, 'planDigest'); verifyDigest(input.policyDigest, 'policyDigest'); verifyDigest(input.inputDigest, 'inputDigest'); verifyDigest(input.outputDigest, 'outputDigest');
      request = this._request(input);
    } catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
    const replay = this._replayFast(request);
    if (replay) return replay.result;
    const transaction = this._tx(() => {
      const inTransactionReplay = this._replayInTransaction(request);
      if (inTransactionReplay) return inTransactionReplay;
      const state = this.db.prepare('SELECT * FROM node_state WHERE node_id=? AND acceptance_revision=?').get(input.nodeId, input.acceptanceRevision);
      if (state) {
        if (TERMINAL.has(state.status)) return makeResult(state.status === 'PARKED' ? 'PARKED_FENCE' : 'TERMINAL', 'This terminal key cannot be readmitted.');
        return makeResult('CAS_MISMATCH', 'This node/revision already has its immutable assignment; a losing admission makes no write.', { actualVersion: state.version });
      }
      const now = new Date().toISOString();
      const version = 1;
      const record = this._fullRecord({ node: input, state: null, beforeState: null, afterState: 'READY', version, actor: input.actor, authorityReceiptRef: input.authorityReceiptRef, eventId: input.eventId, requestDigest: request.requestDigest, attempt: input.attempt, planDigest: input.planDigest, policyDigest: input.policyDigest, inputDigest: input.inputDigest, outputDigest: input.outputDigest, assignmentId: input.assignmentId, details: { packetId: input.packetId, lineageId: input.lineageId } });
      const appended = this._append({ eventId: input.eventId, requestDigest: request.requestDigest, eventType: 'ADMITTED', record });
      this.db.prepare(`INSERT INTO node_state(node_id,acceptance_revision,packet_id,lineage_id,status,version,attempt,assignment_id,assigned_actor,authority_receipt_ref,plan_digest,policy_digest,input_digest,output_digest,run_disposition,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`).run(input.nodeId, input.acceptanceRevision, input.packetId, input.lineageId, 'READY', version, input.attempt, input.assignmentId, input.actor, input.authorityReceiptRef, input.planDigest, input.policyDigest, input.inputDigest, input.outputDigest, appended.createdAt);
      this.db.prepare('INSERT INTO assignments(assignment_id,node_id,acceptance_revision,attempt,actor,authority_receipt_ref,created_event_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(input.assignmentId, input.nodeId, input.acceptanceRevision, input.attempt, input.actor, input.authorityReceiptRef, input.eventId, appended.createdAt);
      const result = { ok: true, code: 'COMMITTED', eventId: input.eventId, requestDigest: request.requestDigest, eventType: 'ADMITTED', sequence: appended.sequence, hash: appended.hash, anchor: { sequence: appended.sequence, hash: appended.hash }, receipt: { status: 'READY', version, attempt: input.attempt, assignmentId: input.assignmentId }, durableWritePerformed: true };
      this._recordRequest(input.eventId, request.requestDigest, request.requestJson, result, appended.sequence);
      return result;
    });
    return transaction.ok ? transaction.value : transaction.result;
  }

  transition(input) {
    let request;
    try {
      validateRequestIdentity(input); positiveInteger(input.expectedVersion, 'expectedVersion');
      requiredText(input.assignmentId, 'assignmentId'); requiredText(input.actor, 'actor'); requiredText(input.authorityReceiptRef, 'authorityReceiptRef');
      if (!TRANSITIONS.has(input.toStatus)) throw new LedgerError('INVALID_REQUEST', 'toStatus is unsupported.');
      for (const field of ['planDigest', 'policyDigest', 'inputDigest', 'outputDigest']) if (input[field] !== undefined) verifyDigest(input[field], field);
      request = this._request(input);
    } catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
    const replay = this._replayFast(request);
    if (replay) return replay.result;
    const transaction = this._tx(() => {
      const inTransactionReplay = this._replayInTransaction(request);
      if (inTransactionReplay) return inTransactionReplay;
      const state = this.db.prepare('SELECT * FROM node_state WHERE node_id=? AND acceptance_revision=?').get(input.nodeId, input.acceptanceRevision);
      if (!state) return makeResult('NOT_FOUND', 'Node/revision has no admitted history.');
      checkActorAndAssignment(state, input);
      if (state.version !== input.expectedVersion) return makeResult('CAS_MISMATCH', 'Expected version does not match the current projection.', { actualVersion: state.version });
      if (!TRANSITIONS.get(state.status)?.has(input.toStatus)) return makeResult('INVALID_TRANSITION', `Transition ${state.status} -> ${input.toStatus} is not allowed.`, { status: state.status });
      const version = state.version + 1;
      const fields = {
        planDigest: input.planDigest ?? state.plan_digest, policyDigest: input.policyDigest ?? state.policy_digest,
        inputDigest: input.inputDigest ?? state.input_digest, outputDigest: input.outputDigest ?? state.output_digest,
      };
      const record = this._fullRecord({ node: metadataForNode(state), state, beforeState: state.status, afterState: input.toStatus, version, actor: input.actor, authorityReceiptRef: input.authorityReceiptRef, eventId: input.eventId, requestDigest: request.requestDigest, ...fields, lifecycleRunDisposition: input.toStatus === 'NEEDS_DECISION' ? 'NEEDS_DECISION' : null, details: { authority: input.authority ?? null, evidence: input.evidence ?? null } });
      return this._commitOutcome({ request, eventType: `LIFECYCLE_${input.toStatus}`, record, outcome: { status: input.toStatus, version }, stateMutation: (a) => this.db.prepare('UPDATE node_state SET status=?,version=?,authority_receipt_ref=?,plan_digest=?,policy_digest=?,input_digest=?,output_digest=?,run_disposition=?,updated_at=? WHERE node_id=? AND acceptance_revision=? AND version=?')
        .run(input.toStatus, version, input.authorityReceiptRef, fields.planDigest, fields.policyDigest, fields.inputDigest, fields.outputDigest, input.toStatus === 'NEEDS_DECISION' ? 'NEEDS_DECISION' : null, a.createdAt, input.nodeId, input.acceptanceRevision, state.version) });
    });
    return transaction.ok ? transaction.value : transaction.result;
  }

  bindCanonicalPr(input) {
    let request;
    try {
      validateRequestIdentity(input); positiveInteger(input.expectedVersion, 'expectedVersion');
      requiredText(input.assignmentId, 'assignmentId'); requiredText(input.actor, 'actor'); requiredText(input.authorityReceiptRef, 'authorityReceiptRef');
      requiredText(input.observedReceiptRef, 'observedReceiptRef');
      if (!input.pr || typeof input.pr !== 'object' || Array.isArray(input.pr)) throw new LedgerError('INVALID_REQUEST', 'pr must be an identity object already observed by the caller.');
      request = this._request(input);
    } catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
    const replay = this._replayFast(request);
    if (replay) return replay.result;
    const transaction = this._tx(() => {
      const inTransactionReplay = this._replayInTransaction(request);
      if (inTransactionReplay) return inTransactionReplay;
      const state = this.db.prepare('SELECT * FROM node_state WHERE node_id=? AND acceptance_revision=?').get(input.nodeId, input.acceptanceRevision);
      if (!state) return makeResult('NOT_FOUND', 'Node/revision has no admitted history.');
      checkActorAndAssignment(state, input);
      if (state.version !== input.expectedVersion) return makeResult('CAS_MISMATCH', 'Expected version does not match the current projection.', { actualVersion: state.version });
      if (TERMINAL.has(state.status)) return makeResult('TERMINAL', 'Canonical PR binding is closed after terminal disposition.');
      const stored = this.db.prepare('SELECT pr_json, observed_receipt_ref, event_id FROM canonical_pr WHERE node_id=? AND acceptance_revision=?').get(input.nodeId, input.acceptanceRevision);
      const wantedPr = json(input.pr);
      if (stored) {
        if (stored.pr_json === wantedPr && stored.observed_receipt_ref === input.observedReceiptRef) {
          const result = { ok: true, code: 'EXISTING_CANONICAL_PR', eventId: stored.event_id, durableWritePerformed: true, canonicalPr: JSON.parse(stored.pr_json) };
          this._recordRequest(input.eventId, request.requestDigest, request.requestJson, result, null);
          return result;
        }
        const version = state.version + 1;
        const record = this._fullRecord({ node: metadataForNode(state), state, beforeState: state.status, afterState: 'NEEDS_DECISION', version, actor: input.actor, authorityReceiptRef: input.authorityReceiptRef, eventId: input.eventId, requestDigest: request.requestDigest, lifecycleRunDisposition: 'NEEDS_DECISION', details: { conflict: 'CANONICAL_PR_IMMUTABLE', originalPrJson: stored.pr_json, attemptedPrJson: wantedPr, originalReceiptRef: stored.observed_receipt_ref, attemptedReceiptRef: input.observedReceiptRef } });
        return this._commitOutcome({ request, eventType: 'CANONICAL_PR_CONFLICT', record, outcome: { status: 'NEEDS_DECISION', canonicalPrPreserved: true }, stateMutation: (a) => this.db.prepare("UPDATE node_state SET status='NEEDS_DECISION',version=?,authority_receipt_ref=?,run_disposition='NEEDS_DECISION',updated_at=? WHERE node_id=? AND acceptance_revision=? AND version=?").run(version, input.authorityReceiptRef, a.createdAt, input.nodeId, input.acceptanceRevision, state.version) });
      }
      const version = state.version + 1;
      const record = this._fullRecord({ node: metadataForNode(state), state, beforeState: state.status, afterState: state.status, version, actor: input.actor, authorityReceiptRef: input.authorityReceiptRef, eventId: input.eventId, requestDigest: request.requestDigest, details: { canonicalPr: input.pr, observedReceiptRef: input.observedReceiptRef } });
      const outcome = this._commitOutcome({ request, eventType: 'CANONICAL_PR_BOUND', record, outcome: { canonicalPr: input.pr, version }, stateMutation: (a) => {
        this.db.prepare('INSERT INTO canonical_pr(node_id,acceptance_revision,pr_json,observed_receipt_ref,event_id,created_at) VALUES(?,?,?,?,?,?)').run(input.nodeId, input.acceptanceRevision, wantedPr, input.observedReceiptRef, input.eventId, a.createdAt);
        this.db.prepare('UPDATE node_state SET version=?,authority_receipt_ref=?,updated_at=? WHERE node_id=? AND acceptance_revision=? AND version=?').run(version, input.authorityReceiptRef, a.createdAt, input.nodeId, input.acceptanceRevision, state.version);
      } });
      return outcome;
    });
    return transaction.ok ? transaction.value : transaction.result;
  }

  park(input) {
    let request;
    let rawRecordJson;
    try {
      validateRequestIdentity(input); positiveInteger(input.expectedVersion, 'expectedVersion');
      requiredText(input.assignmentId, 'assignmentId'); requiredText(input.actor, 'actor'); requiredText(input.authorityReceiptRef, 'authorityReceiptRef');
      if (input.mappingDigest !== PARK_MAPPING_DIGEST) throw new LedgerError('PARK_MAP_MISMATCH', 'PARK mappingDigest does not match the sealed WF01 map.');
      if (!input.record || typeof input.record !== 'object' || Array.isArray(input.record)) throw new LedgerError('INVALID_REQUEST', 'The complete raw PARK record is required.');
      rawRecordJson = JSON.stringify(input.record);
      for (const field of ['runId', 'nodeId', 'packetId', 'lineageId', 'failureClass', 'runDisposition', 'nodeState', 'effectState', 'canonicalCloseout', 'lastKnownGitHostState']) requiredText(input.record[field], `record.${field}`);
      for (const field of ['effectId', 'evidenceDigests', 'leaseEpoch', 'remainingLineageBudget']) if (!Object.hasOwn(input.record, field)) throw new LedgerError('INVALID_REQUEST', `record.${field} must be present in the raw PARK record.`);
      if (input.record.effectId !== null) requiredText(input.record.effectId, 'record.effectId');
      if (!Array.isArray(input.record.evidenceDigests) || input.record.evidenceDigests.some((value) => typeof value !== 'string' || !DIGEST.test(value))) throw new LedgerError('INVALID_REQUEST', 'record.evidenceDigests must retain the validated SHA-256 array.');
      if (input.record.leaseEpoch !== null && (!Number.isSafeInteger(input.record.leaseEpoch) || input.record.leaseEpoch < 0)) throw new LedgerError('INVALID_REQUEST', 'record.leaseEpoch must be null or a non-negative safe integer.');
      if (input.record.nodeId !== input.nodeId) throw new LedgerError('INVALID_REQUEST', 'PARK record nodeId must match its lifecycle key.');
      request = this._request(input);
    } catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
    const replay = this._replayFast(request);
    if (replay) return replay.result;
    const transaction = this._tx(() => {
      const inTransactionReplay = this._replayInTransaction(request);
      if (inTransactionReplay) return inTransactionReplay;
      const state = this.db.prepare('SELECT * FROM node_state WHERE node_id=? AND acceptance_revision=?').get(input.nodeId, input.acceptanceRevision);
      if (!state) return makeResult('NOT_FOUND', 'Node/revision has no admitted history.');
      checkActorAndAssignment(state, input);
      if (state.version !== input.expectedVersion) return makeResult('CAS_MISMATCH', 'Expected version does not match the current projection.', { actualVersion: state.version });
      if (TERMINAL.has(state.status)) return makeResult('TERMINAL', 'PARK cannot reopen an already terminal lifecycle disposition.');
      const version = state.version + 1;
      const record = this._fullRecord({ node: metadataForNode(state), state, beforeState: state.status, afterState: 'PARKED', version, actor: input.actor, authorityReceiptRef: input.authorityReceiptRef, eventId: input.eventId, requestDigest: request.requestDigest, lifecycleRunDisposition: input.record.runDisposition, details: { parkRecord: JSON.parse(rawRecordJson), mappingDigest: input.mappingDigest } });
      const outcome = this._commitOutcome({ request, eventType: 'PARKED', record, outcome: { lifecycleStatus: 'PARKED', runDisposition: input.record.runDisposition, rawParkRecord: JSON.parse(rawRecordJson), mappingDigest: input.mappingDigest, version }, stateMutation: (a) => {
        this.db.prepare("UPDATE node_state SET status='PARKED',version=?,run_disposition=?,updated_at=? WHERE node_id=? AND acceptance_revision=? AND version=?")
          .run(version, input.record.runDisposition, a.createdAt, input.nodeId, input.acceptanceRevision, state.version);
        this.db.prepare('INSERT INTO park_records(node_id,acceptance_revision,event_id,mapping_digest,raw_record_json,lifecycle_disposition,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(input.nodeId, input.acceptanceRevision, input.eventId, input.mappingDigest, rawRecordJson, 'PARKED', a.createdAt);
      } });
      return outcome;
    });
    return transaction.ok ? transaction.value : transaction.result;
  }

  pendingOutbox({ consumerId } = {}) {
    this._assertOpen();
    const initialRefusal = this._identityQuarantineRefusal();
    if (initialRefusal) return { ...initialRefusal, events: [] };
    try {
      let rows;
      if (consumerId) rows = this.db.prepare(`SELECT o.* FROM outbox_events o LEFT JOIN consumer_inbox i ON i.event_id=o.event_id AND i.consumer_id=? WHERE i.event_id IS NULL ORDER BY o.transition_sequence`).all(consumerId);
      else rows = this.db.prepare('SELECT * FROM outbox_events ORDER BY transition_sequence').all();
      const events = rows.map((row) => {
        if (digest(row.payload_json) !== row.payload_digest) throw new LedgerError('OUTBOX_MISMATCH', 'Outbox payload digest is invalid.', { eventId: row.event_id });
        return { ...row, payload: JSON.parse(row.payload_json) };
      });
      const finalRefusal = this._identityQuarantineRefusal();
      if (finalRefusal) return { ...finalRefusal, events: [] };
      return { ok: true, events };
    } catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
  }

  applyOutboxEvent({ consumerId, eventId } = {}) {
    let request;
    try { requiredText(consumerId, 'consumerId'); requiredText(eventId, 'eventId'); request = this._request({ consumerId, eventId, operation: 'local-consumer-apply' }); }
    catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
    const transaction = this._tx(() => {
      const existing = this.db.prepare('SELECT i.application_id,a.application_json FROM consumer_inbox i JOIN consumer_applications a ON a.application_id=i.application_id WHERE i.consumer_id=? AND i.event_id=?').get(consumerId, eventId);
      if (existing) return { ok: true, code: 'ALREADY_APPLIED', eventId, consumerId, applicationId: existing.application_id, application: JSON.parse(existing.application_json), durableWritePerformed: false };
      const outbox = this.db.prepare('SELECT * FROM outbox_events WHERE event_id=?').get(eventId);
      if (!outbox) return makeResult('OUTBOX_NOT_FOUND', 'No committed local outbox event has this eventId.');
      if (digest(outbox.payload_json) !== outbox.payload_digest) throw new LedgerError('OUTBOX_MISMATCH', 'Outbox payload digest is invalid.', { eventId });
      const payload = JSON.parse(outbox.payload_json);
      const applicationId = digest(`${consumerId}\u0000${eventId}\u0000${outbox.payload_digest}`);
      const appliedAt = new Date().toISOString();
      const application = { consumerId, eventId, payloadDigest: outbox.payload_digest, appliedAt, appliedSequence: outbox.transition_sequence, eventType: payload.type, node: payload.data.node, status: payload.data.afterState, version: payload.data.version, payload };
      const applicationJson = json(application);
      this.db.prepare('INSERT INTO consumer_inbox(consumer_id,event_id,payload_digest,application_id,applied_at) VALUES(?,?,?,?,?)').run(consumerId, eventId, outbox.payload_digest, applicationId, appliedAt);
      this.db.prepare('INSERT INTO consumer_applications(application_id,consumer_id,event_id,application_json,applied_at) VALUES(?,?,?,?,?)').run(applicationId, consumerId, eventId, applicationJson, appliedAt);
      const node = payload.data.node;
      if (node?.nodeId && Number.isSafeInteger(node.acceptanceRevision) && payload.data.afterState) {
        const current = this.db.prepare('SELECT version FROM consumer_node_state WHERE consumer_id=? AND node_id=? AND acceptance_revision=?').get(consumerId, node.nodeId, node.acceptanceRevision);
        if (!current || payload.data.version > current.version) {
          this.db.prepare(`INSERT INTO consumer_node_state(consumer_id,node_id,acceptance_revision,status,version,last_event_id,updated_at) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(consumer_id,node_id,acceptance_revision) DO UPDATE SET status=excluded.status,version=excluded.version,last_event_id=excluded.last_event_id,updated_at=excluded.updated_at`)
            .run(consumerId, node.nodeId, node.acceptanceRevision, payload.data.afterState, payload.data.version, eventId, appliedAt);
        }
      }
      return { ok: true, code: 'APPLIED', eventId, consumerId, applicationId, application, durableWritePerformed: true };
    });
    return transaction.ok ? transaction.value : transaction.result;
  }

  status({ nodeId, acceptanceRevision } = {}) {
    this._assertOpen();
    try {
      validateRequestIdentity({ nodeId, acceptanceRevision, eventId: 'read-only' });
      const state = this.db.prepare('SELECT * FROM node_state WHERE node_id=? AND acceptance_revision=?').get(nodeId, acceptanceRevision);
      if (!state) return { ok: true, found: false };
      const pr = this.db.prepare('SELECT pr_json,observed_receipt_ref,event_id,created_at FROM canonical_pr WHERE node_id=? AND acceptance_revision=?').get(nodeId, acceptanceRevision);
      const park = this.db.prepare('SELECT mapping_digest,raw_record_json,lifecycle_disposition,event_id,created_at FROM park_records WHERE node_id=? AND acceptance_revision=?').get(nodeId, acceptanceRevision);
      return { ok: true, found: true, node: state, canonicalPr: pr ? { ...pr, pr: JSON.parse(pr.pr_json) } : null, park: park ? { ...park, rawRecord: JSON.parse(park.raw_record_json) } : null };
    } catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
  }

  history({ nodeId, acceptanceRevision } = {}) {
    this._assertOpen();
    try {
      validateRequestIdentity({ nodeId, acceptanceRevision, eventId: 'read-only' });
      const rows = this.db.prepare('SELECT * FROM transitions ORDER BY sequence').all();
      return { ok: true, transitions: rows.map((row) => ({ ...row, record: JSON.parse(row.record_json) })).filter((row) => row.record.node?.nodeId === nodeId && row.record.node?.acceptanceRevision === acceptanceRevision) };
    } catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
  }

  health({ expectedPrefixAnchor } = {}) {
    this._assertOpen();
    if (expectedPrefixAnchor !== undefined) {
      try { validateCallerAnchor(this.ledgerId, expectedPrefixAnchor); }
      catch (error) { const e = sqliteError(error); return makeResult(e.code, e.message, e.details); }
    }
    const transaction = this._tx(() => {
      if (expectedPrefixAnchor !== undefined) {
        try { checkHistory(this.db, this.ledgerId, expectedPrefixAnchor); }
        catch (error) { throw new LedgerError('TRUSTED_HEALTH_PREFIX_DIVERGENCE', 'The additional trusted health prefix differs from verified history.', { expectedPrefixAnchor, causeCode: error.code, causeMessage: error.message, causeDetails: error.details }); }
      }
      return { ok: true, anchor: this._anchor(), status: 'HEALTHY', durableWritePerformed: false };
    });
    return transaction.ok ? transaction.value : transaction.result;
  }
}

export function getGenesisAnchor(ledgerId) {
  safeLedgerId(ledgerId);
  return { sequence: 0, hash: initialHash(ledgerId) };
}

export function isTerminalStatus(status) { return TERMINAL.has(status); }
