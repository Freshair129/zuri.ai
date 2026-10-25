import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySealCoverage,
  expectedWhitespaceForPath,
  normalizeCrlfToLf,
  sha256,
  verifyCanonicalBytes,
  verifySnapshotBytes,
} from './verify-transport.mjs';

const original = Buffer.from('first\r\nsecond\nthird\r\n', 'utf8');
const normalized = Buffer.from('first\nsecond\nthird\n', 'utf8');
const source = {
  path: 'docs/sample.md',
  raw: { bytes: original.length, sha256: sha256(original) },
  gitClean: { bytes: normalized.length, sha256: sha256(normalized) },
};

test('CRLF normalization preserves lone LF and changes only CRLF pairs', () => {
  assert.deepEqual(normalizeCrlfToLf(original), normalized);
});

test('snapshot must match sealed raw bytes and hash', () => {
  assert.equal(verifySnapshotBytes(original, source), true);
  assert.throws(() => verifySnapshotBytes(Buffer.from('altered'), source), /length mismatch|SHA-256 mismatch/);
  assert.throws(() => verifySnapshotBytes(null, source), /Missing snapshot/);
});

test('canonical source accepts original bytes or CRLF-to-LF only', () => {
  assert.equal(verifyCanonicalBytes(original, original, source), 'RAW_IDENTICAL');
  assert.equal(verifyCanonicalBytes(original, normalized, source), 'CRLF_TO_LF_ONLY');
  assert.throws(() => verifyCanonicalBytes(original, Buffer.from('first\nchanged\nthird\n'), source), /differs beyond/);
});

test('missing local evidence remains explicitly incomplete, never a full-seal pass', () => {
  const entries = [
    { path: 'reports/example.json' },
    { path: '.local/raw/native.json' },
  ];
  const summary = classifySealCoverage(entries, ['.local/raw/native.json']);
  assert.equal(summary.fullSealStatus, 'INCOMPLETE_LOCAL_EVIDENCE');
  assert.equal(summary.portableEntriesVerified, 1);
  assert.equal(summary.localEntriesMissing, 1);
});

test('missing portable evidence is an integrity failure', () => {
  assert.throws(
    () => classifySealCoverage([{ path: 'reports/example.json' }], ['reports/example.json']),
    /Missing portable sealed evidence/,
  );
});

test('only the six exact sealed files disable their one reported whitespace check', () => {
  const base = 'blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol';
  assert.equal(expectedWhitespaceForPath('reports/oxr-thai-2026-10-25/unrelated.py'), base);
  assert.equal(
    expectedWhitespaceForPath('reports/oxr-thai-2026-10-25/hyper-extraction-repair-v1/source_native.py'),
    '-blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol',
  );
  assert.equal(
    expectedWhitespaceForPath('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/evidence-adapter-v2.mjs'),
    'blank-at-eol,-blank-at-eof,space-before-tab,cr-at-eol',
  );
  assert.equal(
    expectedWhitespaceForPath('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/other.mjs'),
    base,
  );
});
