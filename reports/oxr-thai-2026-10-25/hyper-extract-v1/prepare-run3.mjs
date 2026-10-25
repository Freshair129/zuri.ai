import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const previousRun = '.local/hyper-extract-20261025/run-2';
const runDir = '.local/hyper-extract-20261025/run-3';
const inputPath = '.local/thai-table-chunking-20261025/run-v2/native-input.json';
const sidecarPath = '.local/thai-table-chunking-20261025/run-v2/table-sidecar.json';
const upstreamPath = '.local/hyper-extract-20261025/upstream';
const packagePath = path.join(upstreamPath, 'hyperextract');
const runnerPath = 'reports/oxr-thai-2026-10-25/hyper-extract-v1/extract-json-schema.py';
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const sha256Bytes = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = (file) => sha256Bytes(fs.readFileSync(file));

function packageFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__pycache__' ? [] : packageFiles(absolute);
    if (!entry.isFile() || entry.name.endsWith('.pyc')) return [];
    return [absolute];
  }).sort((a, b) => {
    const left = path.relative(directory, a).replaceAll(path.sep, '/');
    const right = path.relative(directory, b).replaceAll(path.sep, '/');
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function sourceTreeSha256(directory) {
  const files = packageFiles(directory);
  const manifest = files.map((file) => `${path.relative(directory, file).replaceAll(path.sep, '/') }\0${sha256File(file)}\n`).join('');
  return sha256(manifest);
}

const previousBundleBytes = fs.readFileSync(path.join(previousRun, 'source-bundle.json'));
const bundle = JSON.parse(previousBundleBytes.toString('utf8'));
const previousFreeze = JSON.parse(fs.readFileSync(path.join(previousRun, 'freeze.json'), 'utf8'));
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
const inputSha256 = sha256File(inputPath);
const sidecarSha256 = sha256File(sidecarPath);
if (bundle.inputSha256 !== inputSha256 || bundle.sidecarSha256 !== sidecarSha256) throw new Error('Frozen input/sidecar hashes changed since run2 preparation');
if (sha256(JSON.stringify(bundle)) !== previousFreeze.sourceBundleSha256) throw new Error('Run2 bundle no longer matches its immutable freeze');
const tableArm = input.arms.find((arm) => arm.parser === 'table');
if (!tableArm || sha256(tableArm.content) !== tableArm.contentSha256) throw new Error('Frozen Paddle table arm failed content hash validation');
for (const range of bundle.sourceRanges) {
  const frozenRange = tableArm.ranges.find((item) => item.id === range.id);
  if (!frozenRange || frozenRange.start !== range.sourceStart || frozenRange.end !== range.sourceEnd) throw new Error(`Source range differs from frozen Paddle arm: ${range.id}`);
  const exact = tableArm.content.slice(range.sourceStart, range.sourceEnd);
  if (exact !== range.text || sha256(exact) !== range.textSha256 || frozenRange.textSha256 !== range.textSha256) throw new Error(`Frozen source range mismatch: ${range.id}`);
}
for (const zone of bundle.zones) {
  const exact = tableArm.content.slice(zone.sourceStart, zone.sourceEnd);
  if (exact !== zone.text) throw new Error(`Zone is not an exact frozen Paddle source slice: ${zone.id}`);
}
if (bundle.packetCount !== sidecar.packets.length) throw new Error('Table packet count changed since run2 preparation');

const sourceCommit = execFileSync('git', ['-C', upstreamPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const workingTree = execFileSync('git', ['-C', upstreamPath, 'status', '--porcelain'], { encoding: 'utf8' });
if (sourceCommit !== 'a8e27199ffd3984042e870d0b6963810a0d70f5d' || workingTree.trim()) throw new Error(`Unexpected Hyper-Extract source checkout: ${sourceCommit}; dirty=${Boolean(workingTree.trim())}`);
const freeze = structuredClone(previousFreeze);
freeze.runId = 'run-3';
freeze.package = {
  name: 'hyperextract',
  version: '0.10.5',
  installation: {
    kind: 'editable local source checkout',
    sourceRootRelative: '.local/hyper-extract-20261025/upstream/hyperextract',
    sourceCommit,
    sourceTreeSha256: sourceTreeSha256(packagePath),
  },
  inspectedRelease: { tag: 'v0.10.5', commit: '0dc002bb1029fd34b21e47602e406ef7880c8673' },
};
freeze.inference = {
  ...freeze.inference,
  chunkSizeChars: 2048,
  chunkOverlapChars: 256,
  maxWorkers: 1,
  maxOutputTokens: 2048,
  requestMaxTokensField: 2048,
  structuredOutputMethod: 'json_schema',
  perCallTimeoutSeconds: 120,
  maxRetries: 0,
  expectedContextLength: 4096,
  contextSize: 'OpenAI-compatible requests omit context; require Ollama /api/ps context_length=4096 before extraction; cold-load probe requests num_ctx=4096 if model is absent',
};
freeze.executionAdapter = {
  kind: 'ChatOpenAI subclass mapping upstream function_calling structured-output requests to json_schema',
  upstreamSourceModified: false,
  runner: path.basename(runnerPath),
  runnerSha256: sha256File(runnerPath),
  actualRequestCapture: 'record path, model, max_tokens, max_completion_tokens, reasoning_effort, response_format type/name, and prompt-size counts for every call',
};
freeze.runBoundary = {
  input: 'Hyper-Extract receives only chunks from the frozen Paddle OCR text projection derived from the two PDFs; it does not parse PDF bytes or run OCR',
  output: 'candidate graph remains an unvalidated sidecar; exact source text projection is a separate native TEXT input',
};

fs.mkdirSync(runDir, { recursive: true });
const bundlePath = path.join(runDir, 'source-bundle.json');
const freezePath = path.join(runDir, 'freeze.json');
if (fs.existsSync(bundlePath) || fs.existsSync(freezePath)) throw new Error('Refusing to overwrite a run3 artifact');
fs.writeFileSync(bundlePath, previousBundleBytes, { flag: 'wx' });
fs.writeFileSync(freezePath, `${JSON.stringify(freeze, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  runDir,
  sourceBundleSha256: freeze.sourceBundleSha256,
  freezeSha256: sha256File(freezePath),
  runnerSha256: freeze.executionAdapter.runnerSha256,
  sourceTreeSha256: freeze.package.sourceTreeSha256,
  sourceCommit,
  sourceChars: bundle.sourceChars,
  zones: bundle.zoneCount,
  packets: bundle.packetCount,
  ranges: bundle.sourceRanges.map(({ id, sourceStart, sourceEnd, textSha256 }) => ({ id, sourceStart, sourceEnd, textSha256 })),
}, null, 2));
