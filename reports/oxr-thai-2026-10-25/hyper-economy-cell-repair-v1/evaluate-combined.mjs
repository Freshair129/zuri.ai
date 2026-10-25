// Read-only scoring after the combined source projection and native receipt are frozen.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonical, headerSupport, numericTokens, rowSupport, validateNativeRows } from '../real-native/metrics.mjs';

const reportDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(reportDir, '../../..');
const economyRaw = path.join(root, '.local/hyper-economy-cell-repair-20261025');
const heldRaw = path.join(root, '.local/hyper-held-cell-audit-20261025');
const baselinePath = path.join(root, '.local/thai-table-chunking-20261025/run-v2/native-input.json');
const priorInputPath = path.join(heldRaw, 'native-input-held-cell-repair-layout-v2.json');
const priorFreezePath = path.join(heldRaw, 'native-input-held-cell-repair-layout-v2-freeze.json');
const priorProjectionPath = path.join(heldRaw, 'held-cell-repair-projection-layout-v2.json');
const priorProjectionFreezePath = path.join(heldRaw, 'held-cell-repair-projection-layout-v2-freeze.json');
const newInputPath = path.join(economyRaw, 'native-input-economy-pdf-rows-v1.json');
const newFreezePath = path.join(economyRaw, 'native-input-economy-pdf-rows-freeze-v1.json');
const newRowsPath = path.join(economyRaw, 'pdf-baseline-rows-v1.json');
const probePath = path.join(economyRaw, 'native-chunker-probe-v1.json');
const preflightPath = path.join(economyRaw, 'native-host-preflight-combined-v1.json');
const sourceBundlePath = path.join(root, '.local/hyper-relation-audit-20261025/run-5/source-bundle.json');
const goldPath = path.join(root, 'reports/oxr-thai-2026-10-25/real-native/gold.json');
const manifestPath = path.join(root, 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json');
const summaryPath = path.join(reportDir, 'measurement-summary.json');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shaText = (text) => sha(Buffer.from(text, 'utf8'));
const read = async (file) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
const hashFile = async (file) => sha(await fs.readFile(file));

const [baselineInput, priorInput, priorFreeze, priorProjection, priorProjectionFreeze,
  newInput, newFreeze, newRows, probe, preflight, sourceBundle] = await Promise.all([
  read(baselinePath), read(priorInputPath), read(priorFreezePath), read(priorProjectionPath), read(priorProjectionFreezePath),
  read(newInputPath), read(newFreezePath), read(newRowsPath), read(probePath), read(preflightPath), read(sourceBundlePath),
]);
const inputHashes = {
  baselineNativeInput: await hashFile(baselinePath),
  priorNativeInput: await hashFile(priorInputPath),
  priorNativeFreeze: await hashFile(priorFreezePath),
  priorProjection: await hashFile(priorProjectionPath),
  priorProjectionFreeze: await hashFile(priorProjectionFreezePath),
  pdfBaselineRows: await hashFile(newRowsPath),
};
for (const [name, value] of Object.entries(inputHashes)) assert.equal(newFreeze.inputSha256[name], value, `New freeze mismatch: ${name}`);
assert.equal(newFreeze.nativeInputSha256, await hashFile(newInputPath));
assert.equal(priorFreeze.nativeInputSha256, inputHashes.priorNativeInput);
assert.equal(priorFreeze.inputSha256.baselineNativeInput, inputHashes.baselineNativeInput);
assert.equal(priorFreeze.inputSha256.repairProjection, inputHashes.priorProjection);
assert.equal(priorFreeze.inputSha256.repairProjectionFreeze, inputHashes.priorProjectionFreeze);
assert.equal(priorProjectionFreeze.projectionSha256, inputHashes.priorProjection);
assert.equal(probe.status, 'PASS_NO_QA');
assert.equal(probe.inputs.nativeInput, await hashFile(newInputPath));
assert.equal(probe.inputs.nativeFreeze, await hashFile(newFreezePath));
assert.equal(probe.priorPdfRepairRows.expectedRows, 59);
assert.equal(probe.priorPdfRepairRows.unchangedBodiesInOneNativeChunk, 59);
assert.equal(probe.sourceRows.expectedRows, 37);
assert.equal(probe.sourceRows.rowLabelAndAllSevenHeaderValueAtomsInOneChunk, 37);
assert.equal(probe.goldQuestionsOrMetricsReadOrUsed, false);
assert.equal(preflight.status, 'PASS_HOST_PREFLIGHT_ONLY');
assert.equal(preflight.nativeInputSha256, await hashFile(newInputPath));
assert.equal(preflight.nativeFreezeSha256, await hashFile(newFreezePath));
assert.equal(preflight.chunkerProbeSha256, await hashFile(probePath));
assert.equal(preflight.priorOverlayContentAndRangePrefixPreserved, true);

const armFor = (input, parser) => {
  const arm = input.arms.find((item) => item.parser === parser);
  assert.ok(arm, `Missing input arm ${parser}`);
  assert.equal(arm.contentSha256, shaText(arm.content));
  return arm;
};
const currentInput = priorInput;
const currentTableArm = armFor(currentInput, 'table');
const priorRepairArm = armFor(currentInput, 'source-pdf-repair-v1');
const combinedTableArm = armFor(newInput, 'table');
const combinedArm = armFor(newInput, 'source-pdf-repair-plus-economy-rows-v1');
assert.equal(currentTableArm.content, armFor(baselineInput, 'table').content);
assert.equal(combinedTableArm.content, currentTableArm.content);
assert.equal(combinedTableArm.contentSha256, currentTableArm.contentSha256);
assert.ok(combinedArm.content.startsWith(priorRepairArm.content));
assert.equal(combinedArm.content.slice(0, priorRepairArm.content.length), priorRepairArm.content);
assert.equal(combinedArm.derivedRowProfile.sourceRows, 37);
assert.equal(combinedArm.derivedRowProfile.sourceValueCells, 259);
assert.equal(combinedArm.derivedRowProfile.semanticStatus, 'NOT_ASSESSED');
assert.equal(combinedArm.derivedRowProfile.graphAdmission, 'NONE');
assert.equal(newRows.summary.oldHeldCellRecordsChanged, 0);
assert.equal(newRows.summary.legacyCellStatusesCarriedIntoSourceRows, 0);
assert.equal(newRows.summary.modelCalls, 0);
assert.equal(newInput.goldQuestionsOrMetricsUsed, false);
assert.equal(newInput.modelCalls, 0);

const runDefs = [
  { key: 'currentTableBaseline', parser: 'table', input: currentInput, dir: path.join(heldRaw, 'native-table-current-attempt-1'), arm: currentTableArm },
  { key: 'priorPdfRepairReference', parser: 'source-pdf-repair-v1', input: currentInput, dir: path.join(heldRaw, 'native-source-pdf-repair-v1-attempt-2'), arm: priorRepairArm },
  { key: 'combinedPdfRepairAndEconomyRows', parser: 'source-pdf-repair-plus-economy-rows-v1', input: newInput, dir: path.join(economyRaw, 'native-combined-attempt-1'), arm: combinedArm },
];
const runData = {};
for (const run of runDefs) {
  const names = ['native-results.json', 'native-state.json', 'runtime-provenance.json', 'chunks.json', 'native-command.json', 'native-launch-profile.json', 'native-run.log', 'executed-native.test.js'];
  const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, path.join(run.dir, name)])));
  const [native, state, runtime, chunks, command, launchProfile, log, executedHarness] = await Promise.all([
    read(files['native-results.json']), read(files['native-state.json']), read(files['runtime-provenance.json']),
    read(files['chunks.json']), read(files['native-command.json']), read(files['native-launch-profile.json']),
    fs.readFile(files['native-run.log'], 'utf8'), fs.readFile(files['executed-native.test.js'], 'utf8'),
  ]);
  const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  assert.equal(native.status, 'COMPLETED', `${run.key} native status`);
  assert.equal(native.arm, run.parser);
  assert.equal(native.inputHash, run.arm.contentSha256);
  assert.equal(native.successfulStages, 17);
  assert.equal(native.queries.length, 48);
  assert.equal(native.scopeDenial?.denied, true);
  assert.ok(native.restart?.generation);
  assert.equal(state.ExitCode, 0);
  assert.equal(state.Status, 'exited');
  assert.equal(runtime.gold.sha256.toLowerCase(), native.frozenGoldSha256.toLowerCase());
  assert.equal(runtime.gold.expectedFrozenSha256.toLowerCase(), native.frozenGoldSha256.toLowerCase());
  assert.equal(runtime.hashes['/app/experiment/native.test.js'], shaText(executedHarness));
  assert.ok(command.includes('--network') && command.includes('none'));
  assert.ok(command.includes('sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39'));
  assert.equal(launchProfile.pinnedImage, 'sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39');
  assert.equal(launchProfile.readonlyModelVolume, 'zuri-main-dev-20261020_ki17-model');
  assert.equal(launchProfile.resources.network, 'none');
  assert.equal(launchProfile.resources.cpu, 2);
  assert.equal(launchProfile.resources.memoryGiB, 6);
  assert.equal(launchProfile.resources.modelVolumeReadOnly, true);
  for (const query of native.queries) {
    for (const result of query.response.results) {
      const chunk = chunkById.get(result.citation?.chunkId);
      assert.ok(chunk, `Citation chunk missing: ${run.key}/${result.citation?.chunkId}`);
      assert.equal(result.text, chunk.text);
      assert.equal(result.verifiedRange?.start, chunk.startOffset);
      assert.equal(result.verifiedRange?.end, chunk.endOffset);
    }
  }
  runData[run.key] = {
    ...run,
    native,
    state,
    runtime,
    chunks,
    chunkById,
    command,
    launchProfile,
    logSha256: await hashFile(files['native-run.log']),
    nativeResultsSha256: await hashFile(files['native-results.json']),
    runtimeProvenanceSha256: await hashFile(files['runtime-provenance.json']),
    chunksSha256: await hashFile(files['chunks.json']),
    commandSha256: await hashFile(files['native-command.json']),
    launchProfileSha256: await hashFile(files['native-launch-profile.json']),
    harnessSha256: shaText(executedHarness),
    log,
  };
}

// QA is opened only after source, input, probe and all native run bindings pass.
const [gold, manifest] = await Promise.all([read(goldPath), read(manifestPath)]);
const goldSha = await hashFile(goldPath);
assert.equal(goldSha.toLowerCase(), manifest.frozen.goldSha256.toLowerCase());
for (const run of Object.values(runData)) {
  assert.equal(run.native.goldSha256?.toLowerCase(), goldSha.toLowerCase());
  assert.equal(run.native.frozenGoldSha256?.toLowerCase(), goldSha.toLowerCase());
  validateNativeRows(run.native, run.arm, gold);
}

const tablePackets = currentTableArm.packets;
const sourceRows = sourceBundle.zones.filter((zone) => zone.kind === 'table-row');
function parseDerivedRow(arm, range) {
  const frame = arm.content.slice(Number(range.start), Number(range.end));
  const bodyLine = frame.split(/\r?\n/u).find((line) => line.startsWith('row=')) ?? null;
  if (!bodyLine) return null;
  const labelToken = bodyLine.match(/^row=("(?:\\.|[^"\\])*")/u)?.[1];
  if (!labelToken) return null;
  const label = JSON.parse(labelToken);
  const slotValues = [...bodyLine.matchAll(/\bslot\d+="(?:\\.|[^"\\])*"\|value=("(?:\\.|[^"\\])*")/gu)]
    .map((match) => JSON.parse(match[1]));
  const gridValues = [...bodyLine.matchAll(/\bc\d+\s*\[[^\]]+\]=("(?:\\.|[^"\\])*")/gu)]
    .map((match) => JSON.parse(match[1]));
  const valueTokens = (slotValues.length ? slotValues : gridValues).flatMap((value) => numericTokens(value));
  return { frame, bodyLine, label, values: valueTokens.slice(-7) };
}
function derivedRowsFor(run) {
  if (run.key === 'currentTableBaseline') return [];
  return run.arm.ranges
    .filter((range) => range.origin === 'ORIGINAL_PDF_VECTOR_CELLS_AND_NUMERIC_TEXT_LAYER'
      || range.rangeKind === 'PDF_NATIVE_BASELINE_ROW_CANDIDATE')
    .map((range) => ({ range, parsed: parseDerivedRow(run.arm, range) }))
    .filter((entry) => entry.parsed);
}
const rank = (results, predicate) => {
  const index = results.findIndex(predicate);
  return index < 0 ? null : index + 1;
};
const intersects = (result, range) => Number(result.verifiedRange?.start) < Number(range.end)
  && Number(result.verifiedRange?.end) > Number(range.start);

const metricsByRun = {};
for (const run of Object.values(runData)) {
  const derived = derivedRowsFor(run);
  const scored = run.native.queries.map((item) => {
    const document = gold.documents.find((candidate) => candidate.id === item.doc);
    assert.ok(document, `Unknown gold document: ${item.doc}`);
    const query = document.qa.find((candidate) => candidate.id === item.id);
    assert.ok(query, `Unknown gold query ${item.doc}/${item.id}`);
    const row = document.rows.find((candidate) => candidate.id === query.row);
    assert.ok(row, `Unknown gold row ${query.row}`);
    const rawRowMatches = sourceRows.filter((zone) => zone.rangeId === document.id
      && canonical(String(zone.anchorText ?? '')).includes(canonical(String(row.label))));
    const rawRow = rawRowMatches.length === 1 ? rawRowMatches[0] : null;
    const packet = rawRow ? tablePackets.find((candidate) => candidate.doc === document.id
      && candidate.tableId === rawRow.packet.tableId && candidate.page === rawRow.packet.page
      && candidate.row === rawRow.packet.row) : null;
    const matchingDerived = derived.filter(({ range, parsed }) => range.doc === document.id
      && canonical(parsed.label) === canonical(String(row.label)));
    const uniqueDerived = matchingDerived.length === 1 ? matchingDerived[0] : null;
    const derivedMatchesGold = uniqueDerived !== null
      && JSON.stringify(uniqueDerived.parsed.values) === JSON.stringify(row.values);
    const results = item.response.results;
    const rowPredicate = (result) => result.document === document.id && rowSupport(result.text, row);
    const rawLineRank = rawRow?.anchorText
      ? rank(results, (result) => result.document === document.id && result.text.includes(rawRow.anchorText)) : null;
    const packetRank = packet?.text
      ? rank(results, (result) => result.document === document.id && result.text.includes(packet.text)) : null;
    const derivedBodyRank = uniqueDerived
      ? rank(results, (result) => result.document === document.id && result.text.includes(uniqueDerived.parsed.bodyLine)) : null;
    const derivedCorrectRank = derivedMatchesGold ? derivedBodyRank : null;
    const derivedEconomy = matchingDerived.filter(({ range }) => range.rangeKind === 'PDF_NATIVE_BASELINE_ROW_CANDIDATE');
    const matchingEconomy = derivedEconomy.filter(({ parsed }) => canonical(parsed.label) === canonical(String(row.label)));
    const uniqueEconomy = matchingEconomy.length === 1 ? matchingEconomy[0] : null;
    const economyMatchesGold = uniqueEconomy !== null
      && JSON.stringify(uniqueEconomy.parsed.values) === JSON.stringify(row.values);
    const economyBodyRank = uniqueEconomy
      ? rank(results, (result) => result.document === document.id && result.text.includes(uniqueEconomy.parsed.bodyLine)) : null;
    const overlayRanges = run.key === 'currentTableBaseline' ? [] : run.arm.ranges.filter((range) => range.origin
      || range.zoneKind === 'TABLE_HEADER_MAP' || range.rangeKind === 'PDF_NATIVE_BASELINE_ROW_CANDIDATE');
    const overlayOverlapRank = overlayRanges.length
      ? rank(results, (result) => overlayRanges.some((range) => range.doc === document.id && intersects(result, range))) : null;
    return {
      id: item.id,
      doc: item.doc,
      repetition: item.repetition,
      elapsedMs: item.elapsedMs,
      rowRank: rank(results, rowPredicate),
      rowAndHeaderRank: rank(results, (result) => rowPredicate(result) && headerSupport(result.text, query.headers)),
      rawSourceLineRank: rawLineRank,
      fullRawHeaderRowPacketRank: packetRank,
      documentRank: rank(results, (result) => result.document === document.id),
      sourceRowLabelMappingCount: rawRowMatches.length,
      matchedPdfDerivedRowsByLabel: matchingDerived.length,
      pdfDerivedCompleteRowBodyRank: derivedBodyRank,
      pdfDerivedCompleteCorrectRowRank: derivedCorrectRank,
      pdfDerivedBodyMatchesGold: derivedMatchesGold,
      pdfEconomyRowCandidateCountByLabel: matchingEconomy.length,
      pdfEconomyCompleteRowRank: economyBodyRank,
      pdfEconomyCompleteCorrectRowRank: economyMatchesGold ? economyBodyRank : null,
      anyPdfOverlayRangeOverlapRank: overlayOverlapRank,
    };
  });
  const first = scored.filter((item) => item.repetition === 1);
  const repeats = scored.filter((item) => item.repetition > 1);
  assert.equal(first.length, 16);
  const hits = (field, k) => first.filter((item) => item[field] !== null && item[field] <= k).length;
  const stable = first.filter((item) => repeats.filter((repeat) => repeat.doc === item.doc && repeat.id === item.id)
    .every((repeat) => ['rowRank', 'rowAndHeaderRank', 'rawSourceLineRank', 'fullRawHeaderRowPacketRank',
      'documentRank', 'pdfDerivedCompleteRowBodyRank', 'pdfDerivedCompleteCorrectRowRank',
      'pdfEconomyCompleteCorrectRowRank', 'anyPdfOverlayRangeOverlapRank']
      .every((field) => repeat[field] === item[field]))).length;
  const derivedRowFirstPass = first.filter((item) => item.pdfDerivedCompleteCorrectRowRank !== null
    && item.pdfDerivedCompleteCorrectRowRank <= 5).length;
  const legacyFirstPass = hits('rowRank', 5);
  const unionFirstPass = first.filter((item) => (item.rowRank !== null && item.rowRank <= 5)
    || (item.pdfDerivedCompleteCorrectRowRank !== null && item.pdfDerivedCompleteCorrectRowRank <= 5)).length;
  metricsByRun[run.key] = {
    parser: run.parser,
    armContentSha256: run.arm.contentSha256,
    nativeResultsSha256: run.nativeResultsSha256,
    runtimeProvenanceSha256: run.runtimeProvenanceSha256,
    chunksSha256: run.chunksSha256,
    chunkCount: run.native.chunkCount,
    totalMs: run.native.totalMs,
    memoryPeakBytes: run.native.memoryPeakBytes,
    successfulStages: run.native.successfulStages,
    queryCount: run.native.queries.length,
    firstPass: {
      queryCount: first.length,
      rowHit1: hits('rowRank', 1),
      rowHit5: legacyFirstPass,
      rowAndHeaderHit5: hits('rowAndHeaderRank', 5),
      rawSourceLineHit1: hits('rawSourceLineRank', 1),
      rawSourceLineHit5: hits('rawSourceLineRank', 5),
      fullRawHeaderRowPacketHit5: hits('fullRawHeaderRowPacketRank', 5),
      documentHit5: hits('documentRank', 5),
      pdfDerivedCompleteCorrectRowHit5: derivedRowFirstPass,
      pdfEconomyCompleteCorrectRowHit5: hits('pdfEconomyCompleteCorrectRowRank', 5),
      anyPdfOverlayRangeOverlapHit5: hits('anyPdfOverlayRangeOverlapRank', 5),
      legacyRowOrPdfDerivedCorrectRowUnionHit1: first.filter((item) => (item.rowRank !== null && item.rowRank <= 1)
        || (item.pdfDerivedCompleteCorrectRowRank !== null && item.pdfDerivedCompleteCorrectRowRank <= 1)).length,
      legacyRowOrPdfDerivedCorrectRowUnionHit5: unionFirstPass,
    },
    repeatedStabilityQueries: stable,
    perQuery: scored,
  };
}

const summary = {
  schema: 'hyper-economy-cell-repair-native-measurement-v1',
  status: 'COMPLETED',
  measurementMode: 'One current table baseline receipt, prior PDF repair receipt as historical reference, and one new combined prior-overlay-plus-economy candidate run. The new candidate is not an economy-only causal arm.',
  candidateProfile: {
    priorPdfRepairContentPreservedAsExactPrefix: true,
    newPdfNativeEconomyRows: 37,
    newPdfNativeEconomyNumericCells: 259,
    priorCorrectedPopulationRowBodiesOneChunk: probe.priorPdfRepairRows.unchangedBodiesInOneNativeChunk,
    newEconomyRowsOneChunk: probe.sourceRows.rowLabelAndAllSevenHeaderValueAtomsInOneChunk,
    legacyHeldEconomyRecordStatusesChanged: 0,
    semantics: 'NOT_ASSESSED',
    graphAdmission: 'NONE',
    modelCalls: 0,
  },
  sourceAndFreeze: {
    baselineNativeInputSha256: inputHashes.baselineNativeInput,
    priorNativeInputSha256: inputHashes.priorNativeInput,
    priorNativeFreezeSha256: inputHashes.priorNativeFreeze,
    priorProjectionSha256: inputHashes.priorProjection,
    priorProjectionFreezeSha256: inputHashes.priorProjectionFreeze,
    sourceRowsSha256: inputHashes.pdfBaselineRows,
    combinedNativeInputSha256: await hashFile(newInputPath),
    combinedNativeFreezeSha256: await hashFile(newFreezePath),
    chunkerProbeSha256: await hashFile(probePath),
    hostPreflightSha256: await hashFile(preflightPath),
    sourceBundleSha256: await hashFile(sourceBundlePath),
    goldSha256: goldSha,
  },
  metricDefinitions: {
    rowHit: 'The existing frozen scorer predicate: a returned chunk has the gold row label and exact complete gold numeric sequence on one line; this remains the primary legacy serialization-sensitive metric.',
    rowAndHeader: 'The row-hit predicate succeeds and required header tokens appear somewhere in the same returned text; this does not prove same-cell/header binding.',
    pdfDerivedCompleteCorrectRow: 'A unique same-document PDF-native row label maps to the gold row, all seven source-derived values exactly match the frozen gold values, and that exact complete row body appears in a returned chunk. This is a post-freeze retrieval diagnostic, not semantic acceptance.',
    pdfEconomyCompleteCorrectRow: 'The same rule restricted to newly appended PDF-native economy row records.',
    anyPdfOverlayRangeOverlap: 'A cited same-document verified range overlaps any PDF-derived source range; overlap alone does not establish a complete or correct row.',
    historicalPriorOverlay: 'A separate earlier run on the prior 59-row PDF repair overlay; descriptive reference only, not a contemporaneous arm.',
  },
  procedure: {
    sameFrozenQaAndControl: true,
    allProjectionArtifactsFrozenBeforeScoring: true,
    pinnedGenesisRag17Image: 'sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39',
    e5ModelVolumeReadOnly: true,
    separateDisposableNativeStateForEachMeasuredRun: true,
    network: 'none',
    cpuLimit: 2,
    memoryLimitGiB: 6,
    sourceOnlyPreparationModelCalls: 0,
    productionOrGraphAdoption: false,
  },
  arms: metricsByRun,
};
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: summary.status, arms: Object.fromEntries(Object.entries(metricsByRun).map(([key, item]) => [key, {
  rowHit1: item.firstPass.rowHit1,
  rowHit5: item.firstPass.rowHit5,
  rowAndHeaderHit5: item.firstPass.rowAndHeaderHit5,
  pdfDerivedCorrectRowHit5: item.firstPass.pdfDerivedCompleteCorrectRowHit5,
  economyPdfCorrectRowHit5: item.firstPass.pdfEconomyCompleteCorrectRowHit5,
  unionHit5: item.firstPass.legacyRowOrPdfDerivedCorrectRowUnionHit5,
  totalMs: item.totalMs,
  memoryPeakBytes: item.memoryPeakBytes,
  chunkCount: item.chunkCount,
}])), summaryPath }, null, 2));
