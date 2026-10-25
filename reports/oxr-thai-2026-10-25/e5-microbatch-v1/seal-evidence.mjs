import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reportDir = 'reports/oxr-thai-2026-10-25/e5-microbatch-v1';
const output = path.join(root, reportDir, 'evidence-manifest.json');
const included = new Set();

function addFile(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const absolute = path.join(root, normalized);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`required evidence file is missing: ${normalized}`);
  }
  included.add(normalized);
}

function addTree(relativePath) {
  const absolute = path.join(root, relativePath);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) addTree(child);
    else if (entry.isFile()) addFile(child);
  }
}

const reportFiles = [
  `${reportDir}/README.md`,
  `${reportDir}/measurement-summary.json`,
  `${reportDir}/resource-diagnosis.md`,
  `${reportDir}/resource-diagnosis.json`,
  `${reportDir}/embedder_batch32.py`,
  `${reportDir}/test_embedder_batching.py`,
  `${reportDir}/compare_captures.py`,
  `${reportDir}/test_compare_captures.py`,
  `${reportDir}/pair_contracts.mjs`,
  `${reportDir}/test_pair_contracts.mjs`,
  `${reportDir}/evaluate_pair.mjs`,
  `${reportDir}/run-native-paired.ps1`,
  `${reportDir}/seal-evidence.mjs`,
  'reports/README.md',
  'docs/README.md',
  'docs/change-requests/README.md',
  'docs/change-requests/integration/line-knowledge-memory-unified-flow-20261024.md',
  '.local/e5-microbatch-20261025/experiment-freeze.json',
  '.local/e5-microbatch-20261025/native-host-preflight-e5-global-v1.json',
  '.local/e5-microbatch-20261025/native-host-preflight-e5-batch32-v1.json',
  '.local/e5-microbatch-20261025/captured-vector-parity.json',
  '.local/e5-microbatch-20261025/native-pair-summary-final.json',
  '.local/e5-microbatch-20261025/test-receipt.json',
  '.local/e5-microbatch-20261025/test-embedder-batching.log',
  '.local/e5-microbatch-20261025/test-compare-captures-receipt.json',
  '.local/e5-microbatch-20261025/test-compare-captures.log',
  '.local/e5-microbatch-20261025/test-pair-contracts-final-receipt.json',
  '.local/e5-microbatch-20261025/test-pair-contracts-final.log',
  '.local/hyper-economy-cell-repair-20261025/native-input-economy-pdf-rows-v1.json',
  '.local/hyper-economy-cell-repair-20261025/native-input-economy-pdf-rows-freeze-v1.json',
  '.local/hyper-economy-cell-repair-20261025/native-combined-attempt-1/chunks.json',
  'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json',
];
for (const file of reportFiles) addFile(file);

for (const mode of ['global', 'batch32']) {
  const arm = `.local/e5-microbatch-20261025/native-${mode}-attempt-1`;
  for (const file of [
    'chunks.json',
    'executed-native.test.js',
    'native-command.json',
    'native-launch-profile.json',
    'native-results.json',
    'native-run.log',
    'native-state.json',
    'publication.json',
    'runtime-provenance.json',
    'stages.json',
  ]) addFile(`${arm}/${file}`);
  addTree(`${arm}/embedding-capture`);
}

const entries = [...included].sort().map((relativePath) => {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return {
    path: relativePath,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
});

const manifest = {
  schema: 'zuri.e5-microbatch-evidence-manifest.v1',
  status: 'SEALED',
  baseRevision: '49ef1ddbaa4db684bc5282ccc8df379e5a0028c8',
  sourceInputSha256: 'b71bdc93b5175bf760cfb5d669dc2f8cc06e4c4a72c65ecb7c43368eaaf9f06c',
  contentHash: 'a6259e7e4f0f84d2e54f8fddf952eeb214a31f20502b6c7b8515d1dfdf1246d9',
  helperOverrideSha256: 'ef9935362c9a03184b6465c3c7c5c731c23a8030e48ea852069a08700aae68da',
  finalPairSummarySha256: crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, '.local/e5-microbatch-20261025/native-pair-summary-final.json')))
    .digest('hex'),
  excludedDiagnostics: [{
    path: '.local/e5-microbatch-20261025/captured-vector-parity-retry.json',
    status: 'INVALID_EMPTY_TRACE_RETRY',
    reason: 'Created before empty captures were rejected; it contains no requests or vectors and is not parity evidence.',
  }],
  entries,
};
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
console.log(JSON.stringify({ status: manifest.status, entries: entries.length, output: `${reportDir}/evidence-manifest.json` }, null, 2));
