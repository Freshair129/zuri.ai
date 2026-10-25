// No-QA parity and whole-row probe against the pinned GenesisRAG17 parser.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const reportDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(reportDir, '../../..');
const rawDir = path.join(root, '.local/hyper-economy-cell-repair-20261025');
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const shaText = (value) => sha(Buffer.from(value, 'utf8'));
const inputs = {
  baseline: path.join(root, '.local/thai-table-chunking-20261025/run-v2/native-input.json'),
  baselineChunks: path.join(root, '.local/hyper-held-cell-audit-20261025/native-table-current-attempt-1/chunks.json'),
  priorNativeInput: path.join(root, '.local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2.json'),
  priorProjection: path.join(root, '.local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2.json'),
  rows: path.join(rawDir, 'pdf-baseline-rows-v1.json'),
  nativeInput: path.join(rawDir, 'native-input-economy-pdf-rows-v1.json'),
  nativeFreeze: path.join(rawDir, 'native-input-economy-pdf-rows-freeze-v1.json'),
};
const [parserModule, baselineInput, baselineChunks, priorNativeInput, priorProjection, sourceRows, nativeInput, nativeFreeze] = await Promise.all([
  import(pathToFileURL(path.join(root, 'apps/server/src/modules/knowledge/genesisrag17-source.js'))),
  read(inputs.baseline), read(inputs.baselineChunks), read(inputs.priorNativeInput), read(inputs.priorProjection), read(inputs.rows), read(inputs.nativeInput), read(inputs.nativeFreeze),
]);
const baselineTable = baselineInput.arms.find((arm) => arm.parser === 'table');
const candidateTable = nativeInput.arms.find((arm) => arm.parser === 'table');
const priorCandidate = priorNativeInput.arms.find((arm) => arm.parser === 'source-pdf-repair-v1');
const candidate = nativeInput.arms.find((arm) => arm.parser === 'source-pdf-repair-plus-economy-rows-v1');
assert.ok(baselineTable && candidateTable && candidate, 'Expected baseline and PDF row arms');
assert.equal(candidateTable.content, baselineTable.content, 'Current table baseline bytes changed');
assert.equal(candidateTable.contentSha256, baselineTable.contentSha256, 'Current table baseline hash changed');
assert.ok(priorCandidate, 'Missing frozen previous PDF repair arm');
assert.equal(candidate.content.startsWith(priorCandidate.content), true, 'Candidate did not preserve the exact prior PDF repair prefix');
assert.equal(candidate.content.startsWith(baselineTable.content), true, 'Candidate did not preserve the exact baseline prefix');
assert.equal(nativeFreeze.nativeInputSha256, sha(await fs.readFile(inputs.nativeInput)));
assert.equal(nativeFreeze.inputSha256.baselineNativeInput, sha(await fs.readFile(inputs.baseline)));
assert.equal(nativeFreeze.inputSha256.pdfBaselineRows, sha(await fs.readFile(inputs.rows)));

const parseText = (content, tag) => parserModule.parseGenesisRag17Document({
  documentId: tag,
  rawArtifactId: `economy-pdf-row-probe:${tag}`,
  content,
});
const parsedBaseline = parseText(baselineTable.content, 'table-baseline');
const actualBaselineShape = parsedBaseline.chunks.map(({ text, startOffset, endOffset }) => ({ text, startOffset, endOffset }));
const savedBaselineShape = baselineChunks.map(({ text, startOffset, endOffset }) => ({ text, startOffset, endOffset }));
assert.deepEqual(actualBaselineShape, savedBaselineShape, 'Baseline chunker output differs from the completed current-table run');
const parsedCandidate = parseText(candidate.content, 'pdf-economy-baseline-rows-v1');

const priorRowBlocks = priorProjection.completeRowBlocks;
assert.equal(priorRowBlocks.length, 59, 'Prior frozen PDF repair row set changed');
const priorRowProbe = [];
for (const block of priorRowBlocks) {
  const line = String(block.text).split(/\r?\n/u).find((item) => item.startsWith('row='));
  assert.ok(line, `Prior corrected row body is absent: ${block.blockId}`);
  const priorRange = priorCandidate.ranges.find((range) => range.id === block.blockId);
  assert.ok(priorRange, `Prior native arm lacks row range: ${block.blockId}`);
  assert.ok(priorCandidate.content.slice(priorRange.start, priorRange.end).includes(line), `Prior row body/range mismatch: ${block.blockId}`);
  const bodyStart = priorCandidate.content.indexOf(line, priorRange.start);
  assert.ok(bodyStart >= priorRange.start && bodyStart + line.length <= priorRange.end, `Prior row body offsets escape its frame: ${block.blockId}`);
  const chunks = parsedCandidate.chunks.filter((chunk) => chunk.startOffset <= bodyStart
    && chunk.endOffset >= bodyStart + line.length && chunk.text.includes(line));
  assert.equal(chunks.length, 1, `Prior full row body no longer fits one chunk: ${block.blockId}`);
  priorRowProbe.push({ blockId: block.blockId, chars: line.length, chunkOrdinal: chunks[0].ordinal });
}

const candidateRanges = candidate.ranges.filter((range) => range.rangeKind === 'PDF_NATIVE_BASELINE_ROW_CANDIDATE');
assert.equal(candidateRanges.length, 37);
assert.equal(sourceRows.candidateRows.length, 37);
const rowsById = new Map(sourceRows.candidateRows.map((row) => [row.rowId, row]));
const rowProbe = [];
for (const range of candidateRanges) {
  const row = rowsById.get(range.id);
  assert.ok(row, `Candidate range has no source row: ${range.id}`);
  const line = candidate.content.slice(range.start, range.end);
  assert.equal(shaText(line), range.textSha256, `Row range hash mismatch: ${range.id}`);
  const label = `row=${JSON.stringify(row.rowLabel.text)}`;
  assert.ok(line.startsWith(label), `Exact PDF row label missing: ${range.id}`);
  for (const cell of row.cells) {
    const atom = `slot${cell.slot}=${JSON.stringify(cell.header.text)}|value=${JSON.stringify(cell.pdfText)}`;
    assert.ok(line.includes(atom), `Exact PDF header/value missing: ${range.id}/${cell.slot}`);
  }
  const containingChunks = parsedCandidate.chunks.filter((chunk) => (
    chunk.startOffset <= range.start && chunk.endOffset >= range.end && chunk.text.includes(line)
  ));
  assert.equal(containingChunks.length, 1, `Complete source row must occupy one real native chunk: ${range.id}`);
  rowProbe.push({
    rowId: range.id,
    baselinePdfPoints: row.baselinePdfPoints,
    chars: line.length,
    chunkOrdinal: containingChunks[0].ordinal,
    pdfWordIndexes: row.cells.map((cell) => cell.pdfWordIndex),
    paddleRecordIndexes: row.cells.map((cell) => cell.paddleCorroboration.recordIndex),
  });
}

const packetCoverage = (packets, chunks) => packets.filter((packet) => chunks.some((chunk) => chunk.text.includes(packet.text))).length;
const basePacketsInBaseline = packetCoverage(baselineTable.packets, parsedBaseline.chunks);
const basePacketsInCandidate = packetCoverage(baselineTable.packets, parsedCandidate.chunks);
assert.equal(basePacketsInBaseline, 114);
assert.equal(basePacketsInCandidate, 114);

const output = {
  schema: 'hyper-economy-native-chunker-probe-v1',
  status: 'PASS_NO_QA',
  inputs: Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([key, file]) => [key, sha(await fs.readFile(file))]))),
  runtime: {
    parserVersion: parsedCandidate.parsed.metadata.extractorVersion,
    chunkerVersion: parsedCandidate.parsed.metadata.chunkerVersion,
    maxTokens: parsedCandidate.parsed.metadata.maxTokens,
    maxChars: parsedCandidate.parsed.metadata.maxChars,
    overlapChars: parsedCandidate.parsed.metadata.overlapChars,
    baselineNativeChunkParity: true,
  },
  baselineTablePacketsAppearingInOneOrMoreChunks: {
    currentTableArm: basePacketsInBaseline,
    candidateArmPrefix: basePacketsInCandidate,
    total: 114,
  },
  sourceRows: {
    expectedRows: 37,
    rowLabelAndAllSevenHeaderValueAtomsInOneChunk: rowProbe.length,
    totalValueCells: rowProbe.reduce((sum, row) => sum + row.pdfWordIndexes.length, 0),
    minRowChars: Math.min(...rowProbe.map((row) => row.chars)),
    medianRowChars: [...rowProbe].map((row) => row.chars).sort((a, b) => a - b)[Math.floor(rowProbe.length / 2)],
    maxRowChars: Math.max(...rowProbe.map((row) => row.chars)),
    rows: rowProbe,
  },
  priorPdfRepairRows: {
    expectedRows: 59,
    unchangedBodiesInOneNativeChunk: priorRowProbe.length,
    rows: priorRowProbe,
  },
  goldQuestionsOrMetricsReadOrUsed: false,
};
const outPath = path.join(rawDir, 'native-chunker-probe-v1.json');
await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: output.status, rows: output.sourceRows.rowLabelAndAllSevenHeaderValueAtomsInOneChunk, cells: output.sourceRows.totalValueCells, baselinePackets: basePacketsInCandidate, runtime: output.runtime, outPath }, null, 2));
