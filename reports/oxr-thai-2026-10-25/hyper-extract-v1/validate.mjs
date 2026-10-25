import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateAndProject } from './adapter.mjs';

const runDir = '.local/hyper-extract-20261025/run-3';
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (name) => JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8'));
const writeOnce = (name, value) => {
  const destination = path.join(runDir, name);
  if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite validation artifact ${destination}`);
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
};

const bundle = read('source-bundle.json');
const freeze = read('freeze.json');
const candidates = read('candidates.json');
const freezeSha256 = sha256File(path.join(runDir, 'freeze.json'));
if (candidates.freezeSha256 !== freezeSha256) throw new Error('Candidate receipt was produced against a different freeze.json');
const { validation, projection } = validateAndProject(bundle, freeze, candidates);
validation.candidateReceiptSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(runDir, 'candidates.json'))).digest('hex');
validation.freezeSha256 = freezeSha256;
validation.adapterPolicy = 'exact-chunk-same-zone-v2 (post-extraction, pre-gold tightening; it was not predeclared in freeze.json)';
validation.adapterSourceSha256 = sha256File('reports/oxr-thai-2026-10-25/hyper-extract-v1/adapter.mjs');
validation.adapterTestSourceSha256 = sha256File('reports/oxr-thai-2026-10-25/hyper-extract-v1/adapter.test.mjs');
projection.candidateReceiptSha256 = validation.candidateReceiptSha256;
projection.validatorVersion = validation.adapterVersion;
projection.validatorSourceSha256 = validation.adapterSourceSha256;
projection.validationSha256 = sha256(JSON.stringify(validation));
writeOnce('validated-candidates.json', validation);
writeOnce('source-projection.json', projection);
console.log(JSON.stringify({
  status: 'VALIDATED_SOURCE_TEXT_ONLY',
  candidateReceiptSha256: validation.candidateReceiptSha256,
  summary: validation.summary,
  projection: {
    chars: projection.chars,
    sha256: projection.textSha256,
    selectedZones: projection.selectedZones,
    totalZones: projection.totalZones,
    selectedSourceChars: projection.selectedSourceChars,
    totalSourceChars: projection.totalSourceChars,
    omittedSourceChars: projection.omittedSourceChars,
    sourceCharCoveragePercent: projection.sourceCharCoveragePercent,
  },
  nativeGksGraphAdmission: 'NONE',
}, null, 2));
