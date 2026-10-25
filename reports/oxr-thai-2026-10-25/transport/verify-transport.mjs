import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const transportDir = path.dirname(scriptPath);
const reportRootRelative = 'reports/oxr-thai-2026-10-25';
const sealPathRelative = `${reportRootRelative}/e5-microbatch-v1/evidence-manifest.json`;
const transportManifestPath = path.join(transportDir, 'transport-manifest.json');
const defaultWhitespacePolicy = 'blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol';
const disabledWhitespaceCheckByPath = new Map([
  [`${reportRootRelative}/hyper-extraction-repair-v1/source_native.py`, 'blank-at-eol'],
  [`${reportRootRelative}/hyper-relation-audit-v1/evidence-adapter-v2.mjs`, 'blank-at-eof'],
  [`${reportRootRelative}/hyper-relation-audit-v1/evidence-adapter-v2.test.mjs`, 'blank-at-eof'],
  [`${reportRootRelative}/hyper-relation-audit-v1/evidence-adapter-v3.mjs`, 'blank-at-eof'],
  [`${reportRootRelative}/hyper-relation-audit-v1/evidence-adapter.mjs`, 'blank-at-eof'],
  [`${reportRootRelative}/hyper-relation-audit-v1/evidence-adapter.test.mjs`, 'blank-at-eof'],
]);

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Git's text clean conversion changes CRLF pairs to LF and leaves lone LF bytes alone.
export function normalizeCrlfToLf(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      out.push(0x0a);
      i += 1;
    } else {
      out.push(bytes[i]);
    }
  }
  return Buffer.from(out);
}

export function verifySnapshotBytes(snapshotBytes, source) {
  if (!Buffer.isBuffer(snapshotBytes)) throw new Error(`Missing snapshot for ${source.path}`);
  if (snapshotBytes.length !== source.raw.bytes) throw new Error(`Snapshot byte length mismatch: ${source.path}`);
  if (sha256(snapshotBytes) !== source.raw.sha256) throw new Error(`Snapshot SHA-256 mismatch: ${source.path}`);
  return true;
}

export function verifyCanonicalBytes(snapshotBytes, currentBytes, source) {
  verifySnapshotBytes(snapshotBytes, source);
  if (currentBytes.equals(snapshotBytes)) return 'RAW_IDENTICAL';

  const normalized = normalizeCrlfToLf(snapshotBytes);
  if (normalized.length !== source.gitClean.bytes || sha256(normalized) !== source.gitClean.sha256) {
    throw new Error(`Stored Git-clean digest does not match snapshot normalization: ${source.path}`);
  }
  if (currentBytes.equals(normalized)) return 'CRLF_TO_LF_ONLY';
  throw new Error(`Canonical source differs beyond CRLF-to-LF normalization: ${source.path}`);
}

export function classifySealCoverage(entries, missingPaths) {
  const missing = new Set(missingPaths);
  const missingLocal = [];
  const missingPortable = [];
  for (const entry of entries) {
    if (!missing.has(entry.path)) continue;
    if (entry.path.startsWith('.local/')) missingLocal.push(entry.path);
    else missingPortable.push(entry.path);
  }
  if (missingPortable.length) {
    throw new Error(`Missing portable sealed evidence: ${missingPortable.join(', ')}`);
  }
  return {
    fullSealStatus: missingLocal.length ? 'INCOMPLETE_LOCAL_EVIDENCE' : 'FULL_E5_SEAL_VERIFIED',
    portableEntriesVerified: entries.filter((entry) => !entry.path.startsWith('.local/')).length,
    portableEntriesTotal: entries.filter((entry) => !entry.path.startsWith('.local/')).length,
    localEntriesMissing: missingLocal.length,
    localMissingPaths: missingLocal,
  };
}

export function expectedWhitespaceForPath(relativePath) {
  const disabledCheck = disabledWhitespaceCheckByPath.get(relativePath);
  if (!disabledCheck) return defaultWhitespacePolicy;
  return defaultWhitespacePolicy.split(',')
    .map((check) => check === disabledCheck ? `-${check}` : check)
    .join(',');
}

function safeRepoPath(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  const rel = path.relative(repoRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path escapes repository: ${relativePath}`);
  return resolved;
}

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    ...(options.encoding === 'buffer' ? {} : { encoding: options.encoding ?? 'utf8' }),
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').toString().trim()}`);
  }
  return result.stdout;
}

function verifyReportSubtreeAttributes(repoRoot, attributePolicy) {
  if (attributePolicy.defaultWhitespacePolicy !== defaultWhitespacePolicy) {
    throw new Error('Transport manifest changes the default report whitespace policy');
  }
  const declaredExceptions = new Map(attributePolicy.whitespaceExceptions.map((entry) => [entry.path, entry.disabledCheck]));
  if (declaredExceptions.size !== disabledWhitespaceCheckByPath.size) {
    throw new Error('Transport manifest whitespace exception count differs from the explicit six-file policy');
  }
  for (const [relativePath, disabledCheck] of disabledWhitespaceCheckByPath) {
    if (declaredExceptions.get(relativePath) !== disabledCheck) {
      throw new Error(`Transport manifest whitespace exception differs: ${relativePath}`);
    }
  }

  const listed = runGit(repoRoot, [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', reportRootRelative,
  ], { encoding: 'buffer' });
  const paths = listed.toString('utf8').split('\0').filter(Boolean);
  if (!paths.length) throw new Error('No Git-visible report subtree files found');

  const input = Buffer.from(`${paths.join('\0')}\0`, 'utf8');
  const attrsOutput = runGit(repoRoot, ['check-attr', '--stdin', '-z', 'text', 'eol', 'whitespace', 'diff'], { encoding: 'buffer', input });
  const fields = attrsOutput.toString('utf8').split('\0');
  const attrMap = new Map();
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (!fields[i]) continue;
    const key = `${fields[i]}\0${fields[i + 1]}`;
    attrMap.set(key, fields[i + 2]);
  }

  const violations = [];
  for (const exceptionPath of disabledWhitespaceCheckByPath.keys()) {
    if (!paths.includes(exceptionPath)) violations.push(`missing exact exception file ${exceptionPath}`);
  }
  for (const relativePath of paths) {
    for (const [attr, expected] of [
      ['text', 'unset'],
      ['eol', 'unset'],
      ['whitespace', expectedWhitespaceForPath(relativePath)],
      ...(relativePath.endsWith('.bytes') ? [['diff', 'unset']] : []),
    ]) {
      if (attrMap.get(`${relativePath}\0${attr}`) !== expected) {
        violations.push(`${relativePath} ${attr}=${attrMap.get(`${relativePath}\0${attr}`) ?? 'missing'}`);
      }
    }
    const absolutePath = safeRepoPath(repoRoot, relativePath);
    if (fs.lstatSync(absolutePath).isSymbolicLink()) {
      violations.push(`${relativePath} is a symlink, not a regular byte artifact`);
      continue;
    }
    const rawHash = runGit(repoRoot, ['hash-object', '--no-filters', '--', absolutePath]).trim();
    const filteredHash = runGit(repoRoot, [`hash-object`, `--path=${relativePath}`, '--', absolutePath]).trim();
    if (rawHash !== filteredHash) violations.push(`${relativePath} hash-object applies a content transform`);
  }
  if (violations.length) throw new Error(`Report subtree is not byte-preserving: ${violations.join('; ')}`);
  return {
    filesChecked: paths.length,
    attributes: {
      text: 'unset',
      eol: 'unset',
      defaultWhitespace: defaultWhitespacePolicy,
      exactWhitespaceExceptions: disabledWhitespaceCheckByPath.size,
      snapshotDiff: 'unset',
    },
    rawVsGitHash: 'IDENTICAL',
  };
}

function verifyCanonicalSourceAttributes(repoRoot, sources) {
  const input = Buffer.from(`${sources.map((source) => source.path).join('\0')}\0`, 'utf8');
  const output = runGit(repoRoot, ['check-attr', '--stdin', '-z', 'text', 'eol'], { encoding: 'buffer', input });
  const fields = output.toString('utf8').split('\0');
  const attrs = new Map();
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (!fields[i]) continue;
    attrs.set(`${fields[i]}\0${fields[i + 1]}`, fields[i + 2]);
  }
  for (const source of sources) {
    if (attrs.get(`${source.path}\0text`) !== source.sourceAttributes.text
      || attrs.get(`${source.path}\0eol`) !== source.sourceAttributes.eol) {
      throw new Error(`Canonical source Git attributes changed: ${source.path}`);
    }
    const canonicalPath = safeRepoPath(repoRoot, source.path);
    const blobSha1 = runGit(repoRoot, ['hash-object', `--path=${source.path}`, '--', canonicalPath]).trim();
    if (blobSha1 !== source.gitClean.blobSha1) {
      throw new Error(`Canonical source Git-clean blob differs from transport map: ${source.path}`);
    }
  }
  return { sourcesChecked: sources.length, attributes: { text: 'set', eol: 'lf' }, gitCleanBlobSha1: 'MATCH' };
}

export function verifyTransport(repoRoot) {
  const manifestBytes = fs.readFileSync(transportManifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const sealPath = safeRepoPath(repoRoot, manifest.originalSeal.path);
  const sealBytes = fs.readFileSync(sealPath);
  if (sealBytes.length !== manifest.originalSeal.bytes || sha256(sealBytes) !== manifest.originalSeal.sha256) {
    throw new Error('Original E5 evidence manifest does not match the recorded immutable seal');
  }
  const seal = JSON.parse(sealBytes.toString('utf8'));
  const sealByPath = new Map(seal.entries.map((entry) => [entry.path, entry]));

  for (const source of manifest.sources) {
    const sealed = sealByPath.get(source.path);
    if (!sealed || sealed.bytes !== source.raw.bytes || sealed.sha256 !== source.raw.sha256) {
      throw new Error(`Transport mapping does not match original E5 seal entry: ${source.path}`);
    }
    const snapshotPath = safeRepoPath(repoRoot, source.snapshotPath);
    const snapshot = fs.readFileSync(snapshotPath);
    const canonicalPath = safeRepoPath(repoRoot, source.path);
    const canonical = fs.readFileSync(canonicalPath);
    verifyCanonicalBytes(snapshot, canonical, source);
  }

  const allowedNormalized = new Map(manifest.sources.map((source) => [
    source.path,
    normalizeCrlfToLf(fs.readFileSync(safeRepoPath(repoRoot, source.snapshotPath))),
  ]));
  const missing = [];
  let portableExactOrTransported = 0;
  for (const entry of seal.entries) {
    const entryPath = safeRepoPath(repoRoot, entry.path);
    if (!fs.existsSync(entryPath)) {
      missing.push(entry.path);
      continue;
    }
    const bytes = fs.readFileSync(entryPath);
    const exact = bytes.length === entry.bytes && sha256(bytes) === entry.sha256;
    const transportedCanonical = allowedNormalized.has(entry.path)
      && bytes.equals(allowedNormalized.get(entry.path));
    if (!exact && !transportedCanonical) {
      throw new Error(`Sealed evidence differs from original E5 entry: ${entry.path}`);
    }
    if (!entry.path.startsWith('.local/')) portableExactOrTransported += 1;
  }
  const coverage = classifySealCoverage(seal.entries, missing);
  if (portableExactOrTransported !== coverage.portableEntriesTotal) {
    throw new Error('Portable E5 evidence coverage is incomplete');
  }

  const reportBytes = verifyReportSubtreeAttributes(repoRoot, manifest.reportSubtreeAttributes);
  const canonicalGitPolicy = verifyCanonicalSourceAttributes(repoRoot, manifest.sources);
  return {
    status: 'PORTABLE_TRANSPORT_VERIFIED',
    originalSealSha256: manifest.originalSeal.sha256,
    trackedSourceSnapshots: manifest.sources.length,
    canonicalSourceForms: manifest.sources.map((source) => ({
      path: source.path,
      form: verifyCanonicalBytes(
        fs.readFileSync(safeRepoPath(repoRoot, source.snapshotPath)),
        fs.readFileSync(safeRepoPath(repoRoot, source.path)),
        source,
      ),
    })),
    portableEvidence: {
      verified: portableExactOrTransported,
      expected: coverage.portableEntriesTotal,
      status: 'PASS',
    },
    localEvidence: {
      expected: seal.entries.filter((entry) => entry.path.startsWith('.local/')).length,
      presentAndVerified: seal.entries.filter((entry) => entry.path.startsWith('.local/') && !missing.includes(entry.path)).length,
      missing: coverage.localEntriesMissing,
      status: coverage.fullSealStatus === 'FULL_E5_SEAL_VERIFIED' ? 'PRESENT_AND_VERIFIED' : 'INCOMPLETE_LOCAL_EVIDENCE',
    },
    originalE5SealStatus: coverage.fullSealStatus,
    canonicalSourceGitPolicy: canonicalGitPolicy,
    reportSubtreeBytePreservation: reportBytes,
  };
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
}

if (isMain()) {
  try {
    const repoRoot = path.resolve(process.argv[2] ?? path.join(transportDir, '..', '..', '..'));
    process.stdout.write(`${JSON.stringify(verifyTransport(repoRoot), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`TRANSPORT_VERIFY_FAIL: ${error.message}\n`);
    process.exitCode = 1;
  }
}
