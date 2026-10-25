import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const runDir = '.local/hyper-extract-20261025/run-3';
const originalInputPath = '.local/thai-table-chunking-20261025/run-v2/native-input.json';
const controlPath = 'apps/server/tests/fixtures/genesisrag17-corpus-v1.json';
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const sha256Bytes = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const destination = path.join(runDir, 'native-input.json');
if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite ${destination}`);
const original = readJson(originalInputPath);
const control = readJson(controlPath);
const bundle = readJson(path.join(runDir, 'source-bundle.json'));
const freezeBytes = fs.readFileSync(path.join(runDir, 'freeze.json'));
const freeze = JSON.parse(freezeBytes.toString('utf8'));
const candidateBytes = fs.readFileSync(path.join(runDir, 'candidates.json'));
const candidates = JSON.parse(candidateBytes.toString('utf8'));
const validation = readJson(path.join(runDir, 'validated-candidates.json'));
const projection = readJson(path.join(runDir, 'source-projection.json'));
const freezeSha256 = sha256Bytes(freezeBytes);
const candidateSha256 = sha256Bytes(candidateBytes);
if (candidates.freezeSha256 !== freezeSha256 || validation.freezeSha256 !== freezeSha256) {
  throw new Error('Run3 extraction/validation freeze hash does not match freeze.json');
}
if (validation.candidateReceiptSha256 !== candidateSha256 || projection.candidateReceiptSha256 !== candidateSha256) {
  throw new Error('Run3 validation/projection does not bind candidates.json');
}
if (validation.sourceBundleSha256 !== freeze.sourceBundleSha256 || projection.sourceBundleSha256 !== freeze.sourceBundleSha256) {
  throw new Error('Run3 validation/projection does not bind frozen source bundle');
}
if (sha256(JSON.stringify(validation)) !== projection.validationSha256) {
  throw new Error('Run3 source projection does not bind the exact validated-candidates.json object');
}
if (freeze.runId !== 'run-3' || candidates.status !== 'COMPLETED' || !validation.graphAdmission.startsWith('NONE;')) {
  throw new Error('Run3 candidate graph is incomplete or outside the sidecar-only boundary');
}
const tableArm = original.arms.find((arm) => arm.parser === 'table');
if (!tableArm || tableArm.ranges.length !== 2) throw new Error('Frozen native table arm not found');
const controlPrefix = tableArm.content.slice(0, tableArm.ranges[0].start);
const expectedControlPrefix = `${control.text}\n\n# Public PDF ${bundle.sourceRanges[0].id}\n\n`;
if (controlPrefix !== expectedControlPrefix) throw new Error('Control and source-heading prefix differs from the existing frozen native input');

const rangeById = new Map(bundle.sourceRanges.map((range) => [range.id, range]));
let cursor = controlPrefix.length;
const ranges = [];
for (const snippet of projection.snippets) {
  const source = rangeById.get(snippet.sourceId);
  if (!source) throw new Error(`Projection references unknown source ${snippet.sourceId}`);
  const localStart = snippet.sourceStart - source.sourceStart;
  const localEnd = snippet.sourceEnd - source.sourceStart;
  if (source.text.slice(localStart, localEnd) !== snippet.text || sha256(snippet.text) !== snippet.sourceTextSha256) {
    throw new Error(`Projection snippet is not an exact frozen source slice: ${snippet.zoneId}`);
  }
  if (ranges.length) cursor += 2;
  const start = cursor;
  const end = start + snippet.text.length;
  ranges.push({
    id: snippet.zoneId,
    doc: snippet.sourceId,
    zoneId: snippet.zoneId,
    start,
    end,
    pdfSha256: source.pdfSha256,
    textSha256: snippet.sourceTextSha256,
    chars: snippet.text.length,
  });
  cursor = end;
}
const content = controlPrefix + projection.text;
if (cursor !== content.length) throw new Error('Native projection range offsets do not cover the assembled content');

const hyperArm = {
  parser: 'hyper',
  content,
  contentSha256: sha256(content),
  ranges,
  projection: {
    type: 'extraction-guided source-zone subset',
    sourceBundleSha256: projection.sourceBundleSha256,
    freezeSha256,
    candidateReceiptSha256: projection.candidateReceiptSha256,
    validationSha256: projection.validationSha256,
    sourceTextSha256: projection.textSha256,
    selectedZones: projection.selectedZones,
    totalZones: projection.totalZones,
    selectedSourceChars: projection.selectedSourceChars,
    totalSourceChars: projection.totalSourceChars,
    omittedSourceChars: projection.omittedSourceChars,
    graphFieldsIncluded: false,
    candidateTextIncluded: false,
  },
};
const output = {
  ...original,
  arms: [...original.arms, hyperArm],
  hyperCandidateSidecar: {
    admission: 'sidecar only; no Hyper nodes or edges were submitted to GKS',
    graphStatus: validation.graphAdmission,
    candidateReceiptSha256: projection.candidateReceiptSha256,
    validationSha256: projection.validationSha256,
    freezeSha256,
  },
};
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  status: 'BUILT_EXACT_TEXT_PROJECTION',
  output: destination,
  arm: hyperArm.parser,
  armChars: content.length,
  rangeCount: ranges.length,
  ranges: ranges.map(({ id, doc, start, end, textSha256, chars }) => ({ id, doc, start, end, textSha256, chars })),
  validation: validation.summary,
  projectionSha256: sha256(hyperArm.content),
  graphSentToGks: false,
}, null, 2));
