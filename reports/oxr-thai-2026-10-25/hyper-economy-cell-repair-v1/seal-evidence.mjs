import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const reportRoot = 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1';
const rawRoot = '.local/hyper-economy-cell-repair-20261025';
const manifestPath = path.join(repo, reportRoot, 'evidence-manifest.json');
const skippedNames = new Set(['__pycache__', 'debug_chunks.mjs', 'evidence-manifest.json']);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectTree(relativeRoot) {
  const absoluteRoot = path.join(repo, relativeRoot);
  const files = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skippedNames.has(item.name)) continue;
      const absolute = path.join(dir, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) visit(absolute);
      else if (item.isFile()) files.push(absolute);
    }
  }
  visit(absoluteRoot);
  return files;
}

const upstreamPaths = [
  '.local/thai-native-20261025/input/economy.pdf',
  '.local/thai-native-20261025/paddle-2/economy.json',
  '.local/hyper-held-cell-audit-20261025/held-cell-enumeration-v1.json',
  '.local/hyper-held-cell-audit-20261025/held-cell-freeze-v1.json',
  '.local/hyper-held-cell-audit-20261025/pdf-vector-geometry-v1.json',
  '.local/hyper-held-cell-audit-20261025/pdf-cell-value-freeze-v1.json',
  '.local/hyper-held-cell-audit-20261025/pdf-cell-value-evidence-v1.json',
  '.local/hyper-relation-audit-20261025/run-5/source-bundle.json',
  '.local/thai-table-chunking-20261025/run-v2/native-input.json',
  '.local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2.json',
  '.local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2-freeze.json',
  '.local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2.json',
  '.local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2-freeze.json',
  '.local/hyper-held-cell-audit-20261025/native-table-current-attempt-1/native-results.json',
  '.local/hyper-held-cell-audit-20261025/native-table-current-attempt-1/chunks.json',
  '.local/hyper-held-cell-audit-20261025/native-source-pdf-repair-v1-attempt-2/native-results.json',
  '.local/hyper-held-cell-audit-20261025/native-source-pdf-repair-v1-attempt-2/chunks.json',
  'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json',
];

const entryPaths = [
  ...collectTree(reportRoot),
  ...collectTree(rawRoot),
  ...upstreamPaths.map((relative) => path.join(repo, relative)),
].sort((a, b) => path.relative(repo, a).replaceAll('\\', '/').localeCompare(path.relative(repo, b).replaceAll('\\', '/')));

const entries = entryPaths.map((absolute) => ({
  path: path.relative(repo, absolute).replaceAll('\\', '/'),
  bytes: fs.statSync(absolute).size,
  sha256: sha256(absolute),
}));

const manifest = {
  schema: 'zuri.hyper-economy-cell-repair-evidence-manifest.v1',
  status: 'SEALED',
  baseRevision: '49ef1ddbaa4db684bc5282ccc8df379e5a0028c8',
  measuredBaselineAttempt: 'native-table-current-attempt-1',
  historicalReferenceAttempt: 'native-source-pdf-repair-v1-attempt-2',
  measuredTreatmentAttempt: 'native-combined-attempt-1',
  combinedNativeInputSha256: 'b71bdc93b5175bf760cfb5d669dc2f8cc06e4c4a72c65ecb7c43368eaaf9f06c',
  combinedNativeFreezeSha256: '8db7f4ec59731f17c60c8d0191ce719fb9eb59d9be7101b6609eeaabcfde4e41',
  noQaChunkerProbeSha256: '8eaa23ce3366d96d65b91faaf94b0159241345e234236a73ed86a967fa623d53',
  hostPreflightSha256: 'cf947df11acba4538af673f26ea3c3433d3ce363a00e07d9cffdd1135fb996a0',
  nativeResultsSha256: '035f6db1f558dd58ec5220abfff3357dba6c31e7ba626d7889a06a02be6337ea',
  goldSha256: '976e843a970065b31b984f11fa933434a38a3f824f27b34117b333eb85789303',
  entries,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`sealed ${entries.length} entries; manifest ${sha256(manifestPath)}\n`);
