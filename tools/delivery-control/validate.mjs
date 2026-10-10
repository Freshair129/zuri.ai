#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKET_SCHEMA = readJson(new URL('./contracts/packet.schema.json', import.meta.url));
const DELIVERY_SCHEMA = readJson(new URL('./contracts/delivery-dag.schema.json', import.meta.url));
const EXECUTION_SCHEMA = readJson(new URL('./contracts/execution-dag.schema.json', import.meta.url));
const PARK_MAP_BYTES = readFileSync(new URL('./contracts/park-map.json', import.meta.url));
export const PARK_MAP_SHA256 = 'sha256:fafbecdcec41731f72e555944bde202a946389d53be311a6c1199d2f8245413d';
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const APPROVED_PARK_MAP_INTERNAL = deepFreeze(JSON.parse(PARK_MAP_BYTES.toString('utf8')));
// Public compatibility export is a frozen copy; authority decisions use only the private copy above.
export const APPROVED_PARK_MAP = deepFreeze(JSON.parse(PARK_MAP_BYTES.toString('utf8')));

const EXPECTED_SOL_ROLES = Object.freeze([
  'orchestrator', 'decision', 'criticalDebug', 'integration', 'audit', 'finalGate',
]);
const EXPECTED_LUNA_ROLES = Object.freeze(['explore', 'research', 'worker', 'verifier', 'reviewer']);
const GATES = Object.freeze(['worker', 'verifier', 'reviewer']);
const BUDGET_COUNTERS = Object.freeze([
  'maxLineageAttempts', 'maxAcceptanceRepairRounds', 'maxSuccessorPlans', 'maxToolRetries',
  'maxCircuitProbes', 'maxRecoveryAttempts', 'maxRcaDecisions', 'maxEscalations',
]);
const DEADLINE_FIELDS = Object.freeze(['absoluteRunDeadline', 'perNodeDeadline', 'blockedWaitDeadline']);

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapePointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function stableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON does not accept nonfinite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isRecord(value)) throw new TypeError('canonical JSON accepts only JSON values');
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

/** Return a canonical SHA-256. Only the top-level approvalReceipt is excluded. */
export function canonicalDigest(document) {
  if (!isRecord(document)) throw new TypeError('canonicalDigest requires a JSON object');
  const body = { ...document };
  delete body.approvalReceipt;
  const hex = createHash('sha256').update(stableJson(body), 'utf8').digest('hex');
  return `sha256:${hex}`;
}

function resolveRef(rootSchema, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return null;
  return reference.slice(2).split('/').reduce((current, token) => {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    return isRecord(current) ? current[key] : undefined;
  }, rootSchema);
}

function matchesType(value, type) {
  switch (type) {
    case 'object': return isRecord(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function schemaErrors(value, schema, rootSchema, pointer = '$') {
  const errors = [];
  const visit = (item, rule, at) => {
    if (!isRecord(rule)) return;
    if (rule.$ref) {
      const target = resolveRef(rootSchema, rule.$ref);
      if (!target) {
        errors.push({ code: 'SCHEMA_REF_INVALID', path: at, message: `Unresolved schema reference ${rule.$ref}.` });
        return;
      }
      visit(item, target, at);
      return;
    }
    if (rule.type && !matchesType(item, rule.type)) {
      errors.push({ code: 'SCHEMA_TYPE', path: at, message: `Expected ${rule.type}.` });
      return;
    }
    if (Object.hasOwn(rule, 'const') && stableJson(item) !== stableJson(rule.const)) {
      errors.push({ code: 'SCHEMA_CONST', path: at, message: 'Value does not match the required constant.' });
    }
    if (Array.isArray(rule.enum) && !rule.enum.some((candidate) => stableJson(candidate) === stableJson(item))) {
      errors.push({ code: 'SCHEMA_ENUM', path: at, message: 'Value is outside the allowed set.' });
    }
    if (typeof item === 'string') {
      const length = Array.from(item).length;
      if (Number.isInteger(rule.minLength) && length < rule.minLength) {
        errors.push({ code: 'SCHEMA_MIN_LENGTH', path: at, message: `String must contain at least ${rule.minLength} character(s).` });
      }
      if (Number.isInteger(rule.maxLength) && length > rule.maxLength) errors.push({ code: 'SCHEMA_MAX_LENGTH', path: at, message: `String must contain at most ${rule.maxLength} character(s).` });
      if (rule.pattern && !new RegExp(rule.pattern).test(item)) {
        errors.push({ code: 'SCHEMA_PATTERN', path: at, message: 'String does not match the required format.' });
      }
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      if (Number.isFinite(rule.minimum) && item < rule.minimum) errors.push({ code: 'SCHEMA_MINIMUM', path: at, message: `Number must be at least ${rule.minimum}.` });
      if (Number.isFinite(rule.maximum) && item > rule.maximum) errors.push({ code: 'SCHEMA_MAXIMUM', path: at, message: `Number must be at most ${rule.maximum}.` });
    }
    if (Array.isArray(item)) {
      if (Number.isInteger(rule.minItems) && item.length < rule.minItems) errors.push({ code: 'SCHEMA_MIN_ITEMS', path: at, message: `Array must contain at least ${rule.minItems} item(s).` });
      if (rule.uniqueItems === true) {
        const seen = new Set();
        item.forEach((entry, index) => {
          let key;
          try { key = stableJson(entry); } catch { key = `unserializable:${index}`; }
          if (seen.has(key)) errors.push({ code: 'SCHEMA_DUPLICATE_ITEM', path: `${at}/${index}`, message: 'Array items must be unique.' });
          seen.add(key);
        });
      }
      if (isRecord(rule.items)) item.forEach((entry, index) => visit(entry, rule.items, `${at}/${index}`));
    }
    if (isRecord(item)) {
      for (const required of rule.required ?? []) {
        if (!Object.hasOwn(item, required)) errors.push({ code: 'SCHEMA_REQUIRED', path: `${at}/${escapePointer(required)}`, message: 'Required property is missing.' });
      }
      const properties = isRecord(rule.properties) ? rule.properties : {};
      if (rule.additionalProperties === false) {
        for (const key of Object.keys(item)) {
          if (!Object.hasOwn(properties, key)) errors.push({ code: 'SCHEMA_ADDITIONAL_PROPERTY', path: `${at}/${escapePointer(key)}`, message: 'Unknown property is not allowed.' });
        }
      }
      for (const [key, childRule] of Object.entries(properties)) {
        if (Object.hasOwn(item, key)) visit(item[key], childRule, `${at}/${escapePointer(key)}`);
      }
    }
  };
  visit(value, schema, pointer);
  return errors;
}

function add(errors, code, pathValue, message) {
  errors.push({ code, path: pathValue, message });
}

function uniqueErrors(errors) {
  const seen = new Set();
  return errors.filter((error) => {
    const key = `${error.code}\u0000${error.path}\u0000${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withPrefix(errors, prefix) {
  return errors.map((error) => ({ ...error, path: `${prefix}${error.path === '$' ? '' : error.path.slice(1)}` }));
}

function validateModelPolicy(policy, pointer, errors) {
  if (!isRecord(policy)) {
    add(errors, 'MODEL_POLICY_MISMATCH', pointer, 'The sealed model policy is required.');
    return;
  }
  for (const role of EXPECTED_SOL_ROLES) {
    if (policy.solRoles?.[role] !== 'gpt-6.1-sol') add(errors, 'MODEL_POLICY_MISMATCH', `${pointer}/solRoles/${role}`, 'This role must use gpt-6.1-sol.');
  }
  for (const role of EXPECTED_LUNA_ROLES) {
    const assignment = policy.lunaRoles?.[role];
    if (assignment?.model !== 'gpt-6-luna' || assignment?.effort !== 'max') {
      add(errors, 'MODEL_POLICY_MISMATCH', `${pointer}/lunaRoles/${role}`, 'This role must use gpt-6-luna at max effort.');
    }
  }
  if (policy.fallbackAllowed !== false || policy.roleSubstitutionAllowed !== false || policy.sessionsMustBeDistinct !== true) {
    add(errors, 'MODEL_POLICY_MISMATCH', pointer, 'Fallback and role substitution must be disabled and reviewer sessions must be distinct.');
  }
}

function validateRoleSessions(sessions, pointer, errors) {
  if (!isRecord(sessions)) {
    add(errors, 'MISSING_SESSION_RECEIPT', pointer, 'Worker, verifier, and reviewer session identities are required.');
    return;
  }
  const ids = [];
  for (const role of GATES) {
    const assignment = sessions[role];
    if (!isRecord(assignment) || typeof assignment.sessionId !== 'string' || assignment.sessionId.trim() === '') {
      add(errors, 'MISSING_SESSION_RECEIPT', `${pointer}/${role}`, `A ${role} session identity is required.`);
      continue;
    }
    if (assignment.role !== role) add(errors, 'ROLE_SUBSTITUTION', `${pointer}/${role}/role`, `The session is not bound to the ${role} role.`);
    if (assignment.model !== 'gpt-6-luna' || assignment.effort !== 'max') {
      add(errors, 'MODEL_POLICY_MISMATCH', `${pointer}/${role}`, 'Worker, verifier, and reviewer must use gpt-6-luna at max effort.');
    }
    ids.push(assignment.sessionId);
  }
  if (new Set(ids).size !== ids.length) add(errors, 'ROLE_SESSION_REUSED', pointer, 'Worker, verifier, and reviewer must have different session identities.');
}

function validateAuthority(authority, pointer, errors) {
  if (!isRecord(authority) || !nonempty(authority.authorityId) || !nonempty(authority.owner) || !nonempty(authority.scope) || !isSha256(authority.receiptSha256)) {
    add(errors, 'MISSING_AUTHORITY', pointer, 'A scoped owner authority identity and receipt digest are required.');
  }
}

function validateEnvironment(environment, pointer, errors) {
  if (!isRecord(environment) || !nonempty(environment.environmentId) || !nonempty(environment.kind) || !nonempty(environment.runtime) || !isSha256(environment.receiptSha256) || !Array.isArray(environment.commands) || environment.commands.length === 0) {
    add(errors, 'MISSING_ENVIRONMENT', pointer, 'An exact verification environment, receipt, and command list are required.');
  }
}

function validateAcceptance(acceptance, pointer, errors) {
  if (!Array.isArray(acceptance) || acceptance.length === 0) {
    add(errors, 'MISSING_PROOF', pointer, 'At least one explicit acceptance oracle and proof plan is required.');
    return;
  }
  const ids = new Set();
  acceptance.forEach((criterion, index) => {
    const p = `${pointer}/${index}`;
    if (!isRecord(criterion) || !nonempty(criterion.id) || !nonempty(criterion.given) || !nonempty(criterion.when) || !nonempty(criterion.then) || !nonempty(criterion.oracle) || !nonempty(criterion.proofMethod) || !nonempty(criterion.command) || !nonempty(criterion.fixtureManifest) || !nonempty(criterion.independentIssuer) || typeof criterion.mandatory !== 'boolean') {
      add(errors, 'MISSING_PROOF', p, 'Acceptance must seal Given/When/Then, oracle, proof, command, fixture, mandatory scope, and independent issuer.');
    }
    if (nonempty(criterion?.id)) {
      const key = criterion.id.toLowerCase();
      if (ids.has(key)) add(errors, 'DUPLICATE_ACCEPTANCE_ID', `${p}/id`, 'Acceptance identifiers must be unique within the packet.');
      ids.add(key);
    }
  });
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isSafePath(value) {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: 'path must be a non-empty string' };
  if (value.includes('\\')) return { ok: false, reason: 'backslashes are forbidden' };
  if (/^[A-Za-z]:/.test(value) || value.includes(':')) return { ok: false, reason: 'drive and alternate-stream syntax is forbidden' };
  if (value.startsWith('/') || value.startsWith('//')) return { ok: false, reason: 'absolute and UNC paths are forbidden' };
  if (/[*?\[\]{}]/.test(value)) return { ok: false, reason: 'globs and patterns are forbidden' };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, reason: 'control characters are forbidden' };
  if (!/^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/.test(value)) return { ok: false, reason: 'path contains a non-contract character' };
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return { ok: false, reason: 'empty, dot, and traversal segments are forbidden' };
  for (const segment of segments) {
    if (/[. ]$/.test(segment)) return { ok: false, reason: 'Windows trailing-dot and trailing-space aliases are forbidden' };
    const base = segment.split('.')[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])$/.test(base)) return { ok: false, reason: 'Windows reserved device names are forbidden' };
    if (segment.toLowerCase() === '.git') return { ok: false, reason: 'Git metadata paths are forbidden' };
  }
  return { ok: true, key: segments.map((segment) => segment.normalize('NFC').toLowerCase()).join('/') };
}

function validatePathList(values, pointer, errors, { required = false } = {}) {
  if (!Array.isArray(values)) {
    if (required) add(errors, 'UNSAFE_PATH', pointer, 'A concrete path list is required.');
    return [];
  }
  if (required && values.length === 0) add(errors, 'UNSAFE_PATH', pointer, 'At least one concrete path is required.');
  const normalized = [];
  const seen = new Map();
  values.forEach((value, index) => {
    const result = isSafePath(value);
    if (!result.ok) {
      add(errors, 'UNSAFE_PATH', `${pointer}/${index}`, `${result.reason}: ${String(value)}.`);
      return;
    }
    if (seen.has(result.key)) add(errors, 'PATH_CASE_COLLISION', `${pointer}/${index}`, `Path aliases ${seen.get(result.key)} under Windows case-insensitive comparison.`);
    else seen.set(result.key, value);
    normalized.push({ original: value, key: result.key });
  });
  return normalized;
}

function pathOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function validateWriteSubset(writes, allowedFiles, pointer, errors, scopeName) {
  const allowedByKey = new Map(allowedFiles.map((entry) => [entry.key, entry.original]));
  for (const file of writes) {
    if (!allowedByKey.has(file.key)) {
      add(errors, 'WRITE_OUTSIDE_ALLOWLIST', pointer, `Write ${file.original} is outside the exact ${scopeName} allowedFiles set.`);
    } else if (allowedByKey.get(file.key) !== file.original) {
      add(errors, 'PATH_CASE_ALIAS', pointer, `Write ${file.original} differs in case from its allowed path ${allowedByKey.get(file.key)}.`);
    }
  }
}

function validateBranch(branch, pointer, errors) {
  if (typeof branch !== 'string' || !/^[a-z0-9][a-z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/')) {
    add(errors, 'UNSAFE_BRANCH', pointer, 'Branch must be a concrete relative Git ref without traversal, backslashes, or aliases.');
    return;
  }
  const segments = branch.split('/');
  if (segments.some((segment) => segment.endsWith('.') || segment.endsWith('.lock') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    add(errors, 'UNSAFE_BRANCH', pointer, 'Branch path segments cannot use Windows trailing-dot/device aliases or Git .lock names.');
  }
}

function isStrictUtcTimestamp(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  date.setUTCHours(Number(hourText), Number(minuteText), Number(secondText), 0);
  return date.getUTCFullYear() === Number(yearText)
    && date.getUTCMonth() === Number(monthText) - 1
    && date.getUTCDate() === Number(dayText)
    && date.getUTCHours() === Number(hourText)
    && date.getUTCMinutes() === Number(minuteText)
    && date.getUTCSeconds() === Number(secondText);
}

function validateBudget(budget, stopConditions, pointer, errors) {
  if (!isRecord(budget)) {
    add(errors, 'MISSING_BOUNDED_BUDGET', `${pointer}/budget`, 'A sealed finite retry budget and deadlines are required.');
  } else {
    for (const name of DEADLINE_FIELDS) {
      const value = budget[name];
      if (!isStrictUtcTimestamp(value)) {
        add(errors, 'INVALID_BUDGET_DEADLINE', `${pointer}/budget/${name}`, 'Deadline must be a finite UTC ISO-8601 timestamp.');
      }
    }
    for (const name of BUDGET_COUNTERS) {
      if (!Number.isSafeInteger(budget[name]) || budget[name] < 0) add(errors, 'INVALID_BUDGET_LIMIT', `${pointer}/budget/${name}`, 'Retry and lineage limits must be finite non-negative safe integers.');
    }
    if (Number.isSafeInteger(budget.maxAcceptanceRepairRounds) && budget.maxAcceptanceRepairRounds > 2) {
      add(errors, 'BUDGET_POLICY_VIOLATION', `${pointer}/budget/maxAcceptanceRepairRounds`, 'Doc20 §10 caps automatic acceptance repair at two rounds per acceptance revision.');
    }
    const absolute = Date.parse(budget.absoluteRunDeadline);
    for (const name of ['perNodeDeadline', 'blockedWaitDeadline']) {
      const local = Date.parse(budget[name]);
      if (Number.isFinite(absolute) && Number.isFinite(local) && local > absolute) add(errors, 'BUDGET_POLICY_VIOLATION', `${pointer}/budget/${name}`, 'A subordinate deadline cannot exceed the absolute run deadline.');
    }
  }
  if (!Array.isArray(stopConditions) || stopConditions.length === 0 || stopConditions.some((entry) => !isRecord(entry) || !nonempty(entry.condition) || !nonempty(entry.nextAction))) {
    add(errors, 'MISSING_STOP_CONDITIONS', `${pointer}/stopConditions`, 'At least one concrete stop condition and next permitted action are required.');
  }
}

function validateDependencies(dependencies, options, pointer, errors) {
  if (dependencies === undefined) return { ready: true, count: 0 };
  if (!Array.isArray(dependencies)) {
    add(errors, 'MISSING_DEPENDENCY_PROOF', pointer, 'Dependencies must be an explicit array before dependency readiness can be determined.');
    return { ready: false, count: 0 };
  }
  const proofs = Array.isArray(options?.dependencyProofs) ? options.dependencyProofs : [];
  let ready = true;
  dependencies.forEach((artifact, index) => {
    validateArtifactBinding(artifact, `${pointer}/${index}`, errors);
    const proof = proofs.find((candidate) => candidate?.artifactId === artifact?.artifactId);
    if (!proof) {
      add(errors, 'MISSING_DEPENDENCY_PROOF', `${pointer}/${index}`, 'Dependency bytes and separately supplied trusted receipt context are required before READY.');
      ready = false;
      return;
    }
    const result = verifyArtifactAck(artifact, proof.bytes, proof.trustedContext);
    if (!result.ok) {
      errors.push(...withPrefix(result.errors, `${pointer}/${index}`));
      ready = false;
    }
  });
  return { ready, count: dependencies.length };
}

function validateArtifactBinding(artifact, pointer, errors) {
  if (!isRecord(artifact)) return;
  if (Object.hasOwn(artifact, 'status') || Object.hasOwn(artifact, 'producerStatus')) {
    add(errors, 'PRODUCER_STATUS_NOT_AUTHORITY', pointer, 'A producer status string cannot authorize a dependency.');
  }
  if (!isSha256(artifact.sha256) || artifact.uri !== `sha256:${artifact.sha256}`) {
    add(errors, 'MUTABLE_DEPENDENCY', `${pointer}/uri`, 'Dependency URI must be exactly sha256:<artifact SHA-256>.');
  }
  if (!isCommit(artifact.producerCommit)) add(errors, 'MUTABLE_DEPENDENCY', `${pointer}/producerCommit`, 'Producer revision must be an immutable 40-character commit SHA.');
  if (!nonempty(artifact.schemaVersion)) add(errors, 'MUTABLE_DEPENDENCY', `${pointer}/schemaVersion`, 'An immutable schema version is required.');
  const receipt = artifact.acceptanceReceipt;
  if (!isRecord(receipt) || receipt.status !== 'ACCEPTED' || !isSha256(receipt.receiptSha256)) {
    add(errors, 'MISSING_ACCEPTED_RECEIPT', `${pointer}/acceptanceReceipt`, 'A hash-pinned accepted receipt is required; producer status is insufficient.');
    return;
  }
  if (receipt.artifactSha256 !== artifact.sha256 || receipt.producerCommit !== artifact.producerCommit || receipt.schemaVersion !== artifact.schemaVersion || !nonempty(receipt.authorityId)) {
    add(errors, 'RECEIPT_BINDING_MISMATCH', `${pointer}/acceptanceReceipt`, 'Accepted receipt must bind the exact artifact digest, producer commit, schema version, and authority.');
  }
  validateRoleSessions(receipt.sessionRoles, `${pointer}/acceptanceReceipt/sessionRoles`, errors);
}

function validateOperationScope(scope, pointer, errors, { requireOwner = false, sharedLockIds = null, skipModelPolicy = false } = {}) {
  if (!isRecord(scope)) return;
  if (requireOwner && (!isRecord(scope.owner) || !nonempty(scope.owner.ownerId) || !nonempty(scope.owner.domain) || !nonempty(scope.owner.scope))) {
    add(errors, 'MISSING_OWNER', `${pointer}/owner`, 'One accountable owner and bounded scope are required.');
  }
  validateAuthority(scope.authority, `${pointer}/authority`, errors);
  if (requireOwner && isRecord(scope.owner) && isRecord(scope.authority)
      && nonempty(scope.owner.ownerId) && nonempty(scope.owner.scope)
      && nonempty(scope.authority.owner) && nonempty(scope.authority.scope)) {
    if (scope.owner.ownerId !== scope.authority.owner) add(errors, 'OWNER_AUTHORITY_MISMATCH', `${pointer}/authority/owner`, 'Authority owner must exactly equal owner.ownerId.');
    if (scope.owner.scope !== scope.authority.scope) add(errors, 'OWNER_SCOPE_MISMATCH', `${pointer}/authority/scope`, 'Authority scope must exactly equal owner.scope.');
  }
  validateEnvironment(scope.environment, `${pointer}/environment`, errors);
  if (!skipModelPolicy) validateModelPolicy(scope.modelPolicy, `${pointer}/modelPolicy`, errors);
  validateRoleSessions(scope.roleSessions, `${pointer}/roleSessions`, errors);
  validateAcceptance(scope.acceptance, `${pointer}/acceptance`, errors);
  validateBudget(scope.budget, scope.stopConditions, pointer, errors);

  const allowed = validatePathList(scope.allowedFiles, `${pointer}/allowedFiles`, errors, { required: true });
  const writes = validatePathList(scope.writeSet, `${pointer}/writeSet`, errors);
  validateWriteSubset(writes, allowed, `${pointer}/writeSet`, errors, 'packet/node');
  if (Array.isArray(scope.sourceDigests)) {
    const sourcePaths = scope.sourceDigests.map((entry) => entry?.path);
    validatePathList(sourcePaths, `${pointer}/sourceDigests`, errors, { required: true });
  }
  const declared = new Set(Array.isArray(scope.declaredEffects) ? scope.declaredEffects : []);
  for (const effect of Array.isArray(scope.effects) ? scope.effects : []) {
    if (!declared.has(effect)) add(errors, 'UNDECLARED_EFFECT', `${pointer}/effects`, `Effect ${String(effect)} is absent from declaredEffects.`);
  }
  if (sharedLockIds && Array.isArray(scope.locks)) {
    for (const lock of scope.locks) if (!sharedLockIds.has(String(lock).toLowerCase())) add(errors, 'UNDECLARED_LOCK', `${pointer}/locks`, `Lock ${String(lock)} is not declared in sharedLocks.`);
  }
}

function validateSharedLocks(sharedLocks, pointer, errors) {
  const ids = new Map();
  const normalized = [];
  for (const [index, lock] of (Array.isArray(sharedLocks) ? sharedLocks : []).entries()) {
    const at = `${pointer}/${index}`;
    const key = nonempty(lock?.lockId) ? lock.lockId.toLowerCase() : '';
    if (!key) {
      add(errors, 'UNDECLARED_LOCK', `${at}/lockId`, 'A stable shared lock ID is required.');
      continue;
    }
    if (ids.has(key)) add(errors, 'DUPLICATE_LOCK', `${at}/lockId`, 'Shared lock IDs must be unique ignoring case.');
    ids.set(key, lock.lockId);
    const paths = validatePathList(lock.resourcePaths, `${at}/resourcePaths`, errors, { required: true });
    normalized.push({ key, paths: paths.map((pathItem) => pathItem.key) });
  }
  return { ids: new Set(ids.keys()), locks: normalized };
}

function validateGraph(nodes, sharedLocks, pointer, errors, { packets = true } = {}) {
  if (!Array.isArray(nodes)) return;
  const byNodeId = new Map();
  const packetIds = new Map();
  const branches = new Map();
  nodes.forEach((node, index) => {
    if (!isRecord(node)) return;
    const at = `${pointer}/${index}`;
    const nodeKey = nonempty(node.nodeId) ? node.nodeId.toLowerCase() : '';
    if (nodeKey && byNodeId.has(nodeKey)) add(errors, 'DUPLICATE_NODE', `${at}/nodeId`, `Node identity duplicates ${byNodeId.get(nodeKey)} ignoring case.`);
    else if (nodeKey) byNodeId.set(nodeKey, node.nodeId);
    if (packets && nonempty(node.packetId)) {
      const key = node.packetId.toLowerCase();
      if (packetIds.has(key)) add(errors, 'DUPLICATE_PACKET', `${at}/packetId`, `Packet identity duplicates ${packetIds.get(key)} ignoring case.`);
      else packetIds.set(key, node.packetId);
    }
    if (nonempty(node.branch)) {
      const key = node.branch.toLowerCase();
      if (branches.has(key)) add(errors, 'DUPLICATE_BRANCH', `${at}/branch`, `Branch duplicates ${branches.get(key)} ignoring case.`);
      else branches.set(key, node.branch);
    }
    if (Object.hasOwn(node, 'branch')) validateBranch(node.branch, `${at}/branch`, errors);
  });

  const adjacency = new Map();
  nodes.forEach((node, index) => {
    if (!isRecord(node)) return;
    const id = nonempty(node.nodeId) ? node.nodeId.toLowerCase() : '';
    if (!id) return;
    const deps = Array.isArray(node.dependsOn) ? node.dependsOn : [];
    adjacency.set(id, []);
    deps.forEach((dep, depIndex) => {
      const key = typeof dep === 'string' ? dep.toLowerCase() : '';
      if (!byNodeId.has(key)) add(errors, 'MISSING_NODE', `${pointer}/${index}/dependsOn/${depIndex}`, `Dependency node ${String(dep)} is not present in this DAG.`);
      else adjacency.get(id).push(key);
      if (id === key) add(errors, 'CYCLE', `${pointer}/${index}/dependsOn/${depIndex}`, 'A node cannot depend on itself.');
      if (deps.slice(0, depIndex).some((prior) => typeof prior === 'string' && prior.toLowerCase() === key)) {
        add(errors, 'DUPLICATE_DEPENDENCY', `${pointer}/${index}/dependsOn/${depIndex}`, 'Dependency node IDs must be unique ignoring case.');
      }
    });
  });
  const state = new Map();
  const visit = (id, stack) => {
    const current = state.get(id) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      add(errors, 'CYCLE', pointer, `Dependency cycle includes ${[...stack, id].join(' -> ')}.`);
      return;
    }
    state.set(id, 1);
    for (const dep of adjacency.get(id) ?? []) visit(dep, [...stack, id]);
    state.set(id, 2);
  };
  for (const id of adjacency.keys()) visit(id, []);

  const shared = validateSharedLocks(sharedLocks, `${pointer}/../sharedLocks`, errors);
  for (const [i, node] of nodes.entries()) {
    if (!isRecord(node) || !Array.isArray(node.locks)) continue;
    for (const lock of node.locks) if (!shared.ids.has(String(lock).toLowerCase())) add(errors, 'UNDECLARED_LOCK', `${pointer}/${i}/locks`, `Lock ${String(lock)} has no sharedLocks declaration.`);
  }
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    if (!isRecord(left)) continue;
    const leftWrites = validatePathList(left.writeSet, `${pointer}/${leftIndex}/writeSet`, [], {});
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      if (!isRecord(right)) continue;
      const rightWrites = validatePathList(right.writeSet, `${pointer}/${rightIndex}/writeSet`, [], {});
      const conflicts = [];
      for (const a of leftWrites) for (const b of rightWrites) if (pathOverlap(a.key, b.key)) conflicts.push({ left: a, right: b });
      if (conflicts.length === 0) continue;
      const leftLocks = new Set((left.locks ?? []).map((lock) => String(lock).toLowerCase()));
      const rightLocks = new Set((right.locks ?? []).map((lock) => String(lock).toLowerCase()));
      const common = [...leftLocks].filter((lockId) => rightLocks.has(lockId) && shared.ids.has(lockId));
      const covered = common.some((lockId) => {
        const declaration = shared.locks.find((lock) => lock.key === lockId);
        return declaration && conflicts.every(({ left: a, right: b }) => declaration.paths.some((resource) => pathOverlap(resource, a.key) && pathOverlap(resource, b.key)));
      });
      if (!covered) add(errors, 'WRITE_OVERLAP_WITHOUT_SHARED_LOCK', `${pointer}/${rightIndex}/writeSet`, `Overlapping writes between ${left.nodeId} and ${right.nodeId} require a common declared lock covering the paths.`);
    }
  }
}

function validateParkRoutes(routes, nodes, pointer, errors) {
  const mapDigest = `sha256:${createHash('sha256').update(PARK_MAP_BYTES).digest('hex')}`;
  if (mapDigest !== PARK_MAP_SHA256) add(errors, 'PARK_MAP_INTEGRITY_ERROR', pointer, 'Park map bytes differ from the G0-approved source copy.');
  if (!Array.isArray(routes)) return;
  const nodeIds = new Set((Array.isArray(nodes) ? nodes : []).map((node) => node?.nodeId?.toLowerCase()).filter(Boolean));
  const seen = new Set();
  routes.forEach((route, index) => {
    const at = `${pointer}/${index}`;
    if (!isRecord(route)) return;
    if (!nodeIds.has(route.fromNodeId?.toLowerCase())) add(errors, 'PARK_SOURCE_NODE_MISSING', `${at}/fromNodeId`, 'A PARK route must originate at a node in this DAG.');
    if (route.toState !== 'PARK') add(errors, 'PARK_ROUTE_INVALID', `${at}/toState`, 'A failure route must target PARK.');
    if (!APPROVED_PARK_MAP_INTERNAL.cases.some((entry) => entry.failureClass === route.failureClass)) add(errors, 'PARK_CLASS_INVALID', `${at}/failureClass`, 'PARK route must use a typed failure class from the approved map.');
    if (route.mappingDigest !== PARK_MAP_SHA256 || route.mappingDigest !== mapDigest) add(errors, 'PARK_MAPPING_MISMATCH', `${at}/mappingDigest`, 'PARK route must bind the exact approved map digest.');
    const key = `${route.fromNodeId?.toLowerCase()}\u0000${route.failureClass}`;
    if (seen.has(key)) add(errors, 'PARK_ROUTE_DUPLICATE', at, 'A source node may declare each typed PARK route only once.');
    seen.add(key);
  });
}

function verifyDocumentApproval(document, trustedContext, errors = []) {
  const receipt = document?.approvalReceipt;
  const authorityId = document?.authority?.authorityId;
  if (!isRecord(receipt)) {
    add(errors, 'APPROVAL_MISSING', '$/approvalReceipt', 'An exact approval receipt is required.');
    return { ok: false, trustedContextMatched: false, errors };
  }
  if (receipt.status !== 'APPROVED') add(errors, 'APPROVAL_STATUS_INVALID', '$/approvalReceipt/status', 'Approval receipt status must be APPROVED.');
  let digest;
  try { digest = canonicalDigest(document); } catch (error) {
    add(errors, 'CANONICAL_DIGEST_INVALID', '$', error.message);
    return { ok: false, trustedContextMatched: false, errors };
  }
  if (receipt.kind !== document.kind || receipt.revision !== document.revision || receipt.acceptanceRevision !== document.acceptanceRevision) {
    add(errors, 'APPROVAL_REVISION_MISMATCH', '$/approvalReceipt', 'Approval kind, revision, and acceptanceRevision must match the exact document.');
  }
  if (receipt.documentDigest !== digest) add(errors, 'APPROVAL_DIGEST_MISMATCH', '$/approvalReceipt/documentDigest', 'Approval digest does not match canonical document content.');
  if (!nonempty(authorityId) || receipt.authorityId !== authorityId) add(errors, 'APPROVAL_AUTHORITY_MISMATCH', '$/approvalReceipt/authorityId', 'Approval authority must match the document authority.');
  if (!isSha256(receipt.receiptSha256)) add(errors, 'APPROVAL_RECEIPT_HASH_INVALID', '$/approvalReceipt/receiptSha256', 'Approval receipt needs a SHA-256 identity.');

  let trustedContextMatched = false;
  if (trustedContext !== undefined && trustedContext !== null) {
    const matches = Array.isArray(trustedContext.acceptedApprovals)
      ? trustedContext.acceptedApprovals.some((accepted) => isRecord(accepted)
        && accepted.receiptSha256 === receipt.receiptSha256
        && accepted.kind === receipt.kind
        && accepted.revision === receipt.revision
        && accepted.acceptanceRevision === receipt.acceptanceRevision
        && accepted.documentDigest === receipt.documentDigest
        && accepted.authorityId === receipt.authorityId)
      : false;
    trustedContextMatched = trustedContext.authorityId === authorityId && matches;
    if (!trustedContextMatched) add(errors, 'TRUST_CONTEXT_MISMATCH', '$/approvalReceipt', 'The separately supplied caller trust anchor does not match this exact approval receipt and authority.');
  }
  return { ok: errors.length === 0, trustedContextMatched, errors };
}

/** Compare an immutable document approval to a separately supplied caller trust anchor. */
export function verifyApproval(document, trustedContext) {
  const errors = [];
  const result = verifyDocumentApproval(document, trustedContext, errors);
  return { ok: result.ok, trustedContextMatched: result.trustedContextMatched, authorityGrant: false, errors: uniqueErrors(errors) };
}

/** Check artifact bytes and an accepted receipt against an explicit caller trust anchor. */
export function verifyArtifactAck(artifact, actualBytes, trustedContext) {
  const errors = [];
  errors.push(...schemaErrors(artifact, PACKET_SCHEMA.$defs.artifact, PACKET_SCHEMA));
  validateArtifactBinding(artifact, '$', errors);
  if (!actualBytes || !(actualBytes instanceof Uint8Array)) {
    add(errors, 'ARTIFACT_BYTES_REQUIRED', '$/bytes', 'Actual artifact bytes must be provided separately as a Buffer or Uint8Array.');
  } else if (isSha256(artifact?.sha256)) {
    const actual = createHash('sha256').update(actualBytes).digest('hex');
    if (actual !== artifact.sha256) add(errors, 'ARTIFACT_HASH_MISMATCH', '$/sha256', 'Actual bytes do not match the artifact SHA-256.');
  }
  if (!isRecord(trustedContext) || !isRecord(trustedContext.acceptedReceipt)) {
    add(errors, 'MISSING_TRUST_CONTEXT', '$/trustedContext', 'A separately supplied trusted accepted-receipt context is required.');
  } else {
    const receipt = artifact?.acceptanceReceipt;
    const anchor = trustedContext.acceptedReceipt;
    const fields = ['receiptSha256', 'artifactSha256', 'producerCommit', 'schemaVersion', 'authorityId', 'status'];
    const exact = fields.every((field) => anchor[field] === receipt?.[field]);
    if (!exact || trustedContext.authorityId !== receipt?.authorityId) {
      add(errors, 'TRUST_CONTEXT_MISMATCH', '$/trustedContext', 'Trusted context must match the exact receipt hash, artifact digest, producer commit, schema version, and authority.');
    }
  }
  const finalErrors = uniqueErrors(errors);
  const ok = finalErrors.length === 0;
  return {
    ok,
    errors: finalErrors,
    ack: ok ? {
      kind: 'receiver-ack', status: 'READY', artifactId: artifact.artifactId,
      uri: artifact.uri, sha256: artifact.sha256, producerCommit: artifact.producerCommit,
      schemaVersion: artifact.schemaVersion, acceptanceReceiptSha256: artifact.acceptanceReceipt.receiptSha256,
      authorityId: artifact.acceptanceReceipt.authorityId,
      trustBasis: 'CALLER_SUPPLIED_CONTEXT_ONLY', cryptographicallyAuthenticated: false,
      authorityGrant: false, stateWritePerformed: false,
    } : null,
  };
}

function collectDependencyReadiness(container, options, errors, pointer) {
  return validateDependencies(container?.dependencies, options, pointer, errors);
}

/** Validate one strict task packet. Dependency readiness requires byte proofs in options.dependencyProofs. */
export function validatePacket(packet, options = {}) {
  const errors = schemaErrors(packet, PACKET_SCHEMA, PACKET_SCHEMA);
  if (!isRecord(packet)) return { ok: false, errors: uniqueErrors(errors), dependencyReadiness: 'BLOCKED', authorityGrant: false };
  if (packet.kind !== 'task-packet' || packet.schemaVersion !== 'packet/v1') add(errors, 'PACKET_KIND_INVALID', '$/kind', 'Expected the packet/v1 task-packet contract.');
  validateOperationScope(packet, '$', errors, { requireOwner: true });
  validateBranch(packet.branch, '$/branch', errors);
  const dependencyResult = collectDependencyReadiness(packet, options, errors, '$/dependencies');
  const finalErrors = uniqueErrors(errors);
  const ok = finalErrors.length === 0;
  return {
    ok, errors: finalErrors, packetId: packet.packetId,
    dependencyReadiness: dependencyResult.ready ? 'READY' : 'BLOCKED',
    readinessBasis: 'LOCAL_VALIDATION_ONLY', authorityGrant: false, stateWritePerformed: false,
  };
}

function validateDocument(document, schema, options = {}, { packetDag = false } = {}) {
  const errors = schemaErrors(document, schema, schema);
  if (!isRecord(document)) return { ok: false, errors: uniqueErrors(errors), authorityGrant: false };
  let rootAllowed = new Map();
  let rootDeclared = new Set();
  if (packetDag) {
    validateAuthority(document.authority, '$/authority', errors);
    validateModelPolicy(document.modelPolicy, '$/modelPolicy', errors);
    validatePathList((document.sourceDigests ?? []).map((source) => source?.path), '$/sourceDigests', errors, { required: true });
  } else {
    validateOperationScope(document, '$', errors, { requireOwner: true });
    validateBranch(document.branch, '$/branch', errors);
    rootAllowed = new Map(validatePathList(document.allowedFiles, '$/allowedFiles', [], { required: true }).map((item) => [item.key, item.original]));
    rootDeclared = new Set(Array.isArray(document.declaredEffects) ? document.declaredEffects : []);
  }

  const dependencyResult = packetDag
    ? { ready: true, count: 0 }
    : collectDependencyReadiness(document, options, errors, '$/dependencies');
  let graphReady = true;
  if (packetDag) {
    const shared = validateSharedLocks(document.sharedLocks, '$/sharedLocks', errors);
    for (const [index, node] of (Array.isArray(document.nodes) ? document.nodes : []).entries()) {
      validateOperationScope(node, `$/nodes/${index}`, errors, { requireOwner: true, sharedLockIds: shared.ids, skipModelPolicy: true });
      if (node?.baseCommit !== document.baseCommit) add(errors, 'STALE_BASELINE', `$/nodes/${index}/baseCommit`, 'Node baseCommit must equal the delivery DAG pinned base.');
      const proofResult = collectDependencyReadiness(node, options, errors, `$/nodes/${index}/dependencies`);
      graphReady &&= proofResult.ready;
    }
    validateGraph(document.nodes, document.sharedLocks, '$/nodes', errors, { packets: true });
    validateParkRoutes(document.parkRoutes, document.nodes, '$/parkRoutes', errors);
  } else {
    const shared = validateSharedLocks(document.sharedLocks, '$/sharedLocks', errors);
    if (Array.isArray(document.locks)) {
      for (const lock of document.locks) if (!shared.ids.has(String(lock).toLowerCase())) add(errors, 'UNDECLARED_LOCK', '$/locks', `Lock ${String(lock)} has no sharedLocks declaration.`);
    }
    for (const [index, node] of (Array.isArray(document.nodes) ? document.nodes : []).entries()) {
      validateAcceptance(node?.acceptance, `$/nodes/${index}/acceptance`, errors);
      const nodeAllowed = new Map(validatePathList(node?.allowedFiles, `$/nodes/${index}/allowedFiles`, errors, { required: true }).map((item) => [item.key, item.original]));
      const nodeWrites = validatePathList(node?.writeSet, `$/nodes/${index}/writeSet`, errors);
      for (const write of nodeWrites) {
        if (!nodeAllowed.has(write.key)) add(errors, 'WRITE_OUTSIDE_ALLOWLIST', `$/nodes/${index}/writeSet`, `Write ${write.original} is outside the node allowlist.`);
        else if (nodeAllowed.get(write.key) !== write.original) add(errors, 'PATH_CASE_ALIAS', `$/nodes/${index}/writeSet`, `Write ${write.original} differs in case from its node allowlist.`);
        if (!rootAllowed.has(write.key)) add(errors, 'WRITE_OUTSIDE_ALLOWLIST', `$/nodes/${index}/writeSet`, `Write ${write.original} is outside the packet allowlist.`);
        else if (rootAllowed.get(write.key) !== write.original) add(errors, 'PATH_CASE_ALIAS', `$/nodes/${index}/writeSet`, `Write ${write.original} differs in case from its packet allowlist.`);
      }
      const declared = new Set(Array.isArray(node?.declaredEffects) ? node.declaredEffects : []);
      for (const effect of Array.isArray(node?.effects) ? node.effects : []) {
        if (!declared.has(effect) || !rootDeclared.has(effect)) add(errors, 'UNDECLARED_EFFECT', `$/nodes/${index}/effects`, `Effect ${String(effect)} is not declared by both the node and packet.`);
      }
      if (Array.isArray(node?.locks)) for (const lock of node.locks) if (!shared.ids.has(String(lock).toLowerCase())) add(errors, 'UNDECLARED_LOCK', `$/nodes/${index}/locks`, `Lock ${String(lock)} has no sharedLocks declaration.`);
    }
    validateGraph(document.nodes, document.sharedLocks, '$/nodes', errors, { packets: false });
    validateParkRoutes(document.parkRoutes, document.nodes, '$/parkRoutes', errors);
  }

  let digest;
  try { digest = canonicalDigest(document); } catch (error) { add(errors, 'CANONICAL_DIGEST_INVALID', '$', error.message); }
  const approval = verifyDocumentApproval(document, options.trustedContext, errors);
  if (document.kind === 'execution-dag') {
    if (options.deliveryDag) {
      const deliveryDigest = canonicalDigest(options.deliveryDag);
      if (document.deliveryDagDigest !== deliveryDigest) add(errors, 'DELIVERY_DAG_DIGEST_MISMATCH', '$/deliveryDagDigest', 'Execution DAG must bind the exact delivery DAG canonical digest.');
      const match = options.deliveryDag.nodes?.find((node) => node.packetId === document.packetId && node.lineageId === document.lineageId);
      if (!match) add(errors, 'EXECUTION_PACKET_UNBOUND', '$/packetId', 'Packet and lineage must exist in the supplied delivery DAG.');
      else if (match.baseCommit !== document.baseCommit || match.branch !== document.branch) add(errors, 'EXECUTION_PACKET_UNBOUND', '$', 'Execution DAG base and branch must match its delivery node.');
    }
  }
  const finalErrors = uniqueErrors(errors);
  const ok = finalErrors.length === 0;
  return {
    ok, errors: finalErrors, kind: document.kind, documentId: document.documentId,
    documentDigest: digest, approvalContext: approval.trustedContextMatched ? 'CALLER_CONTEXT_MATCHED' : 'NOT_TRUSTED',
    dependencyReadiness: dependencyResult.ready && graphReady ? 'READY' : 'BLOCKED',
    authorityGrant: false, stateWritePerformed: false,
  };
}

/** Validate a versioned delivery-level DAG and its packet nodes. */
export function validateDeliveryDag(deliveryDag, options = {}) {
  if (deliveryDag?.kind !== 'delivery-dag') {
    const errors = schemaErrors(deliveryDag, DELIVERY_SCHEMA, DELIVERY_SCHEMA);
    add(errors, 'DELIVERY_DAG_KIND_INVALID', '$/kind', 'Expected kind delivery-dag.');
    return { ok: false, errors: uniqueErrors(errors), authorityGrant: false };
  }
  return validateDocument(deliveryDag, DELIVERY_SCHEMA, options, { packetDag: true });
}

/** Validate a separately versioned per-packet execution DAG. */
export function validateExecutionDag(executionDag, options = {}) {
  if (executionDag?.kind !== 'execution-dag') {
    const errors = schemaErrors(executionDag, EXECUTION_SCHEMA, EXECUTION_SCHEMA);
    add(errors, 'EXECUTION_DAG_KIND_INVALID', '$/kind', 'Expected kind execution-dag.');
    return { ok: false, errors: uniqueErrors(errors), authorityGrant: false };
  }
  return validateDocument(executionDag, EXECUTION_SCHEMA, options, { packetDag: false });
}

function validBudgetValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (Array.isArray(value)) return value.every(validBudgetValue);
  return isRecord(value) && Object.values(value).every(validBudgetValue);
}

/** Map one or more typed failures to the approved intended closeout shape; it never persists. */
export function classifyPark(failureClasses, context = {}) {
  const errors = [];
  const actualMapDigest = `sha256:${createHash('sha256').update(PARK_MAP_BYTES).digest('hex')}`;
  if (actualMapDigest !== PARK_MAP_SHA256) add(errors, 'PARK_MAP_INTEGRITY_ERROR', '$/parkMap', 'Park map bytes differ from the G0-approved source copy.');
  if (!isRecord(context)) add(errors, 'PARK_CONTEXT_INVALID', '$/context', 'Park identity and evidence context must be an object.');
  const values = Array.isArray(failureClasses) ? failureClasses : [failureClasses];
  const known = new Set(APPROVED_PARK_MAP_INTERNAL.cases.map((entry) => entry.failureClass));
  const offered = values.filter((value) => typeof value === 'string' && known.has(value));
  const selected = APPROVED_PARK_MAP_INTERNAL.priority.find((failureClass) => offered.includes(failureClass)) ?? 'UNCLASSIFIED';
  const mapping = APPROVED_PARK_MAP_INTERNAL.cases.find((entry) => entry.failureClass === selected);
  for (const identityField of ['runId', 'nodeId', 'packetId', 'lineageId']) {
    if (!nonempty(context?.[identityField])) add(errors, 'PARK_IDENTITY_REQUIRED', `$/context/${identityField}`, `${identityField} is required for an intended PARK record.`);
  }
  if (context?.effectId !== undefined && context.effectId !== null && !nonempty(context.effectId)) add(errors, 'PARK_CONTEXT_INVALID', '$/context/effectId', 'effectId must be a non-empty string or null.');
  if (context?.lastKnownGitHostState !== undefined && !nonempty(context.lastKnownGitHostState)) add(errors, 'PARK_CONTEXT_INVALID', '$/context/lastKnownGitHostState', 'Git/host state must be a non-empty value when supplied.');
  if (context?.evidenceDigests !== undefined && (!Array.isArray(context.evidenceDigests) || context.evidenceDigests.some((digest) => !isSha256(digest)))) add(errors, 'PARK_CONTEXT_INVALID', '$/context/evidenceDigests', 'Evidence digests must be an array of lowercase SHA-256 values when supplied.');
  if (context?.leaseEpoch !== undefined && (!Number.isSafeInteger(context.leaseEpoch) || context.leaseEpoch < 0)) add(errors, 'PARK_CONTEXT_INVALID', '$/context/leaseEpoch', 'Lease epoch must be a non-negative safe integer when supplied.');
  if (context?.remainingLineageBudget !== undefined && !validBudgetValue(context.remainingLineageBudget)) add(errors, 'PARK_CONTEXT_INVALID', '$/context/remainingLineageBudget', 'Remaining budget values must be finite, non-negative counters or explicit JSON values.');
  const finalErrors = uniqueErrors(errors);
  if (finalErrors.length > 0) return { ok: false, errors: finalErrors, record: null, durableWritePerformed: false };
  const record = {
    runId: context.runId,
    nodeId: context.nodeId,
    packetId: context.packetId,
    lineageId: context.lineageId,
    effectId: context.effectId ?? null,
    failureClass: mapping.failureClass,
    runDisposition: mapping.runDisposition,
    nodeState: mapping.nodeState,
    effectState: mapping.effectState,
    canonicalCloseout: mapping.canonicalCloseout,
    lastKnownGitHostState: context.lastKnownGitHostState ?? 'UNKNOWN',
    evidenceDigests: context.evidenceDigests ?? [],
    leaseEpoch: context.leaseEpoch ?? null,
    remainingLineageBudget: context.remainingLineageBudget ?? null,
  };
  return { ok: true, errors: [], mappingDigest: PARK_MAP_SHA256, record, durableWritePerformed: false, persistence: 'INTENDED_RECORD_ONLY_WF02' };
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!['--kind', '--input', '--delivery', '--trusted-context', '--dependency-proofs'].includes(flag)) throw new Error(`Unknown option ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    const key = ({ '--kind': 'kind', '--input': 'input', '--delivery': 'delivery', '--trusted-context': 'trustedContext', '--dependency-proofs': 'dependencyProofs' })[flag];
    if (result[key] !== undefined) throw new Error(`Option ${flag} was supplied more than once`);
    result[key] = value;
    index += 1;
  }
  if (!result.kind || !result.input) throw new Error('Usage: node validate.mjs --kind packet|delivery-dag|execution-dag|fixture --input <local-json> [--delivery <delivery-json>] [--trusted-context <local-json>] [--dependency-proofs <local-json>]');
  return result;
}

function readCliJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

function readCliDependencyProofs(filePath) {
  if (!filePath) return [];
  const document = readCliJson(filePath);
  if (!Array.isArray(document)) throw new TypeError('Dependency proof file must contain a JSON array.');
  return document.map((proof, index) => {
    if (!isRecord(proof) || typeof proof.bytesBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(proof.bytesBase64)) {
      throw new TypeError(`Dependency proof ${index} must contain canonical bytesBase64.`);
    }
    const bytes = Buffer.from(proof.bytesBase64, 'base64');
    if (bytes.toString('base64') !== proof.bytesBase64) throw new TypeError(`Dependency proof ${index} has noncanonical Base64 bytes.`);
    return { artifactId: proof.artifactId, bytes, trustedContext: proof.trustedContext };
  });
}

function printResult(result, verdict) {
  const output = {
    verdict: result.ok ? verdict : 'REJECTED',
    errors: result.errors,
    authorityGrant: false,
    stateWritePerformed: false,
    result,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

function runCli() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${JSON.stringify({ verdict: 'REJECTED', errors: [{ code: 'CLI_USAGE', path: '$', message: error.message }], authorityGrant: false, stateWritePerformed: false })}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const input = readCliJson(args.input);
    const trustedContext = args.trustedContext ? readCliJson(args.trustedContext) : undefined;
    const dependencyProofs = readCliDependencyProofs(args.dependencyProofs);
    if (args.kind === 'packet') return printResult(validatePacket(input, { dependencyProofs }), 'STRUCTURAL_PASS');
    if (args.kind === 'delivery-dag') return printResult(validateDeliveryDag(input, { trustedContext, dependencyProofs }), 'STRUCTURAL_PASS');
    if (args.kind === 'execution-dag') {
      const deliveryDag = args.delivery ? readCliJson(args.delivery) : undefined;
      return printResult(validateExecutionDag(input, { trustedContext, deliveryDag, dependencyProofs }), 'STRUCTURAL_PASS');
    }
    if (args.kind === 'fixture') {
      if (input.kind !== 'wf01-local-fixture' || input.fixtureOnly !== true || !isRecord(input.trustedContext)) {
        return printResult({ ok: false, errors: [{ code: 'FIXTURE_TRUST_REQUIRED', path: '$', message: 'Fixture mode requires an explicitly isolated fixture and separate fixture trust context.' }] }, 'FIXTURE_ONLY_PASS');
      }
      const bytes = Buffer.from(input.artifactBytesBase64 ?? '', 'base64');
      const artifactProof = { artifactId: input.artifact?.artifactId, bytes, trustedContext: input.trustedContext.artifactContext };
      const dependencyProofs = [artifactProof];
      const packetResult = validatePacket(input.packet, { dependencyProofs });
      const deliveryResult = validateDeliveryDag(input.deliveryDag, { trustedContext: input.trustedContext, dependencyProofs });
      const executionResult = validateExecutionDag(input.executionDag, { trustedContext: input.trustedContext, dependencyProofs, deliveryDag: input.deliveryDag });
      const artifactResult = verifyArtifactAck(input.artifact, bytes, input.trustedContext.artifactContext);
      const parkResult = classifyPark(input.parkScenario?.failureClass, input.parkScenario?.context);
      const errors = [
        ...withPrefix(packetResult.errors, '$/packet'),
        ...withPrefix(deliveryResult.errors, '$/deliveryDag'),
        ...withPrefix(executionResult.errors, '$/executionDag'),
        ...withPrefix(artifactResult.errors, '$/artifact'),
        ...withPrefix(parkResult.errors, '$/parkScenario'),
      ];
      const result = {
        ok: errors.length === 0,
        errors: uniqueErrors(errors),
        fixtureOnly: true,
        packet: packetResult,
        deliveryDag: deliveryResult,
        executionDag: executionResult,
        artifactAck: artifactResult.ack,
        parkRecord: parkResult.record,
        authorityGrant: false,
        stateWritePerformed: false,
      };
      return printResult(result, 'FIXTURE_ONLY_PASS');
    }
    throw new Error(`Unsupported kind ${args.kind}`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ verdict: 'REJECTED', errors: [{ code: 'INPUT_INVALID', path: '$', message: error.message }], authorityGrant: false, stateWritePerformed: false }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli();
