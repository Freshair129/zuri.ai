// Score only after the run-5 candidate output, v6 validator and TEXT projection are frozen.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { headerSupport, rowSupport, validateNativeRows } from '../real-native/metrics.mjs';

const runDir = path.resolve('.local/hyper-relation-audit-20261025/run-5-validator-v6');
const inferenceDir = path.resolve('.local/hyper-relation-audit-20261025/run-5');
const nativeRoot = path.resolve(process.argv[2] || path.join(runDir, 'native-evidence-v6-attempt-2'));
const reportDir = path.dirname(fileURLToPath(import.meta.url));
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const hash = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const hashText = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const freezePath = path.join(inferenceDir, 'freeze.json');
const candidatePath = path.join(inferenceDir, 'evidence-candidates.json');
const validatorFreezePath = path.join(runDir, 'validator-freeze.json');
const validationPath = path.join(runDir, 'validated-evidence.json');
const projectionPath = path.join(runDir, 'source-projection.json');
const nativeInputPath = path.join(runDir, 'native-input.json');
const nativeResultsPath = path.join(nativeRoot, 'native-results.json');
const nativeStatePath = path.join(runDir, 'native-evidence-state-attempt-2.json');

const freeze = await read(freezePath);
const candidates = await read(candidatePath);
const validation = await read(validationPath);
const projection = await read(projectionPath);
const nativeInput = await read(nativeInputPath);
const native = await read(nativeResultsPath);
const nativeState = await read(nativeStatePath);
const validatorFreeze = await read(validatorFreezePath);
const goldPath = path.resolve('reports/oxr-thai-2026-10-25/real-native/gold.json');
const priorEvidence = await read(path.resolve('reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json'));
const priorVLMetrics = await read(path.resolve('reports/oxr-thai-2026-10-25/paddleocr-vl-v1/measurement-summary.json'));

const freezeSha256 = await hash(freezePath);
const candidateSha256 = await hash(candidatePath);
const validatorFreezeSha256 = await hash(validatorFreezePath);
const validationSha256 = await hash(validationPath);
const canonicalValidationSha256 = hashText(JSON.stringify(validation));
const projectionSha256 = await hash(projectionPath);
const nativeInputSha256 = await hash(nativeInputPath);
const nativeResultsSha256 = await hash(nativeResultsPath);
const runtimeProvenanceSha256 = await hash(path.join(nativeRoot, 'runtime-provenance.json'));
const goldSha256 = await hash(goldPath);
const gold = await read(goldPath);
const expectedGoldSha256 = priorEvidence.frozen?.goldSha256?.toLowerCase();
const candidateChunks = candidates.documents.flatMap((document) => document.chunks);
const candidateResponses = candidateChunks.map((chunk) => chunk.callResponse).filter(Boolean);
const arm = nativeInput.arms.find((item) => item.parser === 'hyper-evidence-v6');

assert.equal(freeze.runId, 'run-5');
assert.equal(candidates.runId, 'run-5');
assert.equal(candidates.status, 'COMPLETED');
assert.equal(candidates.freezeSha256, freezeSha256);
assert.equal(candidates.sourceBundleSha256, freeze.source.sourceBundleSha256);
assert.equal(candidates.settings.actualStructuredCallStarts, 23);
assert.equal(candidates.settings.actualStructuredCallResponses, 23);
assert.equal(candidates.settings.actualStructuredCallErrors, 0);
assert.equal(candidateChunks.length, 23);
assert.ok(candidateChunks.every((chunk) => chunk.callResponse?.done === true && chunk.callResponse?.done_reason === 'stop'));
assert.equal(validatorFreeze.inference.freezeSha256, freezeSha256);
assert.equal(validatorFreeze.inference.candidateReceiptSha256, candidateSha256);
assert.equal(validatorFreezeSha256, validation.validatorFreezeSha256);
assert.equal(validatorFreezeSha256, projection.validatorFreezeSha256);
assert.equal(validatorFreeze.validator.adapterSourceSha256, await hash(path.resolve('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/evidence-adapter-v3.mjs')));
assert.equal(validatorFreeze.validator.adapterTestsSha256, await hash(path.resolve('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/evidence-adapter-v3.test.mjs')));
assert.equal(validatorFreeze.validator.builderSourceSha256, await hash(path.resolve('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/validate-and-build-native-v6.mjs')));
assert.equal(validation.inferenceFreezeSha256, freezeSha256);
assert.equal(validation.candidateReceiptSha256, candidateSha256);
assert.equal(validation.sourceBundleSha256, freeze.source.sourceBundleSha256);
assert.equal(validation.semanticStatus, 'NOT_ASSESSED');
assert.equal(projection.inferenceFreezeSha256, freezeSha256);
assert.equal(projection.candidateReceiptSha256, candidateSha256);
assert.equal(projection.validationObjectSha256, canonicalValidationSha256);
assert.equal(projection.sourceBundleSha256, freeze.source.sourceBundleSha256);
assert.equal(projectionSha256.length, 64);
assert.equal(projection.sourceTextOnly, true);
assert.equal(projection.candidateDescriptionsIncluded, false);
assert.equal(projection.candidateGraphIncluded, false);
assert.equal(projection.semanticStatus, 'NOT_ASSESSED');
assert.equal(nativeInput.hyperCandidateSidecar.semanticStatus, 'NOT_ASSESSED');
assert.equal(nativeInput.hyperCandidateSidecar.candidateReceiptSha256, candidateSha256);
assert.equal(nativeInput.hyperCandidateSidecar.validatorFreezeSha256, validatorFreezeSha256);
assert.equal(nativeInput.hyperCandidateSidecar.validationObjectSha256, canonicalValidationSha256);
assert.ok(arm, 'Missing budgeted evidence TEXT subset arm');
assert.equal(arm.projection.inferenceFreezeSha256, freezeSha256);
assert.equal(arm.projection.validatorFreezeSha256, validatorFreezeSha256);
assert.equal(arm.projection.candidateReceiptSha256, candidateSha256);
assert.equal(arm.projection.validationObjectSha256, canonicalValidationSha256);
assert.equal(arm.projection.sourceTextSha256, projection.textSha256);
assert.equal(arm.projection.graphFieldsIncluded, false);
assert.equal(arm.projection.candidateTextIncluded, false);
assert.equal(arm.contentSha256, hashText(arm.content));
assert.equal(goldSha256.toLowerCase(), expectedGoldSha256, 'Gold differs from the previously frozen benchmark gold');
assert.equal(native.goldSha256?.toLowerCase(), expectedGoldSha256, 'Native harness used a different gold file');
assert.equal(native.frozenGoldSha256?.toLowerCase(), expectedGoldSha256, 'Native harness did not bind the frozen gold manifest');
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
  assert.ok(query, `Unknown gold query ${item.doc}/${item.id}`);
  const row = document.rows.find((candidate) => candidate.id === query.row);
  assert.ok(row, `Unknown gold row ${item.doc}/${query.row}`);
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
const candidateOutputCounts = {
  factOccurrencesAcrossChunks: candidateChunks.reduce((sum, chunk) => sum + chunk.facts.length, 0),
  relationOccurrencesAcrossChunks: candidateChunks.reduce((sum, chunk) => sum + chunk.relations.length, 0),
  factEvidenceStatuses: validation.summary.facts,
  relationEvidenceStatuses: validation.summary.relations,
  semanticStatus: validation.semanticStatus,
  interpretation: 'Budget-limited model candidate occurrences and post-extraction lexical statuses; neither is exhaustive or semantic acceptance.',
};
const responseUsage = candidateResponses.map((response) => ({
  promptTokens: response.prompt_eval_count || 0,
  completionTokens: response.eval_count || 0,
  totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
}));
const tokenTotals = responseUsage.reduce((sum, usage) => ({
  promptTokens: sum.promptTokens + usage.promptTokens,
  completionTokens: sum.completionTokens + usage.completionTokens,
  totalTokens: sum.totalTokens + usage.totalTokens,
}), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
const callLatencies = candidateChunks.map((chunk) => chunk.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b);
const callLatency = callLatencies.length ? {
  count: callLatencies.length,
  minMs: callLatencies[0],
  medianMs: (callLatencies[Math.floor((callLatencies.length - 1) / 2)] + callLatencies[Math.ceil((callLatencies.length - 1) / 2)]) / 2,
  maxMs: callLatencies.at(-1),
} : null;

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
  schema: 'zuri.hyper-relation-evidence-aware-native-evaluation.v1',
  status: 'COMPLETED',
  claimBoundary: 'One budgeted Hyper evidence-guided source-zone subset with actual native TEXT ingestion/retrieval. Candidate graph remains sidecar-only; no Stage 9/10/GKS graph admission is claimed.',
  inputs: {
    freezeSha256,
    validatorFreezeSha256,
    sourceBundleSha256: freeze.source.sourceBundleSha256,
    candidateReceiptSha256: candidateSha256,
    validatedEvidenceFileSha256: validationSha256,
    validationObjectSha256: canonicalValidationSha256,
    projectionSha256,
    nativeInputSha256,
    nativeArmSha256: arm.contentSha256,
    nativeResultsSha256,
    runtimeProvenanceSha256,
    nativeHarnessSha256: await hash(path.resolve('reports/oxr-thai-2026-10-25/hyper-extract-v1/native.test.js')),
    nativeLauncherSha256: await hash(path.resolve('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/launch-native-v6.mjs')),
    goldSha256,
    frozenGoldSha256: expectedGoldSha256,
  },
  extraction: {
    model: {
      tag: candidates.model.tag,
      digest: candidates.model.digest,
      ollamaVersion: candidates.model.ollamaVersion,
      endpoint: freeze.inference.endpoint,
      contextLengthObserved: candidates.model.contextLengthObserved,
      contextLengthAfterExtraction: candidates.model.contextLengthAfterExtraction,
      coldLoadNotMeasured: 'Model was already resident; no cold-load measurement was made.',
    },
    settings: candidates.settings,
    calls: candidateResponses.length,
    callLatency,
    tokenTotals,
    candidateOutputCounts,
    candidateBudget: freeze.inference.candidateLimits,
    budgetedNonExhaustive: true,
    extractionWallMs: candidates.timing.extractionWallMs,
    clientProcessRss: 'not measured; no total-memory estimate is made from client runtime',
  },
  projection: {
    selectedZones: projection.selectedZones,
    totalZones: projection.totalZones,
    selectedSourceChars: projection.selectedSourceChars,
    totalSourceChars: projection.totalSourceChars,
    omittedSourceChars: projection.omittedSourceChars,
    coveragePct: projection.coveragePct,
    graphIncluded: projection.candidateGraphIncluded,
    semanticStatus: projection.semanticStatus,
  },
  native: nativeSummary,
  historicalComparisons: priorArmComparisons,
  queries,
};

const outputPath = path.join(reportDir, 'measurement-summary.json');
await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status: summary.status, summaryPath: outputPath, extraction: summary.extraction, projection: summary.projection, native: nativeSummary }, null, 2));
