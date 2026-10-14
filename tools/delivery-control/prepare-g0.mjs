#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalDigest, validateG0Preparation } from './validate.mjs';

const POLICY_URL = new URL('../../docs/architecture/delivery-control/contracts/model-policy.json', import.meta.url);
const REPOSITORY = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function pathIdentity(value) {
  if (process.platform !== 'win32') return path.normalize(value);
  const ordinary = value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  return path.win32.normalize(ordinary).toLowerCase();
}

function ensureEvidenceDirectory(directory) {
  let entry;
  let created = false;
  try { entry = lstatSync(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!entry) {
    // The caller has already inspected the parent; never recursively create through it.
    try { mkdirSync(directory); created = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    entry = lstatSync(directory);
  }
  if (entry.isSymbolicLink() || !entry.isDirectory() || pathIdentity(realpathSync(directory)) !== pathIdentity(directory)) {
    throw new Error('Evidence directory must be a direct directory, not a symlink or junction.');
  }
  return created;
}

function privateEvidenceRoot() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPOSITORY, shell: false, encoding: 'utf8' }).trim();
  const root = path.join(realpathSync(common), 'zuri-delivery-control');
  ensureEvidenceDirectory(root);
  return root;
}

function reservationFailure(code, message, locator, effectState = 'NONE') {
  return Object.assign(new Error(message), { reasonCode: code, reservationLocator: locator, reservationEffectState: effectState, runDisposition: 'BLOCKED' });
}

/** Reserve before candidate reads. Slots are shared across every linked worktree. */
function reservePreparation(rootLineageId, policy, policySha256) {
  const maximum = policy?.retryAndLineage?.limits?.maxPreparationAttemptsTotalPerRootLineage;
  if (policy?.status !== 'ACTIVE' || !Number.isSafeInteger(maximum) || maximum < 1 || !policy?.packetPreflight?.draftPreparation) {
    throw reservationFailure('G0_PREPARATION_POLICY_INVALID', 'Active preparation policy and finite cap are required.', null);
  }
  const parent = path.join(privateEvidenceRoot(), 'preparation-attempts');
  ensureEvidenceDirectory(parent);
  const lineageSha256 = digest(rootLineageId);
  const prefix = `${lineageSha256}-`;
  const names = readdirSync(parent).filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  let initialCap = maximum;
  let historyLocator = parent;
  try {
    for (const [index, name] of names.entries()) {
      historyLocator = path.join(parent, `${prefix}${name}`);
      if (name !== `attempt-${index + 1}.json`) throw new Error('Reservation slots are unexpected or noncontiguous.');
      const locator = historyLocator;
      const entry = lstatSync(locator);
      if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('Reservation slot is not a direct file.');
      const record = readJson(locator);
      const fields = ['kind', 'schemaVersion', 'rootLineageId', 'lineageSha256', 'attempt', 'initialCap', 'policyVersion', 'policySha256', 'reservedAt'];
      if (!record || Array.isArray(record) || Object.keys(record).length !== fields.length || !fields.every((field) => Object.hasOwn(record, field)) ||
          record.kind !== 'g0-preparation-reservation' || record.schemaVersion !== 'g0-preparation-reservation/v1' ||
          record.rootLineageId !== rootLineageId || record.lineageSha256 !== lineageSha256 || record.attempt !== index + 1 ||
          !Number.isSafeInteger(record.initialCap) || record.initialCap < 1 || !Number.isSafeInteger(record.policyVersion) || record.policyVersion < 1 ||
          typeof record.policySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.policySha256) || typeof record.reservedAt !== 'string' || !Number.isFinite(Date.parse(record.reservedAt))) {
        throw new Error('Reservation record is malformed or bound to a different lineage.');
      }
      if (index === 0) initialCap = record.initialCap;
      if (record.initialCap !== initialCap) throw new Error('Reservation cap history is inconsistent.');
      if (record.attempt > initialCap) throw new Error('Reservation count exceeds its original cap.');
    }
  } catch (error) {
    throw reservationFailure('G0_PREPARATION_HISTORY_INVALID', error.message, historyLocator);
  }
  const cap = Math.min(maximum, initialCap);
  if (names.length >= cap) throw reservationFailure('G0_PREPARATION_BUDGET_EXHAUSTED', 'Preparation allowance is exhausted; no candidate will be opened.', parent);
  const attempt = names.length + 1;
  const locator = path.join(parent, `${prefix}attempt-${attempt}.json`);
  const record = { kind: 'g0-preparation-reservation', schemaVersion: 'g0-preparation-reservation/v1', rootLineageId, lineageSha256, attempt, initialCap, policyVersion: policy.version, policySha256, reservedAt: new Date().toISOString() };
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  let descriptor;
  let claimed = false;
  try {
    descriptor = openSync(locator, 'wx');
    claimed = true;
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (!readFileSync(locator).equals(bytes)) throw new Error('Reservation byte read-back mismatch.');
    return { locator, sha256: digest(bytes), attempt, cap, rootLineageId };
  } catch (error) {
    throw reservationFailure(error.code === 'EEXIST' ? 'G0_PREPARATION_RESERVATION_CONFLICT' : 'G0_PREPARATION_RESERVATION_FAILED', error.message, locator, claimed ? 'UNKNOWN' : 'NONE');
  } finally {
    // Never delete, repair, overwrite or refund a claimed slot, even if writing fails.
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch (error) { throw reservationFailure('G0_PREPARATION_RESERVATION_FAILED', error.message, locator, 'UNKNOWN'); }
    }
  }
}

/** Create-only publication: readers see complete bytes; an existing receipt is never replaced. */
function publish(record) {
  const context = { evidenceLocator: null, temporaryLocator: null, publicationState: 'NOT_ATTEMPTED', publicationEffectState: 'NONE' };
  try {
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    // Reject serialization defects before touching the evidence directory.
    if (canonicalDigest(JSON.parse(bytes.toString('utf8'))) !== canonicalDigest(record)) throw new Error('Receipt round-trip mismatch.');
    const privateRoot = privateEvidenceRoot();
    const directory = path.join(privateRoot, 'preparations');
    const destination = path.join(directory, `${digest(bytes)}.json`);
    const temporary = path.join(directory, `.pending-${randomUUID()}`);
    context.evidenceLocator = destination;
    context.temporaryLocator = temporary;
    // Refuse a redirected evidence directory. Never traverse a symlink/junction to publish.
    ensureEvidenceDirectory(privateRoot);
    ensureEvidenceDirectory(directory);
    let descriptor;
    let created = false;
    try {
      descriptor = openSync(temporary, 'wx');
      created = true;
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      if (!readFileSync(temporary).equals(bytes)) throw new Error('Temporary receipt read-back mismatch.');
      // A same-directory hard link publishes the complete file without overwrite.
      // Filesystems without hard-link support fail closed; never fall back to rename/copy.
      context.publicationState = 'UNRECONCILED';
      context.publicationEffectState = 'UNKNOWN';
      linkSync(temporary, destination);
      context.publicationState = 'PUBLISHED_UNVERIFIED';
      context.publicationEffectState = 'APPLIED';
      if (!readFileSync(destination).equals(bytes)) throw new Error('Published receipt read-back mismatch; quarantine it.');
      context.publicationState = 'PUBLISHED_VERIFIED';
      return { evidenceLocator: destination, sha256: digest(bytes) };
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (created) unlinkSync(temporary);
    }
  } catch (error) {
    // Include the intended path even when linking, read-back or cleanup fails.
    throw Object.assign(error, context);
  }
}

function argsOf(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--publish') {
      if (result.publish) throw new Error('Duplicate --publish.');
      result.publish = true;
      continue;
    }
    if (!['--root-lineage-id', '--packet', '--preparation', '--dependency-proofs'].includes(flag)) throw new Error(`Unknown option ${flag}.`);
    const key = flag.slice(2);
    const value = args[++index];
    if (!value || value.startsWith('--') || result[key]) throw new Error(`Missing or duplicate ${flag}.`);
    result[key] = value;
  }
  if (!result['root-lineage-id'] || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(result['root-lineage-id']) || !result.packet || !result.preparation) throw new Error('Usage: node prepare-g0.mjs --root-lineage-id <stable-id> --packet <json> --preparation <json> [--dependency-proofs <json>] [--publish]');
  return result;
}

function runCli() {
  let reservation = null;
  let rootLineageId = null;
  try {
    const args = argsOf(process.argv.slice(2));
    rootLineageId = args['root-lineage-id'];
    const policyBytes = readFileSync(POLICY_URL);
    const policy = JSON.parse(policyBytes.toString('utf8'));
    try { reservation = reservePreparation(rootLineageId, policy, digest(policyBytes)); } catch (error) {
      if (!error.reasonCode) throw reservationFailure('G0_PREPARATION_RESERVATION_UNAVAILABLE', error.message, null, 'UNKNOWN');
      throw error;
    }
    const packet = readJson(args.packet);
    const preparation = readJson(args.preparation);
    if (preparation?.rootLineageId !== args['root-lineage-id'] || packet?.lineageId !== args['root-lineage-id']) throw new Error('CLI, sidecar and packet must bind the same stable root lineage.');
    const proofs = args['dependency-proofs'] ? readJson(args['dependency-proofs']) : [];
    if (!Array.isArray(proofs)) throw new Error('Dependency proofs must be an array.');
    const dependencyProofs = proofs.map((proof) => {
      if (typeof proof?.bytesBase64 !== 'string') throw new Error('Dependency proof requires bytesBase64.');
      const bytes = Buffer.from(proof.bytesBase64, 'base64');
      if (bytes.toString('base64') !== proof.bytesBase64) throw new Error('Dependency proof bytesBase64 must be canonical.');
      return { artifactId: proof.artifactId, bytes, trustedContext: proof.trustedContext };
    });
    const result = validateG0Preparation(preparation, packet, policy, { dependencyProofs });
    const record = {
      kind: 'g0-preparation-result', schemaVersion: 'g0-preparation-result/v1',
      verdict: result.ok ? 'PREPARED_NOT_ADMITTED' : 'DRAFT_REJECTED',
      rootLineageId: preparation?.rootLineageId ?? null, policyVersion: policy.version,
      reservation,
      policySha256: digest(policyBytes),
      candidateDigest: result.ok ? canonicalDigest({ packet, preparation }) : null,
      // Binding the candidate preserves the structured command proof in the receipt.
      candidate: result.ok ? { packet, preparation } : null,
      ...result,
    };
    const publication = result.ok && args.publish ? publish(record) : null;
    process.stdout.write(`${JSON.stringify({ ...record, publication, stateWritePerformed: true }, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const publicationState = error.publicationState ?? 'NOT_ATTEMPTED';
    const publicationEffectState = error.publicationEffectState ?? 'NONE';
    const needsReconciliation = publicationState !== 'NOT_ATTEMPTED' || publicationEffectState !== 'NONE';
    const nextPermittedAction = error.reasonCode
      ? 'Block this lineage; reconcile the exact reservation history read-only. Preserve every slot and original deadline. No automatic retry, refund or counter reset; continue independent eligible work.'
      : needsReconciliation
      ? 'Read-only reconcile the exact evidence and temporary locators before any bounded retry; preserve all existing receipt bytes. No automatic retry.'
      : 'Record the candidate and diagnostic; Sol may prepare one corrected draft only if preparation cap, original deadline and no-progress budget permit. No automatic retry.';
    process.stdout.write(`${JSON.stringify({ verdict: 'PREPARATION_ERROR', message: error.message, rootLineageId, reasonCode: error.reasonCode ?? 'G0_PREPARATION_INPUT_OR_PUBLICATION_ERROR', runDisposition: error.runDisposition ?? 'BLOCKED', authorityGrant: false, dispatchAllowed: false, reservation, reservationLocator: error.reservationLocator ?? reservation?.locator ?? null, reservationEffectState: error.reservationEffectState ?? (reservation ? 'APPLIED' : 'NONE'), evidenceLocator: error.evidenceLocator ?? null, temporaryLocator: error.temporaryLocator ?? null, publicationState, publicationEffectState, nextPermittedAction }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli();
