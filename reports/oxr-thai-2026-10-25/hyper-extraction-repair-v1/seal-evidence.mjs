import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reportDir = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(root, '.local/hyper-extraction-repair-20261025');
const manifestPath = path.join(reportDir, 'evidence-manifest.json');
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileSha = async (file) => sha(await fs.readFile(file));

async function collectFiles(directory) {
  const result = [];
  async function visit(absolute) {
    const stat = await fs.lstat(absolute);
    assert.equal(stat.isSymbolicLink(), false, `Evidence cannot contain symlinks: ${absolute}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) {
        if (name === '__pycache__') continue;
        await visit(path.join(absolute, name));
      }
    } else if (stat.isFile() && path.resolve(absolute) !== path.resolve(manifestPath)) {
      result.push(absolute);
    }
  }
  await visit(directory);
  return result;
}

const summary = await read(path.join(reportDir, 'measurement-summary.json'));
const nativeInput = await read(path.join(rawDir, 'native-input-source-native-v1.json'));
const nativeFreeze = await read(path.join(rawDir, 'native-input-source-native-freeze.json'));
assert.equal(summary.status, 'COMPLETED');
assert.equal(summary.arms.currentTableBaseline.successfulStages, 17);
assert.equal(summary.arms.sourceNativeAllRows.successfulStages, 17);
assert.equal(summary.arms.currentTableBaseline.totalQueries, 48);
assert.equal(summary.arms.sourceNativeAllRows.totalQueries, 48);
assert.equal(nativeFreeze.nativeInputSha256, await fileSha(path.join(rawDir, 'native-input-source-native-v1.json')));
assert.equal(nativeInput.arms.find((arm) => arm.parser === 'table').contentSha256,
  'f9fd6dc1eba181abd08c372970088cdda1d1b7572114140c7d93f8076f0aff60');
assert.equal(nativeInput.candidateSidecarIncluded, false);

const sourceInputs = {
  run5Freeze: '.local/hyper-relation-audit-20261025/run-5/freeze.json',
  run5Candidates: '.local/hyper-relation-audit-20261025/run-5/evidence-candidates.json',
  run5Chunks: '.local/hyper-relation-audit-20261025/run-5/chunks.json',
  sourceBundle: '.local/hyper-relation-audit-20261025/run-5/source-bundle.json',
  priorV6Validation: '.local/hyper-relation-audit-20261025/run-5-validator-v6/validated-evidence.json',
  tableSidecar: '.local/thai-table-chunking-20261025/run-v2/table-sidecar.json',
  originalTableNativeInput: '.local/thai-table-chunking-20261025/run-v2/native-input.json',
  economyPaddleRaw: '.local/thai-native-20261025/paddle-2/economy.json',
  populationPaddleRaw: '.local/thai-native-20261025/paddle-2/population.json',
  economyPdf: '.local/thai-native-20261025/input/economy.pdf',
  populationPdf: '.local/thai-native-20261025/input/population.pdf',
  gold: 'reports/oxr-thai-2026-10-25/real-native/gold.json',
  goldManifest: 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json',
  nativeTest: 'reports/oxr-thai-2026-10-25/hyper-extract-v1/native.test.js',
  nativeConfig: 'reports/oxr-thai-2026-10-25/real-native/native.config.mjs',
  nativeLauncher: 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/launch-native-v6.mjs',
  nativeMetrics: 'reports/oxr-thai-2026-10-25/real-native/metrics.mjs',
};
const files = new Map();
async function add(absolute) {
  const bytes = await fs.readFile(absolute);
  const relativePath = path.relative(root, absolute).replaceAll(path.sep, '/');
  files.set(relativePath, { path: relativePath, bytes: bytes.length, sha256: sha(bytes) });
}
for (const file of await collectFiles(reportDir)) await add(file);
for (const file of await collectFiles(rawDir)) await add(file);
for (const relativePath of Object.values(sourceInputs)) await add(path.join(root, relativePath));

const manifest = {
  schema: 'zuri.hyper-extraction-repair-evidence.v1',
  status: 'sealed-nonproduction-experiment',
  baseRevision: '49ef1ddbaa4db684bc5282ccc8df379e5a0028c8',
  workingTreeCaveat: 'The checkout contains unrelated pre-existing user changes. This seal binds only the files listed below and does not claim a clean or committed tree.',
  rawRoot: '.local/hyper-extraction-repair-20261025',
  claimBoundary: 'All source-native cell outputs are structural/lexical candidates only, semantic status NOT_ASSESSED, graph admission NONE. No production change or adoption is claimed.',
  completedNative: {
    sameFrozenInput: summary.evidence.nativeInputSha256,
    currentTableBaseline: {
      status: summary.arms.currentTableBaseline.status,
      stages: summary.arms.currentTableBaseline.successfulStages,
      queries: summary.arms.currentTableBaseline.totalQueries,
      contentSha256: summary.arms.currentTableBaseline.armContentSha256,
      rowHit1: summary.arms.currentTableBaseline.rowHit1,
      rowHit5: summary.arms.currentTableBaseline.rowHit5,
      rowAndHeaderHit5: summary.arms.currentTableBaseline.rowAndHeaderHit5,
      documentHit5: summary.arms.currentTableBaseline.documentHit5,
    },
    sourceNativeAllRows: {
      status: summary.arms.sourceNativeAllRows.status,
      stages: summary.arms.sourceNativeAllRows.successfulStages,
      queries: summary.arms.sourceNativeAllRows.totalQueries,
      contentSha256: summary.arms.sourceNativeAllRows.armContentSha256,
      rowHit1: summary.arms.sourceNativeAllRows.rowHit1,
      rowHit5: summary.arms.sourceNativeAllRows.rowHit5,
      rowAndHeaderHit5: summary.arms.sourceNativeAllRows.rowAndHeaderHit5,
      documentHit5: summary.arms.sourceNativeAllRows.documentHit5,
    },
    exactRawRowsInOneChunk: {
      currentTableBaseline: summary.arms.currentTableBaseline.exactRawRowBodiesInOneNativeChunk,
      sourceNativeAllRows: summary.arms.sourceNativeAllRows.exactRawRowBodiesInOneNativeChunk,
      total: summary.arms.sourceNativeAllRows.sourceTableRows,
    },
  },
  goldSha256: summary.evidence.goldSha256,
  sourceInputPaths: sourceInputs,
  files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  manifestPath: path.relative(root, manifestPath).replaceAll(path.sep, '/'),
  entries: manifest.files.length,
  totalBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
  sha256: await fileSha(manifestPath),
  native: manifest.completedNative,
}, null, 2));
