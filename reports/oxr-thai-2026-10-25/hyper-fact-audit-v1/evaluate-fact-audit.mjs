// Score the frozen geometry-derived source TEXT arm after projection freeze.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { headerSupport, rowSupport, validateNativeRows } from '../real-native/metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rawDir = path.join(root, '.local/hyper-fact-audit-20261025');
const run5Dir = path.join(root, '.local/hyper-relation-audit-20261025/run-5');
const reportDir = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.join(rawDir, 'native-attempt-1');
const priorV6SummaryPath = path.join(root, 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/measurement-summary.json');
const tableBaselineSummaryPath = path.join(root, 'reports/oxr-thai-2026-10-25/paddleocr-vl-v1/measurement-summary.json');
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const hashText = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const freezePath = path.join(rawDir, 'fact-audit-freeze.json');
const candidatePath = path.join(run5Dir, 'evidence-candidates.json');
const validationPath = path.join(rawDir, 'validated-evidence-geometry-v1.json');
const projectionPath = path.join(rawDir, 'source-projection-geometry-v1.json');
const nativeInputPath = path.join(rawDir, 'native-input-geometry-v1.json');
const nativePath = path.join(nativeDir, 'native-results.json');
const statePath = path.join(rawDir, 'native-state-geometry-v1.json');
const runtimePath = path.join(nativeDir, 'runtime-provenance.json');
const goldPath = path.join(root, 'reports/oxr-thai-2026-10-25/real-native/gold.json');
const manifestPath = path.join(root, 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json');
const auditPath = path.join(reportDir, 'mechanical-audit.json');
const sourceAuditPath = path.join(reportDir, 'source-audit.json');

const [freeze, candidates, validation, projection, nativeInput, native, nativeState, runtime, gold, priorManifest, audit, sourceAudit, priorV6Summary, tableBaselineSummary] = await Promise.all([
  read(freezePath), read(candidatePath), read(validationPath), read(projectionPath), read(nativeInputPath),
  read(nativePath), read(statePath), read(runtimePath), read(goldPath), read(manifestPath), read(auditPath), read(sourceAuditPath),
  read(priorV6SummaryPath), read(tableBaselineSummaryPath),
]);

const freezeSha256 = await sha(freezePath);
const candidateSha256 = await sha(candidatePath);
const validationSha256 = await sha(validationPath);
const projectionSha256 = await sha(projectionPath);
const nativeInputSha256 = await sha(nativeInputPath);
const nativeSha256 = await sha(nativePath);
const runtimeSha256 = await sha(runtimePath);
const goldSha256 = await sha(goldPath);
const armName = 'hyper-fact-geometry-v1';
const arm = nativeInput.arms.find((item) => item.parser === armName);

assert.equal(freeze.runId, 'run-5-frozen-candidates-geometry-revalidation-v1');
assert.equal(candidates.status, 'COMPLETED');
assert.equal(await sha(path.join(run5Dir, 'freeze.json')), freeze.extractionFreezeSha256);
assert.equal(candidates.freezeSha256, freeze.extractionFreezeSha256);
assert.equal(candidateSha256, freeze.candidateReceiptSha256);
assert.equal(validationSha256, freeze.validationFileSha256);
assert.equal(projectionSha256, freeze.projectionFileSha256);
assert.equal(nativeInputSha256, freeze.nativeInputFileSha256);
assert.equal(native.arm, armName);
assert.equal(native.inputHash, arm.contentSha256);
assert.equal(arm.contentSha256, hashText(arm.content));
assert.equal(goldSha256.toLowerCase(), priorManifest.frozen.goldSha256.toLowerCase());
assert.equal(native.goldSha256?.toLowerCase(), priorManifest.frozen.goldSha256.toLowerCase());
assert.equal(native.frozenGoldSha256?.toLowerCase(), priorManifest.frozen.goldSha256.toLowerCase());
validateNativeRows(native, arm, gold);
assert.equal(native.status, 'COMPLETED');
assert.equal(native.successfulStages, 17);
assert.equal(native.queries.length, 48);
assert.equal(native.scopeDenial?.denied, true);
assert.ok(native.restart?.generation);
assert.equal(runtime.gold.sha256.toLowerCase(), priorManifest.frozen.goldSha256.toLowerCase());
assert.equal(runtime.gold.sha256.toLowerCase(), goldSha256.toLowerCase());
assert.equal(runtime.hashes['/app/experiment/native.test.js'], await sha(path.join(nativeDir, 'executed-native.test.js')));
assert.equal(nativeState.ExitCode, 0);
const priorTableArm = tableBaselineSummary.native.arms.find((item) => item.parser === 'table');
assert.ok(priorTableArm, 'Missing historical table-preserving baseline metrics');
assert.equal(priorTableArm.rowHit5, 4);
assert.equal(priorTableArm.headerTokenHit5, 4);
assert.equal(priorTableArm.documentHit5, 16);
assert.equal(priorV6Summary.native.rowHit5, 0);
assert.equal(priorV6Summary.native.rowAndHeaderTokenHit5, 0);
assert.equal(priorV6Summary.native.documentHit5, 6);
assert.equal(audit.summary.recheckedCandidateFacts, 120);
assert.equal(validation.facts.length, 120);
assert.equal(new Set(validation.facts.map((item) => item.candidateId)).size, 120);
assert.equal(validation.summary.facts.LEXICALLY_GROUNDED_FACT_CANDIDATE, 15);
assert.equal(validation.summary.facts.HELD_DUPLICATE_MODEL_EMISSION, 7);
assert.equal(validation.summary.facts.HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING, 98);
assert.equal(projection.semanticStatus, 'NOT_ASSESSED');
assert.equal(projection.candidateGraphIncluded, false);
assert.equal(projection.candidateDescriptionsIncluded, false);

const firstPass = native.queries.filter((item) => item.repetition === 1);
const repeats = native.queries.filter((item) => item.repetition > 1);
assert.equal(firstPass.length, 16);
const scored = native.queries.map((item) => {
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
const firstRows = scored.filter((item) => item.repetition === 1);
const hit = (field, k) => firstRows.filter((item) => item[field] !== null && item[field] <= k).length;
const stableRanks = firstRows.filter((item) => repeats
  .filter((repeat) => repeat.id === item.id && repeat.doc === item.doc)
  .every((repeat) => {
    const scoredRepeat = scored.find((candidate) => candidate.id === repeat.id && candidate.doc === repeat.doc && candidate.repetition === repeat.repetition);
    const first = scored.find((candidate) => candidate.id === item.id && candidate.doc === item.doc && candidate.repetition === item.repetition);
    return scoredRepeat.rowRank === first.rowRank
      && scoredRepeat.rowHeaderTokenRank === first.rowHeaderTokenRank
      && scoredRepeat.documentRank === first.documentRank;
  })).length;
const latency = (items) => {
  const values = items.map((item) => item.elapsedMs).sort((a, b) => a - b);
  return {
    count: values.length,
    minMs: values[0],
    medianMs: (values[Math.floor((values.length - 1) / 2)] + values[Math.ceil((values.length - 1) / 2)]) / 2,
    maxMs: values.at(-1),
  };
};

const causeCounts = sourceAudit.summary.primaryCauseCounts;
const summary = {
  schema: 'zuri.hyper-fact-audit-native-evaluation.v1',
  status: 'COMPLETED',
  claimBoundary: 'One geometry-derived, source-text-only candidate subset was ingested by the existing native GenesisRAG17 TEXT workflow. Candidate descriptions, predicates, relations, and graph fields were not ingested; source-grounding does not establish semantic correctness.',
  inputs: {
    factAuditFreezeSha256: freezeSha256,
    candidateReceiptSha256: candidateSha256,
    validationSha256,
    projectionSha256,
    nativeInputSha256,
    nativeArm: armName,
    nativeArmSha256: arm.contentSha256,
    nativeResultsSha256: nativeSha256,
    runtimeProvenanceSha256: runtimeSha256,
    executedHarnessSha256: await sha(path.join(nativeDir, 'executed-native.test.js')),
    priorV6SummarySha256: await sha(priorV6SummaryPath),
    historicalTableBaselineSummarySha256: await sha(tableBaselineSummaryPath),
    goldSha256,
    frozenGoldSha256: priorManifest.frozen.goldSha256,
  },
  audit: {
    heldRun5CandidatesAudited: sourceAudit.summary.held,
    primaryCauseCounts: causeCounts,
    causeAuditIsDiagnosticOnly: true,
    mechanicallyRecheckedFacts: validation.facts.length,
    uniqueGeometryBoundCandidateClaims: audit.summary.uniqueGeometryBoundSourceClaims,
    duplicateModelEmissionsHeld: audit.summary.duplicateModelEmissions,
    semanticStatus: 'NOT_ASSESSED',
  },
  native: {
    status: native.status,
    successfulStages: native.successfulStages,
    queryCountPerPass: firstPass.length,
    totalQueries: native.queries.length,
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
    firstPassLatency: latency(firstPass),
    repeatPassLatency: latency(scored.filter((item) => item.repetition > 1)),
    scopeDenial: native.scopeDenial,
    restart: native.restart,
    gateProbe: native.publication.benchmark,
  },
  historicalComparisons: {
    sameCorpusButSeparateRuns: true,
    priorV6FiveZoneArm: {
      source: '../hyper-relation-audit-v1/measurement-summary.json',
      rowHit5: priorV6Summary.native.rowHit5,
      rowAndHeaderTokenHit5: priorV6Summary.native.rowAndHeaderTokenHit5,
      documentHit5: priorV6Summary.native.documentHit5,
    },
    tablePreservingBaseline: {
      source: '../paddleocr-vl-v1/measurement-summary.json#native.arms[table]',
      rowHit1: priorTableArm.rowHit1,
      rowHit5: priorTableArm.rowHit5,
      rowAndHeaderTokenHit5: priorTableArm.headerTokenHit5,
      documentHit5: priorTableArm.documentHit5,
    },
  },
  projection: {
    selectedZones: projection.selectedZones,
    totalZones: projection.totalZones,
    selectedSourceChars: projection.selectedSourceChars,
    totalSourceChars: projection.totalSourceChars,
    coveragePct: projection.coveragePct,
    inputWasFrozenOcrText: projection.sourceTextIsUnmodifiedFrozenOCR,
    plainAndTableArmsUnchanged: true,
    graphIncluded: false,
    semanticStatus: 'NOT_ASSESSED',
  },
  queries: scored,
};
const out = path.join(reportDir, 'measurement-summary.json');
await fs.writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ status: summary.status, audit: summary.audit, native: summary.native, projection: summary.projection, summaryPath: out }, null, 2));
