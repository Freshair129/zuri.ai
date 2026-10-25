import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const reportDir = 'reports/oxr-thai-2026-10-25/hyper-extract-v1';
const rawRoot = '.local/hyper-extract-20261025';
const outputPath = path.join(reportDir, 'evidence-manifest.json');
if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}`);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return filesUnder(absolute);
    if (entry.isFile()) return [absolute];
    return [];
  });
}

const files = new Set();
for (const file of filesUnder(reportDir)) {
  if (path.resolve(file) !== path.resolve(outputPath)) files.add(file);
}
for (const run of ['run-1', 'run-2', 'run-3']) {
  const absolute = path.join(rawRoot, run);
  if (!fs.existsSync(absolute)) continue;
  for (const file of filesUnder(absolute)) files.add(file);
}
for (const file of ['smoke-result.json', 'smoke-result-2.json']) {
  const absolute = path.join(rawRoot, file);
  if (fs.existsSync(absolute)) files.add(absolute);
}
for (const file of [
  'reports/oxr-thai-2026-10-25/real-native/README.md',
  'reports/oxr-thai-2026-10-25/real-native/gold.json',
  'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json',
  'reports/oxr-thai-2026-10-25/table-chunking/README.md',
  'reports/oxr-thai-2026-10-25/table-chunking/measurement-summary.json',
  'reports/oxr-thai-2026-10-25/table-chunking/evidence-manifest.json',
  'reports/oxr-thai-2026-10-25/paddleocr-vl-v1/README.md',
  'reports/oxr-thai-2026-10-25/paddleocr-vl-v1/measurement-summary.json',
  'reports/oxr-thai-2026-10-25/paddleocr-vl-v1/evidence-manifest.json',
]) files.add(file);

const records = [...files].sort().map((file) => {
  const bytes = fs.readFileSync(file);
  return { path: file.replaceAll(path.sep, '/'), bytes: bytes.length, sha256: sha256(bytes) };
});
const manifest = {
  schema: 'hyper-extract-thai-evidence.v1',
  baseRevision: '49ef1ddbaa4db684bc5282ccc8df379e5a0028c8',
  rawRoot,
  caveat: 'Hashes bind file identity and provenance; they do not establish semantic correctness. Candidate graph data stayed outside native GKS facts.',
  protocolSha256: sha256(fs.readFileSync(path.join(reportDir, 'protocol.json'))),
  sourceBundleSha256: JSON.parse(fs.readFileSync(path.join(reportDir, 'protocol.json'), 'utf8')).sourceBundleSha256,
  nativeGoldSha256: '976e843a970065b31b984f11fa933434a38a3f824f27b34117b333eb85789303',
  completedRun: {
    runId: 'run-3',
    extractionStatus: 'COMPLETED',
    chunks: 23,
    requests: 55,
    responses: 55,
    extractionFailures: 0,
    nativeStatus: 'COMPLETED',
    nativeStages: 17,
    fixedQueries: 48,
  },
  files: records,
};
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ outputPath, files: records.length, totalBytes: records.reduce((sum, item) => sum + item.bytes, 0), protocolSha256: manifest.protocolSha256 }, null, 2));
