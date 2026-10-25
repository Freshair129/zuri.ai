// Score the completed, frozen table-baseline and source-PDF repair runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonical, headerSupport, numericTokens, rowSupport, validateNativeRows } from '../real-native/metrics.mjs';

const reportDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(reportDir, '../../..');
const rawDir = path.join(root, '.local/hyper-held-cell-audit-20261025');
const baselineInputPath = path.join(root, '.local/thai-table-chunking-20261025/run-v2/native-input.json');
const nativeInputPath = path.join(rawDir, 'native-input-held-cell-repair-layout-v2.json');
const nativeFreezePath = path.join(rawDir, 'native-input-held-cell-repair-layout-v2-freeze.json');
const heldFreezePath = path.join(rawDir, 'held-cell-freeze-v1.json');
const enumerationPath = path.join(rawDir, 'held-cell-enumeration-v1.json');
const valueFreezePath = path.join(rawDir, 'pdf-cell-value-freeze-v1.json');
const valueEvidencePath = path.join(rawDir, 'pdf-cell-value-evidence-v1.json');
const geometryPath = path.join(rawDir, 'pdf-vector-geometry-v1.json');
const projectionPath = path.join(rawDir, 'held-cell-repair-projection-layout-v2.json');
const projectionFreezePath = path.join(rawDir, 'held-cell-repair-projection-layout-v2-freeze.json');
const chunkProbePath = path.join(rawDir, 'native-chunker-probe-layout-v2.json');
const sourceBundlePath = path.join(root, '.local/hyper-relation-audit-20261025/run-5/source-bundle.json');
const goldPath = path.join(root, 'reports/oxr-thai-2026-10-25/real-native/gold.json');
const manifestPath = path.join(root, 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json');
const evidencePath = path.join(reportDir, 'held-cell-audit.json');
const summaryPath = path.join(reportDir, 'measurement-summary.json');

const shaBytes = (value) => createHash('sha256').update(value).digest('hex');
const shaText = (value) => shaBytes(Buffer.from(value, 'utf8'));
const read = async (file) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
const hashFile = async (file) => shaBytes(await fs.readFile(file));

// Verify the treatment inputs and both native receipts before reading the QA.
const [nativeInput, nativeFreeze, heldFreeze, enumeration, valueFreeze, valueEvidence,
  geometry, projection, projectionFreeze, baselineInput, sourceBundle, heldAudit, chunkProbe] = await Promise.all([
  read(nativeInputPath), read(nativeFreezePath), read(heldFreezePath), read(enumerationPath),
  read(valueFreezePath), read(valueEvidencePath), read(geometryPath), read(projectionPath),
  read(projectionFreezePath), read(baselineInputPath), read(sourceBundlePath), read(evidencePath), read(chunkProbePath),
]);
const hashes = {
  baselineNativeInput: await hashFile(baselineInputPath),
  nativeInput: await hashFile(nativeInputPath),
  nativeFreeze: await hashFile(nativeFreezePath),
  heldFreeze: await hashFile(heldFreezePath),
  enumeration: await hashFile(enumerationPath),
  valueFreeze: await hashFile(valueFreezePath),
  valueEvidence: await hashFile(valueEvidencePath),
  geometry: await hashFile(geometryPath),
  projection: await hashFile(projectionPath),
  projectionFreeze: await hashFile(projectionFreezePath),
  sourceBundle: await hashFile(sourceBundlePath),
  heldAudit: await hashFile(evidencePath),
  chunkProbe: await hashFile(chunkProbePath),
};

assert.equal(nativeFreeze.nativeInputSha256, hashes.nativeInput);
assert.equal(nativeFreeze.inputSha256.baselineNativeInput, hashes.baselineNativeInput);
assert.equal(nativeFreeze.inputSha256.sourceNativeFreeze, hashes.heldFreeze);
assert.equal(nativeFreeze.inputSha256.sourceNativeEnumeration, hashes.enumeration);
assert.equal(nativeFreeze.inputSha256.pdfValueFreeze, hashes.valueFreeze);
assert.equal(nativeFreeze.inputSha256.pdfValueEvidence, hashes.valueEvidence);
assert.equal(nativeFreeze.inputSha256.pdfVectorGeometry, hashes.geometry);
assert.equal(nativeFreeze.inputSha256.sourceBundle, hashes.sourceBundle);
assert.equal(nativeFreeze.inputSha256.repairProjection, hashes.projection);
assert.equal(nativeFreeze.inputSha256.repairProjectionFreeze, hashes.projectionFreeze);
assert.equal(enumeration.freezeSha256, hashes.heldFreeze);
assert.equal(valueEvidence.freezeSha256, hashes.valueFreeze);
assert.equal(valueFreeze.inputSha256.sourceNativeFreeze, hashes.heldFreeze);
assert.equal(valueFreeze.inputSha256.sourceNativeEnumeration, hashes.enumeration);
assert.equal(valueFreeze.inputSha256.pdfVectorGeometry, hashes.geometry);
assert.equal(valueFreeze.inputSha256.sourceBundle, hashes.sourceBundle);
assert.equal(projectionFreeze.projectionSha256, hashes.projection);
assert.equal(projectionFreeze.inputSha256.sourceNativeFreeze, hashes.heldFreeze);
assert.equal(projectionFreeze.inputSha256.pdfValueFreeze, hashes.valueFreeze);
assert.equal(projectionFreeze.inputSha256.baselineNativeInput, hashes.baselineNativeInput);
assert.equal(projection.inputSha256.sourceNativeEnumeration, hashes.enumeration);
assert.equal(projection.inputSha256.pdfValueEvidence, hashes.valueEvidence);
assert.equal(projection.inputSha256.pdfVectorGeometry, hashes.geometry);
assert.equal(projection.inputSha256.sourceBundle, hashes.sourceBundle);
assert.equal(nativeInput.candidateSidecarIncluded, false);
assert.equal(chunkProbe.status, 'PASS_NO_QA');
assert.equal(chunkProbe.inputs.nativeInputSha256, hashes.nativeInput);
assert.equal(chunkProbe.inputs.projectionSha256, hashes.projection);
assert.equal(chunkProbe.runtime.baselineNativeChunkParity, true);
assert.equal(chunkProbe.sourceRows.expectedCompleteRowBodies, 59);
assert.equal(chunkProbe.sourceRows.bodyLineWholeInExactlyOneNativeChunk, 59);
assert.equal(chunkProbe.goldQuestionsOrMetricsReadOrUsed, false);

const armFor = (parser) => nativeInput.arms.find((arm) => arm.parser === parser);
const tableArm = armFor('table');
const treatmentArm = armFor('source-pdf-repair-v1');
assert.ok(tableArm && treatmentArm, 'Both frozen native arms are required');
assert.equal(tableArm.contentSha256, shaText(tableArm.content));
assert.equal(treatmentArm.contentSha256, shaText(treatmentArm.content));
const baselineTable = baselineInput.arms.find((arm) => arm.parser === 'table');
assert.ok(baselineTable);
assert.equal(tableArm.content, baselineTable.content);
assert.equal(tableArm.contentSha256, baselineTable.contentSha256);
assert.ok(treatmentArm.content.startsWith(tableArm.content));
assert.equal(treatmentArm.sourceRepair.baselineTableContentSha256, tableArm.contentSha256);
assert.equal(treatmentArm.sourceRepair.projectionSha256, hashes.projection);
assert.equal(treatmentArm.sourceRepair.projectionFreezeSha256, hashes.projectionFreeze);
assert.equal(projection.summary.rawOcrCellsChanged, false);
assert.equal(treatmentArm.sourceRepair.semanticStatus, 'NOT_ASSESSED');
assert.equal(treatmentArm.sourceRepair.graphAdmission, 'NONE');
assert.equal(treatmentArm.sourceRepair.candidateGraphIncluded, false);
assert.equal(treatmentArm.sourceRepair.goldQuestionsOrMetricsUsed, false);
assert.equal(treatmentArm.sourceRepair.modelCalls, 0);

// The baseline's range metadata only adds an explicit doc field in the native
// harness. Check packet coordinates and source hashes, not object-byte equality.
for (const range of baselineTable.ranges) {
  const same = tableArm.ranges.find((item) => item.id === range.id);
  assert.ok(same, `Missing baseline range ${range.id}`);
  for (const field of ['start', 'end', 'pdfSha256', 'textSha256']) assert.equal(same[field], range[field]);
}

const heldRecords = Array.isArray(heldAudit.heldRecords) ? heldAudit.heldRecords.length : null;
assert.equal(heldRecords, 239);
assert.equal(Object.values(heldAudit.primaryCauseCounts).reduce((sum, n) => sum + n, 0), 239);
assert.equal(enumeration.summary.sourceCellsReevaluated, 972);
assert.equal(enumeration.summary.heldCells, 87);
assert.equal(valueEvidence.summary.sourceCells, 972);
assert.equal(valueEvidence.summary.sourceTextLayerCorrections, 118);
assert.equal(projection.summary.pdfSourceCorrectionCells, 118);
assert.equal(projection.summary.completeCorrectedRows, 59);
assert.equal(projection.summary.partialCorrectionCells, 0);
assert.equal(projection.summary.excludedCorrectionCells, 0);

const runDefs = [
  { parser: 'table', dir: path.join(rawDir, 'native-table-current-attempt-1') },
  { parser: 'source-pdf-repair-v1', dir: path.join(rawDir, 'native-source-pdf-repair-v1-attempt-2') },
];
const runData = {};
for (const run of runDefs) {
  const nativePath = path.join(run.dir, 'native-results.json');
  const statePath = path.join(run.dir, 'native-state.json');
  const runtimePath = path.join(run.dir, 'runtime-provenance.json');
  const harnessPath = path.join(run.dir, 'executed-native.test.js');
  const chunksPath = path.join(run.dir, 'chunks.json');
  const commandPath = path.join(run.dir, 'native-command.json');
  const [native, state, runtime, chunks, command] = await Promise.all([
    read(nativePath), read(statePath), read(runtimePath), read(chunksPath), read(commandPath),
  ]);
  const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const arm = armFor(run.parser);
  assert.equal(native.status, 'COMPLETED');
  assert.equal(native.arm, run.parser);
  assert.equal(native.inputHash, arm.contentSha256);
  assert.equal(native.successfulStages, 17);
  assert.equal(native.queries.length, 48);
  assert.equal(native.scopeDenial?.denied, true);
  assert.ok(native.restart?.generation);
  assert.equal(state.ExitCode, 0);
  assert.equal(runtime.gold.sha256.toLowerCase(), native.frozenGoldSha256.toLowerCase());
  assert.equal(runtime.gold.expectedFrozenSha256.toLowerCase(), native.frozenGoldSha256.toLowerCase());
  assert.equal(runtime.hashes['/app/experiment/native.test.js'], await hashFile(harnessPath));
  const launchProfile = await read(path.join(run.dir, 'native-launch-profile.json'));
  assert.equal(command[0], 'run');
  assert.ok(command.includes('--network') && command.includes('none'));
  assert.ok(command.includes('sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39'));
  assert.equal(state.Status, 'exited');
  assert.equal(launchProfile.pinnedImage, 'sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39');
  assert.equal(launchProfile.readonlyModelVolume, 'zuri-main-dev-20261020_ki17-model');
  assert.equal(launchProfile.resources.network, 'none');
  assert.equal(launchProfile.resources.cpu, 2);
  assert.equal(launchProfile.resources.memoryGiB, 6);
  assert.equal(launchProfile.resources.modelVolumeReadOnly, true);
  runData[run.parser] = {
    run,
    arm,
    native,
    state,
    runtime,
    chunks,
    chunkById,
    command,
    files: {
      native: await hashFile(nativePath),
      state: await hashFile(statePath),
      runtime: await hashFile(runtimePath),
      harness: await hashFile(harnessPath),
      chunks: await hashFile(chunksPath),
      command: await hashFile(commandPath),
      launchProfile: await hashFile(path.join(run.dir, 'native-launch-profile.json')),
      log: await hashFile(path.join(run.dir, 'native-run.log')),
    },
  };
}

// QA and gold are opened only after all current freeze and native-run bindings pass.
const [gold, manifest] = await Promise.all([read(goldPath), read(manifestPath)]);
const goldSha256 = await hashFile(goldPath);
assert.equal(goldSha256.toLowerCase(), manifest.frozen.goldSha256.toLowerCase());
for (const data of Object.values(runData)) {
  assert.equal(data.native.goldSha256?.toLowerCase(), goldSha256.toLowerCase());
  assert.equal(data.native.frozenGoldSha256?.toLowerCase(), goldSha256.toLowerCase());
  for (const query of data.native.queries) {
    for (const result of query.response.results) {
      const chunk = data.chunkById.get(result.citation?.chunkId);
      assert.ok(chunk, `Citation chunk is absent from native chunks: ${result.citation?.chunkId}`);
      assert.equal(result.text, chunk.text, `Citation text differs from native chunk ${chunk.chunkId}`);
      assert.equal(result.verifiedRange?.start, chunk.startOffset);
      assert.equal(result.verifiedRange?.end, chunk.endOffset);
    }
  }
  validateNativeRows(data.native, data.arm, gold);
}

const sourceRows = sourceBundle.zones.filter((zone) => zone.kind === 'table-row');
const generatedFrameRanges = treatmentArm.ranges.filter((range) =>
  range.origin === 'ORIGINAL_PDF_VECTOR_CELLS_AND_NUMERIC_TEXT_LAYER');
const frameTextById = new Map(generatedFrameRanges.map((range) => [
  range.id,
  treatmentArm.content.slice(Number(range.start), Number(range.end)),
]));
const valueAtomsFromFrame = (text, valueCount) => [...text.matchAll(/\bc(\d+)\s*(\[[^\]]+\])="([^"]+)"/gu)]
  .map((match) => ({
    column: Number(match[1]),
    header: match[2],
    value: match[3],
    atom: `c${match[1]}${match[2]}="${match[3]}"`,
  }))
  .filter((field) => numericTokens(field.value).length > 0)
  .slice(-valueCount);
const rowBodyLineFromFrame = (text) => text.split(/\r?\n/u).find((line) => line.startsWith('row=')) ?? null;
for (const [id, text] of frameTextById) {
  const range = generatedFrameRanges.find((item) => item.id === id);
  assert.equal(shaText(text), range.textSha256, `PDF-derived range hash mismatch ${id}`);
}

const rankOf = (results, predicate) => {
  const index = results.findIndex(predicate);
  return index < 0 ? null : index + 1;
};
const overlapsRange = (result, range) => {
  const start = Number(result.verifiedRange?.start);
  const end = Number(result.verifiedRange?.end);
  return Number.isFinite(start) && Number.isFinite(end)
    && start < Number(range.end) && end > Number(range.start);
};
const metricsByArm = {};
for (const [parser, data] of Object.entries(runData)) {
  const native = data.native;
  const tablePackets = tableArm.packets;
  const scored = native.queries.map((item) => {
    const document = gold.documents.find((candidate) => candidate.id === item.doc);
    assert.ok(document, `Unknown document ${item.doc}`);
    const query = document.qa.find((candidate) => candidate.id === item.id);
    assert.ok(query, `Unknown query ${item.doc}/${item.id}`);
    const row = document.rows.find((candidate) => candidate.id === query.row);
    assert.ok(row, `Missing gold row ${query.row}`);
    const rawRowMatches = sourceRows.filter((zone) => zone.rangeId === document.id
      && canonical(String(zone.anchorText ?? '')).includes(canonical(String(row.label))));
    const rawRow = rawRowMatches.length === 1 ? rawRowMatches[0] : null;
    const sourcePacket = rawRow ? tablePackets.find((packet) => packet.doc === document.id
      && packet.tableId === rawRow.packet.tableId && packet.page === rawRow.packet.page
      && packet.row === rawRow.packet.row) : null;
    const sourceRowRecordId = rawRow
      ? `src-row:${document.id}:p${rawRow.packet.page}:${rawRow.packet.tableId}:r${rawRow.packet.row}`
      : null;
    const matchingFrames = parser === 'source-pdf-repair-v1' && sourceRowRecordId
      ? [...frameTextById.entries()].filter(([id]) => {
        const range = generatedFrameRanges.find((item) => item.id === id);
        return range.doc === document.id && range.sourceRowRecordId === sourceRowRecordId;
      })
      : [];
    assert.ok(matchingFrames.length <= 1, `Duplicate PDF-derived row frame for ${document.id}/${row.label}`);
    const exactRawLine = rawRow?.anchorText;
    const exactRawPacket = sourcePacket?.text;
    const exactDerivedFrames = matchingFrames.map(([, text]) => text);
    const derivedFrame = exactDerivedFrames[0] ?? null;
    const derivedBodyLine = derivedFrame ? rowBodyLineFromFrame(derivedFrame) : null;
    const derivedValueAtoms = derivedFrame ? valueAtomsFromFrame(derivedFrame, row.values.length) : [];
    const derivedValues = derivedValueAtoms.flatMap((field) => numericTokens(field.value)).slice(-row.values.length);
    const derivedRowSupportsGold = derivedFrame !== null
      && canonical(derivedFrame).includes(canonical(String(row.label)))
      && JSON.stringify(derivedValues) === JSON.stringify(row.values);
    const results = item.response.results;
    const rowPredicate = (result) => result.document === document.id && rowSupport(result.text, row);
    const overlayRangesInDoc = parser === 'source-pdf-repair-v1'
      ? treatmentArm.ranges.filter((range) => range.doc === document.id && range.origin)
      : [];
    const rowFrameRangesInDoc = parser === 'source-pdf-repair-v1'
      ? generatedFrameRanges.filter((range) => range.doc === document.id)
      : [];
    const headerMapRangesInDoc = parser === 'source-pdf-repair-v1'
      ? treatmentArm.ranges.filter((range) => range.doc === document.id && range.zoneKind === 'TABLE_HEADER_MAP')
      : [];
    const rowRank = rankOf(results, rowPredicate);
    const rawLineRank = exactRawLine
      ? rankOf(results, (result) => result.document === document.id && result.text.includes(exactRawLine)) : null;
    const rawPacketRank = exactRawPacket
      ? rankOf(results, (result) => result.document === document.id && result.text.includes(exactRawPacket)) : null;
    const pdfFrameRank = exactDerivedFrames.length
      ? rankOf(results, (result) => result.document === document.id
        && exactDerivedFrames.some((text) => result.text.includes(text))) : null;
    const pdfBodyRank = derivedBodyLine
      ? rankOf(results, (result) => result.document === document.id && result.text.includes(derivedBodyLine)) : null;
    const pdfAnyRowAtomRank = derivedValueAtoms.length
      ? rankOf(results, (result) => result.document === document.id
        && derivedValueAtoms.some((field) => result.text.includes(field.atom))) : null;
    const allPdfAtomsRank = derivedValueAtoms.length === row.values.length
      ? rankOf(results, (result) => result.document === document.id
        && derivedValueAtoms.every((field) => result.text.includes(field.atom))) : null;
    const pdfGoldRowRank = derivedRowSupportsGold ? allPdfAtomsRank : null;
    const anyOverlayRangeRank = overlayRangesInDoc.length
      ? rankOf(results, (result) => overlayRangesInDoc.some((range) => overlapsRange(result, range))) : null;
    const rowFrameOverlapRank = rowFrameRangesInDoc.length
      ? rankOf(results, (result) => rowFrameRangesInDoc.some((range) => overlapsRange(result, range))) : null;
    const headerMapOverlapRank = headerMapRangesInDoc.length
      ? rankOf(results, (result) => headerMapRangesInDoc.some((range) => overlapsRange(result, range))) : null;
    return {
      id: item.id,
      doc: item.doc,
      repetition: item.repetition,
      elapsedMs: item.elapsedMs,
      rowRank,
      rawSourceLineRank: rawLineRank,
      fullRawHeaderRowPacketRank: rawPacketRank,
      anyPdfDerivedRangeOverlapRank: anyOverlayRangeRank,
      pdfDerivedRowFrameOverlapRank: rowFrameOverlapRank,
      pdfDerivedHeaderMapOverlapRank: headerMapOverlapRank,
      pdfDerivedAnyRowCellAtomRank: pdfAnyRowAtomRank,
      pdfDerivedCompleteRowBodyRank: pdfBodyRank,
      pdfDerivedCompleteCorrectRowRank: pdfGoldRowRank,
      pdfDerivedCompleteRowFrameRank: pdfFrameRank,
      rowAndHeaderRank: rankOf(results, (result) => rowPredicate(result)
        && headerSupport(result.text, query.headers)),
      documentRank: rankOf(results, (result) => result.document === document.id),
      rawSourceRowMappingCount: rawRowMatches.length,
      matchingPdfDerivedFrameCount: matchingFrames.length,
      derivedRowFrameMatchesGold: derivedRowSupportsGold,
    };
  });
  const firstPass = scored.filter((item) => item.repetition === 1);
  const repeats = scored.filter((item) => item.repetition > 1);
  assert.equal(firstPass.length, 16);
  const hit = (field, k) => firstPass.filter((item) => item[field] !== null && item[field] <= k).length;
  const stableMetricRanks = firstPass.filter((first) => repeats.filter((item) => item.doc === first.doc && item.id === first.id)
    .every((repeat) => ['rowRank', 'rawSourceLineRank', 'fullRawHeaderRowPacketRank',
      'anyPdfDerivedRangeOverlapRank', 'pdfDerivedRowFrameOverlapRank', 'pdfDerivedHeaderMapOverlapRank',
      'pdfDerivedAnyRowCellAtomRank', 'pdfDerivedCompleteRowBodyRank',
      'pdfDerivedCompleteCorrectRowRank', 'pdfDerivedCompleteRowFrameRank', 'rowAndHeaderRank', 'documentRank']
      .every((field) => first[field] === repeat[field]))).length;
  const topFiveOverlayCitationCounts = scored.filter((item) => item.repetition === 1).reduce((counts, item) => {
    const query = native.queries.find((candidate) => candidate.id === item.id && candidate.doc === item.doc
      && candidate.repetition === item.repetition);
    const docRanges = parser === 'source-pdf-repair-v1'
      ? treatmentArm.ranges.filter((range) => range.doc === item.doc && range.origin)
      : [];
    const rowFrameRanges = generatedFrameRanges.filter((range) => range.doc === item.doc);
    const headerMapRanges = treatmentArm.ranges.filter((range) => range.doc === item.doc && range.zoneKind === 'TABLE_HEADER_MAP');
    for (const result of query.response.results.slice(0, 5).filter((value) => value.document === item.doc)) {
      const overlapsFrame = rowFrameRanges.some((range) => overlapsRange(result, range));
      const overlapsHeaderMap = headerMapRanges.some((range) => overlapsRange(result, range));
      if (docRanges.some((range) => overlapsRange(result, range))) counts.anyOverlay++;
      if (overlapsFrame) counts.rowFrames++;
      if (!overlapsFrame && overlapsHeaderMap) counts.headerMapOnly++;
    }
    return counts;
  }, { anyOverlay: 0, rowFrames: 0, headerMapOnly: 0 });
  const charLengths = data.chunks.map((chunk) => String(chunk.text).length).sort((a, b) => a - b);
  metricsByArm[parser] = {
    parser,
    armContentSha256: data.arm.contentSha256,
    nativeResultsSha256: data.files.native,
    runtimeProvenanceSha256: data.files.runtime,
    executedHarnessSha256: data.files.harness,
    runState: data.state,
    status: native.status,
    successfulStages: native.successfulStages,
    queriesPerPass: firstPass.length,
    totalQueries: native.queries.length,
    rowHit1: hit('rowRank', 1),
    rowHit5: hit('rowRank', 5),
    exactRawSourceLineHit1: hit('rawSourceLineRank', 1),
    exactRawSourceLineHit5: hit('rawSourceLineRank', 5),
    fullRawHeaderRowPacketHit5: hit('fullRawHeaderRowPacketRank', 5),
    anyPdfDerivedRangeOverlapQueryHit5: hit('anyPdfDerivedRangeOverlapRank', 5),
    anyPdfDerivedRangeOverlapCitationsTop5: topFiveOverlayCitationCounts.anyOverlay,
    pdfDerivedRowFrameOverlapQueryHit5: hit('pdfDerivedRowFrameOverlapRank', 5),
    pdfDerivedRowFrameOverlapCitationsTop5: topFiveOverlayCitationCounts.rowFrames,
    pdfDerivedHeaderMapOnlyOverlapCitationsTop5: topFiveOverlayCitationCounts.headerMapOnly,
    pdfDerivedAnyRowCellAtomHit5: hit('pdfDerivedAnyRowCellAtomRank', 5),
    pdfDerivedCompleteRowBodyHit5: hit('pdfDerivedCompleteRowBodyRank', 5),
    pdfDerivedCompleteCorrectRowHit5: hit('pdfDerivedCompleteCorrectRowRank', 5),
    pdfDerivedCompleteRowFrameHit5: hit('pdfDerivedCompleteRowFrameRank', 5),
    rowAndHeaderHit5: hit('rowAndHeaderRank', 5),
    documentHit5: hit('documentRank', 5),
    queryRowsWithUniqueSourceLabelMapping: firstPass.filter((item) => item.rawSourceRowMappingCount === 1).length,
    queryRowsWithOneMatchingPdfDerivedFrame: firstPass.filter((item) => item.matchingPdfDerivedFrameCount === 1).length,
    stableMetricRanks,
    chunkCount: native.chunkCount,
    emittedNativeChunks: data.chunks.length,
    nativeChunkCharacters: {
      count: charLengths.length,
      min: charLengths[0],
      median: (charLengths[Math.floor((charLengths.length - 1) / 2)]
        + charLengths[Math.ceil((charLengths.length - 1) / 2)]) / 2,
      mean: charLengths.reduce((sum, n) => sum + n, 0) / charLengths.length,
      max: charLengths.at(-1),
      tokenCountRecordedByHarness: false,
    },
    commonFrozenTablePacketsAppearingInOneOrMoreChunks: tablePackets.filter((packet) => data.chunks.some((chunk) => chunk.text.includes(packet.text))).length,
    totalFrozenTablePackets: tablePackets.length,
    initializationMs: native.initializationMs,
    ingestionToPublishedMs: native.ingestionToPublishedMs,
    totalMs: native.totalMs,
    containerCgroupMemoryPeakBytes: native.memoryPeakBytes,
    scopeDenial: native.scopeDenial,
    restart: native.restart,
    queryMetrics: scored,
  };
}

const repairData = runData['source-pdf-repair-v1'];
const derivedRowChunkCoverage = generatedFrameRanges.map((range) => {
  const frame = frameTextById.get(range.id);
  const bodyLine = rowBodyLineFromFrame(frame);
  const frameChunkMatches = repairData.chunks.filter((chunk) =>
    chunk.startOffset < Number(range.end) && chunk.endOffset > Number(range.start));
  const bodyStart = bodyLine ? Number(range.start) + frame.indexOf(bodyLine) : null;
  const bodyEnd = bodyLine ? bodyStart + bodyLine.length : null;
  const bodyLineOverlapMatches = bodyLine ? repairData.chunks.filter((chunk) =>
    chunk.startOffset < bodyEnd && chunk.endOffset > bodyStart) : [];
  const bodyLineContainedMatches = bodyLine ? repairData.chunks.filter((chunk) =>
    chunk.startOffset <= bodyStart && chunk.endOffset >= bodyEnd && chunk.text.includes(bodyLine)) : [];
  const frameContainedMatches = repairData.chunks.filter((chunk) =>
    chunk.startOffset <= Number(range.start) && chunk.endOffset >= Number(range.end) && chunk.text.includes(frame));
  return {
    rangeId: range.id,
    document: range.doc,
    rangeCharacters: frame.length,
    frameOverlapChunkCount: frameChunkMatches.length,
    fullFrameContainedChunkCount: frameContainedMatches.length,
    correctedRowBodyCharacters: bodyLine?.length ?? 0,
    correctedRowBodyOverlapChunkCount: bodyLineOverlapMatches.length,
    correctedRowBodyContainedChunkCount: bodyLineContainedMatches.length,
  };
});
const derivedRowChunkCoverageSummary = {
  completeRowFrames: derivedRowChunkCoverage.length,
  frameCharacters: {
    min: Math.min(...derivedRowChunkCoverage.map((row) => row.rangeCharacters)),
    median: derivedRowChunkCoverage.map((row) => row.rangeCharacters).sort((a, b) => a - b)[Math.floor(derivedRowChunkCoverage.length / 2)],
    max: Math.max(...derivedRowChunkCoverage.map((row) => row.rangeCharacters)),
  },
  fullFrameContainedInOneChunk: derivedRowChunkCoverage.filter((row) => row.fullFrameContainedChunkCount > 0).length,
  frameOverlapChunkCountDistribution: Object.fromEntries([...new Set(derivedRowChunkCoverage.map((row) => row.frameOverlapChunkCount))]
    .sort((a, b) => a - b).map((count) => [String(count), derivedRowChunkCoverage.filter((row) => row.frameOverlapChunkCount === count).length])),
  correctedRowBodyLineContainedInOneChunk: derivedRowChunkCoverage.filter((row) => row.correctedRowBodyContainedChunkCount > 0).length,
  correctedRowBodyOverlapChunkCountDistribution: Object.fromEntries([...new Set(derivedRowChunkCoverage.map((row) => row.correctedRowBodyOverlapChunkCount))]
    .sort((a, b) => a - b).map((count) => [String(count), derivedRowChunkCoverage.filter((row) => row.correctedRowBodyOverlapChunkCount === count).length])),
};

const baseline = metricsByArm.table;
const treatment = metricsByArm['source-pdf-repair-v1'];
const correctEvidenceUnionAt = (arm, k) => {
  const firstPass = arm.queryMetrics.filter((item) => item.repetition === 1);
  const primaryHit = (item) => item.rowRank !== null && item.rowRank <= k;
  const derivedCorrectBodyHit = (item) => item.derivedRowFrameMatchesGold === true
    && item.pdfDerivedCompleteRowBodyRank !== null && item.pdfDerivedCompleteRowBodyRank <= k;
  const primaryCount = firstPass.filter(primaryHit).length;
  const derivedCount = firstPass.filter(derivedCorrectBodyHit).length;
  const overlapCount = firstPass.filter((item) => primaryHit(item) && derivedCorrectBodyHit(item)).length;
  return {
    queryDenominator: firstPass.length,
    primaryCompleteGoldRowHit: primaryCount,
    derivedCompleteGoldRowBodyHit: derivedCount,
    overlapWithPrimaryHit: overlapCount,
    unionCompleteGoldRowEvidenceHit: firstPass.filter((item) => primaryHit(item) || derivedCorrectBodyHit(item)).length,
  };
};
const correctEvidenceUnionAtK = (k) => {
  const tableBaseline = correctEvidenceUnionAt(baseline, k);
  const sourcePdfRepair = correctEvidenceUnionAt(treatment, k);
  return {
    k,
    tableBaseline,
    sourcePdfRepair,
    delta: {
      unionCompleteGoldRowEvidenceHit: sourcePdfRepair.unionCompleteGoldRowEvidenceHit
        - tableBaseline.unionCompleteGoldRowEvidenceHit,
    },
  };
};
const postHocCorrectEvidenceUnion = {
  status: 'POST_HOC_DIAGNOSTIC_NOT_PRIMARY_ACCEPTANCE_METRIC',
  definition: 'Per query, either the existing same-document complete-gold-row hit or an exact complete PDF-derived row-body line in a same-document top-k chunk whose PDF-derived values match the frozen gold row.',
  at1: correctEvidenceUnionAtK(1),
  at5: correctEvidenceUnionAtK(5),
};
const summary = {
  schema: 'zuri.hyper-held-cell-audit-native-evaluation.v1',
  status: 'COMPLETED',
  claimBoundary: 'The source-PDF arm adds geometry-bound table header and numeric-text-layer evidence as a retrieval overlay. It preserves the original Paddle OCR text, keeps unresolved cells in source context, and treats all values as structural/lexical candidates only; semantic truth and graph admission are not assessed.',
  evidence: {
    nativeInputSha256: hashes.nativeInput,
    nativeInputFreezeSha256: hashes.nativeFreeze,
    heldCellFreezeSha256: hashes.heldFreeze,
    heldCellEnumerationSha256: hashes.enumeration,
    pdfValueFreezeSha256: hashes.valueFreeze,
    pdfValueEvidenceSha256: hashes.valueEvidence,
    pdfVectorGeometrySha256: hashes.geometry,
    repairProjectionSha256: hashes.projection,
    repairProjectionFreezeSha256: hashes.projectionFreeze,
    sourceBundleSha256: hashes.sourceBundle,
    heldCellAuditSha256: hashes.heldAudit,
    noQaChunkBoundaryProbeSha256: hashes.chunkProbe,
    goldSha256,
    frozenGoldSha256: manifest.frozen.goldSha256,
    tableNativeResultsSha256: runData.table.files.native,
    sourcePdfNativeResultsSha256: runData['source-pdf-repair-v1'].files.native,
  },
  sourceNativeRepair: {
    primaryHeldCellCohort: heldRecords,
    primaryCauseCounts: heldAudit.primaryCauseCounts,
    sourceCellsReevaluated: enumeration.summary.sourceCellsReevaluated,
    structurallyResolvedCells: enumeration.summary.resolvedCells,
    stillHeldCells: enumeration.summary.heldCells,
    pdfTextLayerAgreements: valueEvidence.summary.statusCounts.SOURCE_TEXT_LAYER_AGREES,
    pdfTextLayerCorrections: valueEvidence.summary.sourceTextLayerCorrections,
    completeCorrectedRows: projection.summary.completeCorrectedRows,
    correctedValueCells: projection.summary.pdfSourceCorrectionCells,
    partialOrExcludedRows: projection.summary.partialCorrectionCells + projection.summary.excludedCorrectionCells,
    rawOcrCellsChanged: projection.summary.rawOcrCellsChanged,
    heldCellRawSourceContextPreserved: true,
    semanticStatus: 'NOT_ASSESSED',
    graphAdmission: 'NONE',
    candidateGraphIncluded: false,
    goldQuestionsOrMetricsUsedByRepair: false,
    modelCalls: 0,
  },
  projectionProfile: {
    baselineTableContentSha256: tableArm.contentSha256,
    baselineTableCharacters: tableArm.content.length,
    treatmentCharacters: treatmentArm.content.length,
    treatmentOverlayCharacters: treatmentArm.sourceRepair.overlayChars,
    overlayPercentOfBaselineTable: treatmentArm.sourceRepair.overlayChars / tableArm.content.length * 100,
    treatmentStartsWithExactBaselineTableContent: treatmentArm.content.startsWith(tableArm.content),
    treatmentRanges: treatmentArm.ranges.length,
    pdfDerivedCompleteRows: generatedFrameRanges.length,
    headerMapRanges: treatmentArm.ranges.filter((range) => range.zoneKind === 'TABLE_HEADER_MAP').length,
    noOriginalSourceOffsetsClaimedForDerivedRanges: treatmentArm.ranges.filter((range) => range.origin)
      .every((range) => !Object.hasOwn(range, 'sourceStart') && !Object.hasOwn(range, 'sourceEnd')),
    commonBaselineHeaderAndRowPacketsAppearInOneOrMoreChunks: {
      table: baseline.commonFrozenTablePacketsAppearingInOneOrMoreChunks,
      sourcePdfRepair: treatment.commonFrozenTablePacketsAppearingInOneOrMoreChunks,
      total: tableArm.packets.length,
    },
    derivedRowChunkCoverage: derivedRowChunkCoverageSummary,
    baselineContentAndPacketCoordinatesUnchanged: true,
    baselineRangeMetadataAddsDocField: true,
  },
  metricDefinitions: {
    rowHit: 'A returned chunk contains a source document label and the exact complete gold row value sequence on one line.',
    exactRawSourceLine: 'The returned chunk contains the exact frozen Paddle OCR row-body string selected by unique source-label match.',
    fullRawHeaderRowPacket: 'The returned chunk contains the exact frozen table packet text (headers plus row) from the table baseline.',
    rowAndHeader: 'The row-hit predicate succeeds and each required header token appears somewhere in the same returned chunk; this is not a same-cell or column-binding assertion.',
    anyPdfDerivedRangeOverlap: 'A cited verifiedRange overlaps any same-document PDF-derived header-map or corrected-row range.',
    pdfDerivedAnyRowCellAtom: 'The returned chunk contains at least one exact generated column/header/value atom from the source row; it is not answer-column-specific.',
    pdfDerivedCompleteRowBody: 'The returned chunk contains the entire generated corrected cell-value line for the query row.',
    pdfDerivedCompleteCorrectRow: 'The generated row line contains the gold row values and all corresponding exact cell atoms occur in one returned chunk.',
    pdfDerivedCompleteRowFrame: 'The returned chunk contains the entire generated PDF-derived row-frame range, including metadata and provenance.',
    commonBaselinePacketCoverage: 'Each count means that packet text appears in at least one native chunk; this is not an exactly-once assertion.',
  },
  sameRunDeltas: {
    rowHit1: treatment.rowHit1 - baseline.rowHit1,
    rowHit5: treatment.rowHit5 - baseline.rowHit5,
    exactRawSourceLineHit1: treatment.exactRawSourceLineHit1 - baseline.exactRawSourceLineHit1,
    exactRawSourceLineHit5: treatment.exactRawSourceLineHit5 - baseline.exactRawSourceLineHit5,
    fullRawHeaderRowPacketHit5: treatment.fullRawHeaderRowPacketHit5 - baseline.fullRawHeaderRowPacketHit5,
    anyPdfDerivedRangeOverlapQueryHit5: treatment.anyPdfDerivedRangeOverlapQueryHit5 - baseline.anyPdfDerivedRangeOverlapQueryHit5,
    anyPdfDerivedRangeOverlapCitationsTop5: treatment.anyPdfDerivedRangeOverlapCitationsTop5 - baseline.anyPdfDerivedRangeOverlapCitationsTop5,
    pdfDerivedAnyRowCellAtomHit5: treatment.pdfDerivedAnyRowCellAtomHit5 - baseline.pdfDerivedAnyRowCellAtomHit5,
    pdfDerivedCompleteRowBodyHit5: treatment.pdfDerivedCompleteRowBodyHit5 - baseline.pdfDerivedCompleteRowBodyHit5,
    pdfDerivedCompleteCorrectRowHit5: treatment.pdfDerivedCompleteCorrectRowHit5 - baseline.pdfDerivedCompleteCorrectRowHit5,
    pdfDerivedCompleteRowFrameHit5: treatment.pdfDerivedCompleteRowFrameHit5 - baseline.pdfDerivedCompleteRowFrameHit5,
    rowAndHeaderHit5: treatment.rowAndHeaderHit5 - baseline.rowAndHeaderHit5,
    documentHit5: treatment.documentHit5 - baseline.documentHit5,
  },
  postHocDiagnostics: {
    correctRowEvidenceUnion: postHocCorrectEvidenceUnion,
  },
  procedure: {
    sameFrozenQAAndControl: true,
    samePinnedImageAndNativeHarness: true,
    separateDisposableNativeStatePerArm: true,
    serializedArmRuns: true,
    network: 'none',
    cpuLimit: 2,
    memoryLimitGiB: 6,
    e5ModelVolumeReadOnly: true,
    modelInferenceCalls: 0,
    candidateGraphInNativeInput: false,
  },
  arms: { tableBaseline: baseline, sourcePdfRepair: treatment },
};
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ status: summary.status, arms: Object.fromEntries(Object.entries(summary.arms).map(([name, arm]) => [name, {
  rowHit1: arm.rowHit1,
  rowHit5: arm.rowHit5,
  exactRawSourceLineHit5: arm.exactRawSourceLineHit5,
  anyPdfDerivedRangeOverlapQueryHit5: arm.anyPdfDerivedRangeOverlapQueryHit5,
  anyPdfDerivedRangeOverlapCitationsTop5: arm.anyPdfDerivedRangeOverlapCitationsTop5,
  pdfDerivedAnyRowCellAtomHit5: arm.pdfDerivedAnyRowCellAtomHit5,
  pdfDerivedCompleteRowBodyHit5: arm.pdfDerivedCompleteRowBodyHit5,
  fullRawHeaderRowPacketHit5: arm.fullRawHeaderRowPacketHit5,
  pdfDerivedCompleteRowFrameHit5: arm.pdfDerivedCompleteRowFrameHit5,
  rowAndHeaderHit5: arm.rowAndHeaderHit5,
  documentHit5: arm.documentHit5,
  totalMs: arm.totalMs,
  memoryPeakBytes: arm.containerCgroupMemoryPeakBytes,
  chunkCount: arm.chunkCount,
}])), sameRunDeltas: summary.sameRunDeltas, summaryPath }, null, 2));
