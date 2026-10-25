// Post-run scoring for the single extraction-guided TEXT subset arm.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { headerSupport, rowSupport, validateNativeRows } from '../real-native/metrics.mjs';

const runDir = path.resolve('.local/hyper-extract-20261025/run-3');
const nativeRoot = path.resolve(process.argv[2] || runDir);
const reportDir = path.dirname(fileURLToPath(import.meta.url));
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const hash = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const hashText = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const freeze = await read(path.join(runDir, 'freeze.json'));
const candidates = await read(path.join(runDir, 'candidates.json'));
const validation = await read(path.join(runDir, 'validated-candidates.json'));
const projection = await read(path.join(runDir, 'source-projection.json'));
const nativeInput = await read(path.join(runDir, 'native-input.json'));
const native = await read(path.join(nativeRoot, 'native-hyper', 'native-results.json'));
const nativeState = await read(path.join(nativeRoot, 'native-hyper-state.json'));
const goldPath = path.join(reportDir, '..', 'real-native', 'gold.json');
const priorEvidence = await read(path.join(reportDir, '..', 'real-native', 'evidence-manifest.json'));
const priorVLMetrics = await read(path.join(reportDir, '..', 'paddleocr-vl-v1', 'measurement-summary.json'));
const gold = await read(goldPath);
const goldSha256 = await hash(goldPath);
const candidateSha256 = await hash(path.join(runDir, 'candidates.json'));
const freezeSha256 = await hash(path.join(runDir, 'freeze.json'));
const arm = nativeInput.arms.find((item) => item.parser === 'hyper');

assert.equal(freeze.runId, 'run-3');
assert.equal(candidates.status, 'COMPLETED');
assert.equal(candidates.freezeSha256, freezeSha256);
assert.equal(validation.freezeSha256, freezeSha256);
assert.equal(validation.candidateReceiptSha256, candidateSha256);
assert.equal(projection.candidateReceiptSha256, candidateSha256);
assert.equal(goldSha256.toUpperCase(), priorEvidence.frozen.goldSha256.toUpperCase(), 'Gold differs from the previously frozen benchmark gold');
assert.equal(native.goldSha256?.toLowerCase(), priorEvidence.frozen.goldSha256.toLowerCase(), 'Native harness used a different gold file');
assert.equal(native.frozenGoldSha256?.toLowerCase(), priorEvidence.frozen.goldSha256.toLowerCase(), 'Native harness did not bind the frozen gold manifest');
assert.ok(arm, 'Missing the one Hyper-guided native TEXT subset arm');
assert.equal(arm.projection.freezeSha256, freezeSha256);
assert.equal(arm.projection.candidateReceiptSha256, candidateSha256);
assert.equal(arm.contentSha256, hashText(arm.content));
validateNativeRows(native, arm, gold);
assert.equal(native.status, 'COMPLETED');
assert.equal(native.successfulStages, 17);
assert.equal(native.queries.length, 48);
assert.equal(native.scopeDenial?.denied, true);
assert.ok(native.restart?.generation);

const queries = native.queries.map((item) => {
  const document = gold.documents.find((candidate) => candidate.id === item.doc);
  assert.ok(document, `Unknown gold document ${item.doc}`);
  const query = document.qa.find((candidate) => candidate.id === item.id);
  const row = document.rows.find((candidate) => candidate.id === query.row);
  const rank = (predicate) => {
    const index = item.response.results.findIndex(predicate);
    return index < 0 ? null : index + 1;
  };
  const supportsRow = (result) => result.document === document.id && rowSupport(result.text, row);
  return {
    id: item.id,
    doc: item.doc,
    repetition: item.repetition,
    elapsedMs: item.elapsedMs,
    rowRank: rank(supportsRow),
    rowHeaderTokenRank: rank((result) => supportsRow(result) && headerSupport(result.text, query.headers)),
    documentRank: rank((result) => result.document === document.id),
  };
});
const firstPass = queries.filter((item) => item.repetition === 1);
const repeatPasses = queries.filter((item) => item.repetition > 1);
const hit = (key, cutoff) => firstPass.filter((item) => item[key] !== null && item[key] <= cutoff).length;
const timing = (items) => {
  const values = items.map((item) => item.elapsedMs).sort((a, b) => a - b);
  return {
    count: values.length,
    minMs: values[0],
    medianMs: (values[Math.floor((values.length - 1) / 2)] + values[Math.ceil((values.length - 1) / 2)]) / 2,
    maxMs: values.at(-1),
  };
};
const stableRanks = firstPass.filter((item) => repeatPasses
  .filter((repeat) => repeat.id === item.id && repeat.doc === item.doc)
  .every((repeat) => repeat.rowRank === item.rowRank
    && repeat.rowHeaderTokenRank === item.rowHeaderTokenRank
    && repeat.documentRank === item.documentRank)).length;
const responseUsage = candidates.model.callResponseMetadata.map((item) => item.tokenUsage || {});
const callLatencies = candidates.model.callResponseMetadata.map((item) => item.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b);
const tokenTotals = responseUsage.reduce((sum, usage) => ({
  promptTokens: sum.promptTokens + (usage.prompt_tokens || 0),
  completionTokens: sum.completionTokens + (usage.completion_tokens || 0),
  totalTokens: sum.totalTokens + (usage.total_tokens || 0),
}), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
const uniqueLiteralCandidateNames = new Set(validation.nodes.map((item) => item.name));
const uniqueLiteralRelations = new Set(validation.edges.map((item) => JSON.stringify({
  participants: item.participants,
  description: item.candidateDescription,
})));
const ollamaResources = {
  beforeExtraction: candidates.model.runtimeBeforeExtraction?.models?.map((item) => ({
    name: item.name,
    contextLength: item.context_length,
    sizeBytes: item.size,
    sizeVramBytes: item.size_vram,
    processor: item.processor,
  })) || [],
  afterExtraction: candidates.model.runtimeAfter?.models?.map((item) => ({
    name: item.name,
    contextLength: item.context_length,
    sizeBytes: item.size,
    sizeVramBytes: item.size_vram,
    processor: item.processor,
  })) || [],
};
const nativeSummary = {
  status: native.status,
  successfulStages: native.successfulStages,
  queryCountPerPass: firstPass.length,
  totalQueries: queries.length,
  rowHit1: hit('rowRank', 1),
  rowHit5: hit('rowRank', 5),
  rowAndHeaderTokenHit5: hit('rowHeaderTokenRank', 5),
  documentHit5: hit('documentRank', 5),
  stableMetricRanks: stableRanks,
  chunkCount: native.chunkCount,
  initializationMs: native.initializationMs,
  ingestionToPublishedMs: native.ingestionToPublishedMs,
  submissionMs: native.submissionMs,
  workerMs: native.workerMs,
  pullFinishMs: native.pullFinishMs,
  memoryPeakBytes: native.memoryPeakBytes,
  containerWallMs: Date.parse(nativeState.FinishedAt) - Date.parse(nativeState.StartedAt),
  firstPassLatency: timing(firstPass),
  repeatPassLatency: timing(repeatPasses),
  scopeDenial: native.scopeDenial,
  restart: native.restart,
  gateProbe: native.publication.benchmark,
};
const priorArmComparisons = priorVLMetrics.native.arms.map((item) => ({
  arm: item.parser === 'plain' ? 'Paddle / plain' : item.parser === 'table' ? 'Paddle / table-preserving' : `PaddleOCR-VL v1 / ${item.parser}`,
  report: '../paddleocr-vl-v1/README.md',
  sameRun: false,
  queryCountPerPass: item.queryCount,
  successfulStages: item.successfulStages,
  chunkCount: item.chunkCount,
  rowHit1: item.rowHit1,
  rowHit5: item.rowHit5,
  rowAndHeaderTokenHit5: item.headerTokenHit5,
  documentHit5: item.documentHit5,
  columnBindingHit5: item.columnBindingHit5,
  medianFirstPassQueryMs: item.firstPass.medianMs,
  ingestionToPublishedMs: item.ingestionToPublishedMs,
  memoryPeakBytes: item.memoryPeakBytes,
}));

const summary = {
  schema: 'zuri.hyper-extract-native-evaluation.v1',
  status: 'COMPLETED',
  claimBoundary: 'One Hyper-guided source-zone subset with actual native TEXT ingestion/retrieval. Candidate nodes/edges remain sidecar-only; no Stage 9/10/GKS graph admission is claimed.',
  inputs: {
    freezeSha256,
    sourceBundleSha256: freeze.sourceBundleSha256,
    candidateReceiptSha256: candidateSha256,
    validationSha256: projection.validationSha256,
    nativeInputSha256: await hash(path.join(runDir, 'native-input.json')),
    nativeArmSha256: arm.contentSha256,
    nativeResultsSha256: await hash(path.join(nativeRoot, 'native-hyper', 'native-results.json')),
    runtimeProvenanceSha256: await hash(path.join(nativeRoot, 'native-hyper', 'runtime-provenance.json')),
    nativeHarnessSha256: await hash(path.join(reportDir, 'native.test.js')),
    goldSha256,
    frozenGoldSha256: priorEvidence.frozen.goldSha256,
  },
  extraction: {
    package: { version: candidates.hyperExtractVersion, ...candidates.hyperExtractInstallation, inspectedRelease: freeze.package.inspectedRelease },
    model: {
      tag: candidates.model.tag,
      digest: candidates.model.digest,
      ollamaVersion: candidates.model.ollamaVersion,
      contextLengthObserved: candidates.model.contextLengthObserved,
      contextLengthAfterExtraction: candidates.model.contextLengthAfterExtraction,
      requestedReasoningEffort: candidates.model.requestedReasoningEffort,
      reasoningFieldObserved: candidates.model.reasoningFieldObserved,
      coldLoadMs: candidates.model.coldLoadMs,
      coldLoadNotMeasured: candidates.model.coldLoadNotMeasured,
    },
    settings: candidates.settings,
    requests: candidates.requestBodies.length,
    callLatencyMs: callLatencies.length ? {
      count: callLatencies.length,
      min: callLatencies[0],
      median: (callLatencies[Math.floor((callLatencies.length - 1) / 2)] + callLatencies[Math.ceil((callLatencies.length - 1) / 2)]) / 2,
      max: callLatencies.at(-1),
    } : null,
    tokenTotals,
    candidateOutputCounts: {
      nodeOccurrencesAcrossChunks: validation.nodes.length,
      uniqueLiteralCandidateNameStrings: uniqueLiteralCandidateNames.size,
      edgeOccurrencesAcrossChunks: validation.edges.length,
      uniqueExactParticipantDescriptionStrings: uniqueLiteralRelations.size,
      interpretation: 'Per-chunk output occurrences; exact string dedup is descriptive only and does not assert canonical identity.',
    },
    ollamaResources,
    clientProcessRss: 'not measured; no total-memory estimate is made from client runtime',
    sourceTextChars: projection.totalSourceChars,
    selectedSourceChars: projection.selectedSourceChars,
    omittedSourceChars: projection.omittedSourceChars,
    totalZones: projection.totalZones,
    selectedZones: projection.selectedZones,
    omittedZones: projection.omittedZones,
    sourceCharCoveragePercent: projection.sourceCharCoveragePercent,
    zoneCoveragePercent: projection.zoneCoveragePercent,
    candidateQuality: validation.summary,
    extractionWallMs: candidates.timing.extractionWallMs,
    coldLoadProbe: candidates.model.coldLoadProbe,
    coldLoadNotMeasured: candidates.model.coldLoadNotMeasured,
    reasoningFieldObserved: candidates.model.reasoningFieldObserved,
  },
  native: nativeSummary,
  priorArmComparisons,
  queries,
};
await fs.writeFile(path.join(reportDir, 'measurement-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({
  status: summary.status,
  extraction: summary.extraction,
  native: nativeSummary,
}, null, 2));
