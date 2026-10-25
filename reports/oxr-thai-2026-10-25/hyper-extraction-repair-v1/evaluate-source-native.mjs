// Score two frozen text arms only after both isolated native runs complete.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { headerSupport, rowSupport, validateNativeRows } from '../real-native/metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rawDir = path.join(root, '.local/hyper-extraction-repair-20261025');
const reportDir = path.dirname(fileURLToPath(import.meta.url));
const nativeInputPath = path.join(rawDir, 'native-input-source-native-v1.json');
const nativeFreezePath = path.join(rawDir, 'native-input-source-native-freeze.json');
const projectionPath = path.join(rawDir, 'source-native-projection.json');
const projectionFreezePath = path.join(rawDir, 'source-native-projection-freeze.json');
const enumerationPath = path.join(rawDir, 'source-native-enumeration.json');
const enumerationFreezePath = path.join(rawDir, 'source-native-freeze.json');
const crosswalkPath = path.join(rawDir, 'extraction-crosswalk.json');
const crosswalkFreezePath = path.join(rawDir, 'extraction-crosswalk-freeze.json');
const sourceBundlePath = path.join(root, '.local/hyper-relation-audit-20261025/run-5/source-bundle.json');
const candidatePath = path.join(root, '.local/hyper-relation-audit-20261025/run-5/evidence-candidates.json');
const candidateFreezePath = path.join(root, '.local/hyper-relation-audit-20261025/run-5/freeze.json');
const goldPath = path.join(root, 'reports/oxr-thai-2026-10-25/real-native/gold.json');
const manifestPath = path.join(root, 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json');
const armsToRun = [
  { parser: 'table', dir: path.join(rawDir, 'native-table-current-attempt-1') },
  { parser: 'source-native-all-rows-v1', dir: path.join(rawDir, 'native-source-native-all-rows-v1-attempt-1') },
];
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const hashText = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const [nativeInput, nativeFreeze, projection, projectionFreeze, enumeration, enumerationFreeze,
  crosswalk, crosswalkFreeze, sourceBundle, candidates, candidateFreeze, gold, manifest] = await Promise.all([
  read(nativeInputPath), read(nativeFreezePath), read(projectionPath), read(projectionFreezePath),
  read(enumerationPath), read(enumerationFreezePath), read(crosswalkPath), read(crosswalkFreezePath),
  read(sourceBundlePath), read(candidatePath), read(candidateFreezePath), read(goldPath), read(manifestPath),
]);
const nativeInputSha256 = await sha(nativeInputPath);
const nativeFreezeSha256 = await sha(nativeFreezePath);
const projectionSha256 = await sha(projectionPath);
const projectionFreezeSha256 = await sha(projectionFreezePath);
const enumerationSha256 = await sha(enumerationPath);
const enumerationFreezeSha256 = await sha(enumerationFreezePath);
const crosswalkSha256 = await sha(crosswalkPath);
const crosswalkFreezeSha256 = await sha(crosswalkFreezePath);
const sourceBundleSha256 = await sha(sourceBundlePath);
const candidateSha256 = await sha(candidatePath);
const candidateFreezeSha256 = await sha(candidateFreezePath);
const goldSha256 = await sha(goldPath);

assert.equal(nativeFreeze.nativeInputSha256, nativeInputSha256);
assert.equal(nativeFreeze.inputSha256.sourceNativeProjection, projectionSha256);
assert.equal(nativeFreeze.inputSha256.sourceNativeProjectionFreeze, projectionFreezeSha256);
assert.equal(nativeFreeze.inputSha256.sourceNativeEnumeration, enumerationSha256);
assert.equal(nativeFreeze.inputSha256.sourceNativeFreeze, enumerationFreezeSha256);
assert.equal(projectionFreeze.sourceNativeProjectionSha256, projectionSha256);
assert.equal(projectionFreeze.sourceNativeFreezeSha256, enumerationFreezeSha256);
assert.equal(enumeration.freezeSha256, enumerationFreezeSha256);
assert.equal(crosswalkFreeze.crosswalkSha256, crosswalkSha256);
assert.equal(crosswalk.sourceNativeProjectionFreezeSha256, projectionFreezeSha256);
assert.equal(crosswalk.candidateReceiptSha256, candidateSha256);
assert.equal(crosswalk.sourceBundleFileSha256, sourceBundleSha256);
assert.equal(candidates.freezeSha256, candidateFreezeSha256);
assert.equal(nativeInput.candidateSidecarIncluded, false);
assert.equal(nativeInput.sourceNativeTreatment.semanticStatus, 'NOT_ASSESSED');
assert.equal(nativeInput.sourceNativeTreatment.graphAdmission, 'NONE');
assert.equal(nativeInput.sourceNativeTreatment.candidateGraphIncluded, false);
assert.equal(nativeInput.sourceNativeTreatment.goldQuestionsOrMetricsUsed, false);
assert.equal(goldSha256.toLowerCase(), manifest.frozen.goldSha256.toLowerCase());

const armFor = (parser) => nativeInput.arms.find((arm) => arm.parser === parser);
const scoredByArm = {};
for (const run of armsToRun) {
  const arm = armFor(run.parser);
  assert.ok(arm, `Missing frozen native arm ${run.parser}`);
  assert.equal(arm.contentSha256, hashText(arm.content));
  const nativePath = path.join(run.dir, 'native-results.json');
  const statePath = path.join(run.dir, 'native-state.json');
  const runtimePath = path.join(run.dir, 'runtime-provenance.json');
  const executedTestPath = path.join(run.dir, 'executed-native.test.js');
  const [native, state, runtime] = await Promise.all([read(nativePath), read(statePath), read(runtimePath)]);
  assert.equal(native.status, 'COMPLETED');
  assert.equal(native.arm, run.parser);
  assert.equal(native.inputHash, arm.contentSha256);
  assert.equal(native.successfulStages, 17);
  assert.equal(native.queries.length, 48);
  assert.equal(native.scopeDenial?.denied, true);
  assert.ok(native.restart?.generation);
  assert.equal(native.goldSha256?.toLowerCase(), manifest.frozen.goldSha256.toLowerCase());
  assert.equal(native.frozenGoldSha256?.toLowerCase(), manifest.frozen.goldSha256.toLowerCase());
  assert.equal(state.ExitCode, 0);
  assert.equal(runtime.gold.sha256.toLowerCase(), manifest.frozen.goldSha256.toLowerCase());
  assert.equal(runtime.gold.expectedFrozenSha256.toLowerCase(), manifest.frozen.goldSha256.toLowerCase());
  assert.equal(runtime.hashes['/app/experiment/native.test.js'], await sha(executedTestPath));
  validateNativeRows(native, arm, gold);

  // Verify whole source row bodies remain intact in the actual chunker output.
  const nativeChunks = await read(path.join(run.dir, 'chunks.json'));
  const sourceZoneRanges = arm.ranges.filter((range) => range.zoneKind === 'table-row' && range.rawSourceStart != null);
  let fullExpandedSourceZonesInOneChunk = null;
  for (const row of sourceZoneRanges) {
    const start = Number(row.rawSourceStart ?? row.start);
    const end = Number(row.rawSourceEnd ?? row.end);
    const expectedHash = row.rawSourceTextSha256 ?? row.textSha256;
    const body = arm.content.slice(start, end);
    assert.equal(hashText(body), expectedHash, `Frozen table source row mismatch ${row.id ?? row.zoneId ?? ''}`);
  }
  if (run.parser === 'source-native-all-rows-v1') {
    fullExpandedSourceZonesInOneChunk = sourceZoneRanges.filter((row) => {
      const start = Number(row.rawSourceStart);
      const end = Number(row.rawSourceEnd);
      const body = arm.content.slice(start, end);
      return nativeChunks.some((chunk) => chunk.startOffset <= start && chunk.endOffset >= end
        && arm.content.slice(chunk.startOffset, chunk.endOffset).includes(body));
    }).length;
  }
  const exactRawRowSpans = sourceBundle.zones.filter((zone) => zone.kind === 'table-row').map((zone) => {
    assert.ok(zone.text.includes(zone.anchorText), `Frozen row anchor is absent in ${zone.id}`);
    if (run.parser === 'source-native-all-rows-v1') {
      const sourceZone = arm.ranges.find((range) => range.zoneId === zone.id && range.zoneKind === 'table-row');
      assert.ok(sourceZone, `Missing source-native range for ${zone.id}`);
      const sourceZoneText = arm.content.slice(sourceZone.rawSourceStart, sourceZone.rawSourceEnd);
      const offset = sourceZoneText.indexOf(zone.anchorText);
      assert.ok(offset >= 0, `Raw row anchor is absent from source-native zone ${zone.id}`);
      return { id: zone.id, start: sourceZone.rawSourceStart + offset, end: sourceZone.rawSourceStart + offset + zone.anchorText.length, text: zone.anchorText };
    }
    const packet = (arm.packets ?? []).find((item) => item.doc === zone.rangeId
      && item.tableId === zone.packet.tableId && item.page === zone.packet.page && item.row === zone.packet.row);
    assert.ok(packet, `Missing table baseline packet for ${zone.id}`);
    const packetText = arm.content.slice(packet.start, packet.end);
    const offset = packetText.indexOf(zone.anchorText);
    assert.ok(offset >= 0, `Raw row anchor is absent from table packet ${zone.id}`);
    return { id: zone.id, start: packet.start + offset, end: packet.start + offset + zone.anchorText.length, text: zone.anchorText };
  });
  let exactRawRowBodiesInOneChunk = 0;
  for (const row of exactRawRowSpans) {
    const body = arm.content.slice(row.start, row.end);
    assert.equal(body, row.text, `Exact raw row body offset mismatch ${row.id}`);
    if (nativeChunks.some((chunk) => chunk.startOffset <= row.start && chunk.endOffset >= row.end
      && arm.content.slice(chunk.startOffset, chunk.endOffset).includes(body))) exactRawRowBodiesInOneChunk += 1;
  }
  const baselineTableArm = armFor('table');
  let commonHeaderRowPacketsInOneChunk = 0;
  for (const packet of baselineTableArm.packets) {
    const zone = sourceBundle.zones.find((item) => item.kind === 'table-row' && item.rangeId === packet.doc
      && item.packet.tableId === packet.tableId && item.packet.page === packet.page && item.packet.row === packet.row);
    assert.ok(zone, `Missing source zone for frozen table packet ${packet.tableId}/${packet.row}`);
    assert.ok(zone.text.includes(packet.text), `Frozen source row does not contain baseline packet text: ${zone.id}`);
    const matches = nativeChunks.filter((chunk) => chunk.text.includes(packet.text));
    if (matches.length === 1) commonHeaderRowPacketsInOneChunk += 1;
  }
  const chunkCharacters = nativeChunks.map((chunk) => String(chunk.text).length).sort((a, b) => a - b);
  const medianChunkCharacters = (chunkCharacters[Math.floor((chunkCharacters.length - 1) / 2)]
    + chunkCharacters[Math.ceil((chunkCharacters.length - 1) / 2)]) / 2;

  const firstPass = native.queries.filter((item) => item.repetition === 1);
  const repeats = native.queries.filter((item) => item.repetition > 1);
  assert.equal(firstPass.length, 16);
  const scored = native.queries.map((item) => {
    const document = gold.documents.find((candidate) => candidate.id === item.doc);
    assert.ok(document, `Unknown document ${item.doc}`);
    const query = document.qa.find((candidate) => candidate.id === item.id);
    const row = document.rows.find((candidate) => candidate.id === query.row);
    const exactSourceRows = sourceBundle.zones.filter((zone) => zone.kind === 'table-row'
      && zone.rangeId === document.id && rowSupport(zone.anchorText, row));
    const rank = (predicate) => {
      const index = item.response.results.findIndex(predicate);
      return index < 0 ? null : index + 1;
    };
    const supportsRow = (result) => result.document === document.id && rowSupport(result.text, row);
    const supportsExactSourceRow = (result) => result.document === document.id
      && exactSourceRows.some((zone) => result.text.includes(zone.anchorText));
    return {
      id: item.id, doc: item.doc, repetition: item.repetition, elapsedMs: item.elapsedMs,
      rowRank: rank(supportsRow),
      rawSourceRowRank: rank(supportsExactSourceRow),
      rowAndHeaderRank: rank((result) => supportsRow(result) && headerSupport(result.text, query.headers)),
      documentRank: rank((result) => result.document === document.id),
    };
  });
  const firstScored = scored.filter((item) => item.repetition === 1);
  const hit = (field, k) => firstScored.filter((item) => item[field] !== null && item[field] <= k).length;
  const stableRanks = firstPass.filter((item) => repeats.filter((repeat) => repeat.id === item.id && repeat.doc === item.doc)
    .every((repeat) => {
      const first = scored.find((x) => x.id === item.id && x.doc === item.doc && x.repetition === 1);
      const later = scored.find((x) => x.id === item.id && x.doc === item.doc && x.repetition === repeat.repetition);
      return later.rowRank === first.rowRank && later.rawSourceRowRank === first.rawSourceRowRank
        && later.rowAndHeaderRank === first.rowAndHeaderRank
        && later.documentRank === first.documentRank;
    })).length;
  scoredByArm[run.parser] = {
    parser: run.parser,
    armContentSha256: arm.contentSha256,
    nativeResultsSha256: await sha(nativePath),
    runtimeProvenanceSha256: await sha(runtimePath),
    executedHarnessSha256: await sha(executedTestPath),
    runState: state,
    status: native.status,
    successfulStages: native.successfulStages,
    queriesPerPass: firstPass.length,
    totalQueries: native.queries.length,
    rowHit1: hit('rowRank', 1),
    rowHit5: hit('rowRank', 5),
    exactRawSourceRowHit1: hit('rawSourceRowRank', 1),
    exactRawSourceRowHit5: hit('rawSourceRowRank', 5),
    rowMetricHitsWithoutExactRawRowAt5: firstScored.filter((item) => item.rowRank !== null && item.rowRank <= 5
      && (item.rawSourceRowRank === null || item.rawSourceRowRank > 5)).length,
    rowAndHeaderHit5: hit('rowAndHeaderRank', 5),
    documentHit5: hit('documentRank', 5),
    stableMetricRanks: stableRanks,
    chunkCount: native.chunkCount,
    nativeChunkCharacters: {
      count: chunkCharacters.length,
      min: chunkCharacters[0],
      median: medianChunkCharacters,
      mean: chunkCharacters.reduce((sum, value) => sum + value, 0) / chunkCharacters.length,
      max: chunkCharacters.at(-1),
      tokenCountRecordedByHarness: false,
    },
    commonFrozenHeaderAndRowPacketsInOneNativeChunk: commonHeaderRowPacketsInOneChunk,
    exactRawRowBodiesInOneNativeChunk: exactRawRowBodiesInOneChunk,
    sourceTableRows: exactRawRowSpans.length,
    fullExpandedSourceZonesInOneChunk: fullExpandedSourceZonesInOneChunk,
    fullExpandedSourceZoneMetricIsComparableToBaseline: false,
    initializationMs: native.initializationMs,
    ingestionToPublishedMs: native.ingestionToPublishedMs,
    totalMs: native.totalMs,
    memoryPeakBytes: native.memoryPeakBytes,
    scopeDenial: native.scopeDenial,
    restart: native.restart,
  };
}

const table = scoredByArm.table;
const sourceNative = scoredByArm['source-native-all-rows-v1'];
const summary = {
  schema: 'zuri.hyper-extraction-repair-native-evaluation.v1',
  status: 'COMPLETED',
  claimBoundary: 'The source-native arm adds deterministic source-cell and header references beside complete frozen source rows. These are lexical/structural candidates only; no business semantics or graph authority are assessed.',
  evidence: {
    nativeInputSha256,
    nativeInputFreezeSha256: nativeFreezeSha256,
    sourceNativeEnumerationSha256: enumerationSha256,
    sourceNativeFreezeSha256: enumerationFreezeSha256,
    sourceNativeProjectionSha256: projectionSha256,
    sourceNativeProjectionFreezeSha256: projectionFreezeSha256,
    extractionCrosswalkSha256: crosswalkSha256,
    extractionCrosswalkFreezeSha256: crosswalkFreezeSha256,
    sourceBundleSha256,
    run5CandidateReceiptSha256: candidateSha256,
    run5CandidateFreezeSha256: candidateFreezeSha256,
    goldSha256,
    frozenGoldSha256: manifest.frozen.goldSha256,
  },
  sourceNativeInventory: {
    tableCount: enumeration.summary.tables,
    packets: enumeration.summary.sourcePackets,
    rows: enumeration.summary.sourceRows,
    cells: enumeration.summary.sourceCells,
    structurallyResolvedValueCellCandidates: enumeration.summary.structurallyResolvedValueCellCandidates,
    structurallyResolvedRowLabelCells: enumeration.summary.structurallyResolvedRowLabelCells,
    heldCellsContextOnly: enumeration.summary.heldCells,
    unresolvedRowSequencesContextOnly: enumeration.summary.rowSequencesHeld,
    sourceZones: projection.summary.sourceZonesIncluded,
    nonTableSourceZonesContextOnly: projection.summary.nonTableContextZonesIncluded,
    exactRawSourceCharacters: projection.summary.rawSourceRangeChars,
    generatedFramingCharacters: projection.summary.generatedFramingChars,
    generatedFramingPercentOfRawSource: projection.summary.generatedFramingChars / projection.summary.rawSourceRangeChars * 100,
    projectionCharacters: projection.summary.projectionChars,
    completeSourceRangeCoveragePercent: projection.summary.rawRangeCoveragePct,
    sourceTextChanged: projection.summary.sourceTextModified,
    semanticStatus: 'NOT_ASSESSED',
    graphAdmission: 'NONE',
  },
  arms: {
    currentTableBaseline: table,
    sourceNativeAllRows: sourceNative,
  },
  sameRunDeltas: {
    rowHit1: sourceNative.rowHit1 - table.rowHit1,
    rowHit5: sourceNative.rowHit5 - table.rowHit5,
    exactRawSourceRowHit5: sourceNative.exactRawSourceRowHit5 - table.exactRawSourceRowHit5,
    rowAndHeaderHit5: sourceNative.rowAndHeaderHit5 - table.rowAndHeaderHit5,
    documentHit5: sourceNative.documentHit5 - table.documentHit5,
  },
  procedure: {
    sameFrozenBaselineNativeInput: true,
    samePinnedImageAndHarness: true,
    separateDisposableStatePerArm: true,
    serializedArmRuns: true,
    network: 'none',
    cpuLimit: 2,
    memoryLimitGiB: 6,
    e5ModelVolumeReadOnly: true,
    modelInferenceCalls: 0,
    modelCandidateOutputInNativeInput: false,
    graphDataInNativeInput: false,
  },
};
const out = path.join(reportDir, 'measurement-summary.json');
await fs.writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ status: summary.status, arms: summary.arms, sourceNativeInventory: summary.sourceNativeInventory, sameRunDeltas: summary.sameRunDeltas, summaryPath: out }, null, 2));
