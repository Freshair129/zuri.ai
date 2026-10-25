import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const reportDir = path.resolve('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1');
const rawRoot = path.resolve('.local/hyper-relation-audit-20261025');
const manifestPath = path.join(reportDir, 'evidence-manifest.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function collectFiles(root) {
  const result = [];
  async function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    assert.equal(stat.isSymbolicLink(), false, `Evidence cannot contain a symlink: ${absolute}`);
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(absolute)).sort()) {
        await visit(path.join(relative, entry));
      }
    } else if (stat.isFile()) {
      result.push(absolute);
    }
  }
  for (const entry of (await fs.readdir(root)).sort()) await visit(entry);
  return result;
}

assert.equal(await fs.stat(rawRoot).then((item) => item.isDirectory()), true);
assert.equal(await fs.stat(reportDir).then((item) => item.isDirectory()), true);
const summary = JSON.parse(await fs.readFile(path.join(reportDir, 'measurement-summary.json'), 'utf8'));
const freezePath = path.join(rawRoot, 'run-5', 'freeze.json');
const validatorFreezePath = path.join(rawRoot, 'run-5-validator-v6', 'validator-freeze.json');
const freezeBytes = await fs.readFile(freezePath);
const validatorFreezeBytes = await fs.readFile(validatorFreezePath);
assert.equal(sha256(freezeBytes), summary.inputs.freezeSha256);
assert.equal(sha256(validatorFreezeBytes), summary.inputs.validatorFreezeSha256);
assert.equal(summary.native.status, 'COMPLETED');
assert.equal(summary.native.successfulStages, 17);

const paths = [
  ...(await collectFiles(reportDir)).filter((file) => path.resolve(file) !== path.resolve(manifestPath)),
  ...(await collectFiles(rawRoot)),
].sort();
const files = [];
for (const absolute of paths) {
  const bytes = await fs.readFile(absolute);
  files.push({
    path: path.relative(process.cwd(), absolute).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}

const manifest = {
  schema: 'zuri.hyper-relation-evidence-audit.v1',
  status: 'sealed-nonproduction-experiment',
  baseRevision: '49ef1ddbaa4db684bc5282ccc8df379e5a0028c8',
  rawRoot: '.local/hyper-relation-audit-20261025',
  caveat: 'Hashes bind artifact identity and provenance; they do not establish semantic correctness. The candidate graph remains a sidecar and semantic status is NOT_ASSESSED.',
  inferenceFreezeSha256: summary.inputs.freezeSha256,
  validatorFreezeSha256: summary.inputs.validatorFreezeSha256,
  sourceBundleSha256: summary.inputs.sourceBundleSha256,
  goldSha256: summary.inputs.goldSha256,
  completedRun: {
    runId: 'run-5',
    extractionStatus: 'COMPLETED',
    chunks: summary.extraction.calls,
    factOccurrences: summary.extraction.candidateOutputCounts.factOccurrencesAcrossChunks,
    relationOccurrences: summary.extraction.candidateOutputCounts.relationOccurrencesAcrossChunks,
    nativeStatus: summary.native.status,
    nativeStages: summary.native.successfulStages,
    fixedQueries: summary.native.totalQueries,
  },
  files,
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  manifestPath: path.relative(process.cwd(), manifestPath).replaceAll('\\', '/'),
  files: files.length,
  totalBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
  manifestSha256: sha256(await fs.readFile(manifestPath)),
}, null, 2));
