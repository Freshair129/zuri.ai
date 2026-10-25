import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reportDir = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(root, '.local/hyper-fact-audit-20261025');
const freezePath = path.join(rawDir, 'fact-audit-freeze.json');
const freeze = JSON.parse(await fs.readFile(freezePath, 'utf8'));
const sha = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const walk = async (dir) => {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(file));
    else if (entry.isFile()) out.push(file);
  }
  return out;
};
const sourceInputs = {
  run5Freeze: '.local/hyper-relation-audit-20261025/run-5/freeze.json',
  candidateReceipt: '.local/hyper-relation-audit-20261025/run-5/evidence-candidates.json',
  chunks: '.local/hyper-relation-audit-20261025/run-5/chunks.json',
  sourceBundle: '.local/hyper-relation-audit-20261025/run-5/source-bundle.json',
  v6ValidationBaseline: '.local/hyper-relation-audit-20261025/run-5-validator-v6/validated-evidence.json',
  tableSidecar: '.local/thai-table-chunking-20261025/run-v2/table-sidecar.json',
  economyPaddleRaw: '.local/thai-native-20261025/paddle-2/economy.json',
  populationPaddleRaw: '.local/thai-native-20261025/paddle-2/population.json',
  sourceEconomyPdf: '.local/thai-native-20261025/input/economy.pdf',
  sourcePopulationPdf: '.local/thai-native-20261025/input/population.pdf',
  baselineNativeInput: '.local/thai-table-chunking-20261025/run-v2/native-input.json',
  v6NativeInputPrefixSource: '.local/hyper-relation-audit-20261025/run-5-validator-v6/native-input.json',
  sealedGold: 'reports/oxr-thai-2026-10-25/real-native/gold.json',
  sealedGoldManifest: 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json',
  priorV6Measurement: 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/measurement-summary.json',
  tableBaselineMeasurement: 'reports/oxr-thai-2026-10-25/paddleocr-vl-v1/measurement-summary.json',
};
const files = new Map();
const add = async (absolutePath) => {
  const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
  const stat = await fs.stat(absolutePath);
  files.set(relativePath, { path: relativePath, bytes: stat.size, sha256: await sha(absolutePath) });
};

for (const file of await walk(reportDir)) {
  if (path.basename(file) === 'evidence-manifest.json') continue;
  await add(file);
}
for (const file of await walk(path.join(rawDir, 'native-attempt-1'))) await add(file);
for (const file of await walk(path.join(rawDir, 'source-renders'))) await add(file);
for (const relativePath of [
  'fact-audit-freeze.json', 'native-command-geometry-v1.json', 'native-host-preflight.json',
  'native-preflight-attempt-1.txt', 'native-preflight-attempt-2.txt',
  'native-run-geometry-v1.log', 'native-state-geometry-v1.json',
  'validated-evidence-geometry-v1.json', 'source-projection-geometry-v1.json',
  'native-input-geometry-v1.json',
]) await add(path.join(rawDir, relativePath));
for (const relativePath of Object.values(sourceInputs)) await add(path.join(root, relativePath));

const summary = JSON.parse(await fs.readFile(path.join(reportDir, 'measurement-summary.json'), 'utf8'));
const result = {
  schema: 'zuri.hyper-fact-source-audit.v1',
  status: 'sealed-nonproduction-experiment',
  baseRevision: '49ef1ddbaa4db684bc5282ccc8df379e5a0028c8',
  workingTreeCaveat: 'The repository had pre-existing user changes. This seal binds the task artifacts and inputs listed below; it does not claim a clean or committed tree.',
  rawRoot: '.local/hyper-fact-audit-20261025',
  caveat: 'Hashes bind artifact identity and provenance, not semantic correctness. Candidate predicates and descriptions remain NOT_ASSESSED; no graph or production adoption is claimed.',
  factAuditFreezeSha256: await sha(freezePath),
  extractionFreezeSha256: freeze.extractionFreezeSha256,
  candidateReceiptSha256: freeze.candidateReceiptSha256,
  sourceBundleFileSha256: freeze.sourceBundleFileSha256,
  sourceBundleContentSha256: freeze.sourceBundleContentSha256,
  goldSha256: summary.inputs.goldSha256,
  heldCandidateAudit: summary.audit,
  completedNative: {
    status: summary.native.status,
    successfulStages: summary.native.successfulStages,
    queryCount: summary.native.totalQueries,
    arm: summary.inputs.nativeArm,
    armSha256: summary.inputs.nativeArmSha256,
    rowHit1: summary.native.rowHit1,
    rowHit5: summary.native.rowHit5,
    rowAndHeaderTokenHit5: summary.native.rowAndHeaderTokenHit5,
    documentHit5: summary.native.documentHit5,
  },
  files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
};
const manifestPath = path.join(reportDir, 'evidence-manifest.json');
await fs.writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  manifest: path.relative(root, manifestPath).replaceAll(path.sep, '/'),
  entries: result.files.length,
  totalBytes: result.files.reduce((sum, file) => sum + file.bytes, 0),
  native: result.completedNative,
  sha256: await sha(manifestPath),
}, null, 2));
