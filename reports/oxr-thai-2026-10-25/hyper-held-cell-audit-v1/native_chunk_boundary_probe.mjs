// No-QA source-only probe for the frozen GenesisRAG17 TEXT chunker.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const reportDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(reportDir, '../../..');
const rawDir = path.join(root, '.local/hyper-held-cell-audit-20261025');
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const shaText = (value) => sha(Buffer.from(value, 'utf8'));

const [parserModule, baselineInput, nativeInput, oldProjection, projection, baselineNativeChunks] = await Promise.all([
  import(pathToFileURL(path.join(root, 'apps/server/src/modules/knowledge/genesisrag17-source.js'))),
  read(path.join(root, '.local/thai-table-chunking-20261025/run-v2/native-input.json')),
  read(path.join(rawDir, 'native-input-held-cell-repair-layout-v2.json')),
  read(path.join(rawDir, 'source-frame-layout-attempt-1/held-cell-repair-projection-v1.json')),
  read(path.join(rawDir, 'held-cell-repair-projection-layout-v2.json')),
  read(path.join(rawDir, 'native-table-current-attempt-1/chunks.json')),
]);

const baselineArm = baselineInput.arms.find((arm) => arm.parser === 'table');
const currentBaselineArm = nativeInput.arms.find((arm) => arm.parser === 'table');
const treatmentArm = nativeInput.arms.find((arm) => arm.parser === 'source-pdf-repair-v1');
assert.ok(baselineArm && currentBaselineArm && treatmentArm, 'Expected table baseline and source-PDF treatment arms');
assert.equal(currentBaselineArm.content, baselineArm.content, 'Baseline content changed');
assert.equal(currentBaselineArm.contentSha256, baselineArm.contentSha256, 'Baseline content hash changed');
assert.equal(treatmentArm.content.startsWith(baselineArm.content), true, 'Treatment dropped or changed the exact baseline prefix');

const parseText = (content, tag) => parserModule.parseGenesisRag17Document({
  documentId: tag,
  rawArtifactId: `chunk-boundary-probe:${tag}`,
  content,
});
const parsedBaseline = parseText(baselineArm.content, 'table-baseline');
const actualBaselineShape = parsedBaseline.chunks.map(({ text, startOffset, endOffset }) => ({ text, startOffset, endOffset }));
const observedBaselineShape = baselineNativeChunks.map(({ text, startOffset, endOffset }) => ({ text, startOffset, endOffset }));
assert.deepEqual(actualBaselineShape, observedBaselineShape, 'Probe must match the exact chunk text and offsets from the completed native baseline arm');
const parsedTreatment = parseText(treatmentArm.content, 'source-pdf-layout-v2');

const oldRows = new Map(oldProjection.completeRowBlocks.map((block) => [block.blockId, block]));
const newRows = new Map(projection.completeRowBlocks.map((block) => [block.blockId, block]));
assert.equal(oldRows.size, 59, 'Attempt-1 source row count changed');
assert.equal(newRows.size, oldRows.size, 'Layout-only treatment changed source row coverage');
const bodyLines = [];
for (const [blockId, newBlock] of newRows) {
  const oldBlock = oldRows.get(blockId);
  assert.ok(oldBlock, `New row block lacks attempt-1 counterpart: ${blockId}`);
  const newLine = String(newBlock.text).split(/\r?\n/u).find((line) => line.startsWith('row='));
  assert.ok(newLine, `Missing complete row-body line: ${blockId}`);
  assert.deepEqual(newBlock.cells, oldBlock.cells, `Source cell records changed: ${blockId}`);
  assert.equal(newBlock.rowLabelText, oldBlock.rowLabelText, `Source row label changed: ${blockId}`);
  assert.deepEqual(newBlock.rowLabelSourceSpan, oldBlock.rowLabelSourceSpan, `Source row-label span changed: ${blockId}`);
  assert.deepEqual(newBlock.sourceRowSpan, oldBlock.sourceRowSpan, `Source row span changed: ${blockId}`);
  assert.ok(newLine.startsWith(`row=${JSON.stringify(oldBlock.rowLabelText)}|`), `Exact source label missing from row body: ${blockId}`);
  for (const cell of oldBlock.cells) {
    const headerText = cell.headerPath.join(' / ');
    const atom = `c${cell.physicalColumn}[${JSON.stringify(headerText)}]=${JSON.stringify(cell.pdfText)}`;
    assert.ok(newLine.includes(atom), `Exact source header/value field missing from row body: ${blockId}/${cell.recordId}`);
    if (cell.replacementRequired) {
      assert.equal(cell.rawOcrSourceSpan.quote, cell.rawOcrText, `Raw OCR source quote/span changed: ${blockId}/${cell.recordId}`);
    }
  }
  const bodyHeading = '## Source row cells (full header paths and PDF text; semantics NOT_ASSESSED)';
  assert.ok(newBlock.text.indexOf(bodyHeading) < newBlock.text.indexOf(newLine), `Body section heading missing or misplaced: ${blockId}`);
  const range = treatmentArm.ranges.find((item) => item.id === blockId);
  assert.ok(range, `Missing native range for row block ${blockId}`);
  const bodyStart = treatmentArm.content.indexOf(newLine, Number(range.start));
  const bodyEnd = bodyStart + newLine.length;
  assert.ok(bodyStart >= Number(range.start) && bodyEnd <= Number(range.end), `Row body escaped its native range: ${blockId}`);
  const containingChunks = parsedTreatment.chunks.filter((chunk) => chunk.text.includes(newLine)
    && chunk.startOffset <= bodyStart && chunk.endOffset >= bodyEnd);
  assert.equal(containingChunks.length, 1, `Corrected row body must fit exactly one native chunk: ${blockId}`);
  bodyLines.push({ blockId, characters: newLine.length, start: bodyStart, end: bodyEnd, chunkOrdinal: containingChunks[0].ordinal });
}

const packetCoverage = (arm, chunks) => arm.packets.filter((packet) => chunks.some((chunk) => chunk.text.includes(packet.text))).length;
const baselinePacketCount = packetCoverage(baselineArm, parsedBaseline.chunks);
const treatmentPacketCount = packetCoverage(currentBaselineArm, parsedTreatment.chunks);
assert.equal(baselinePacketCount, 114);
assert.equal(treatmentPacketCount, 114);

const outputPath = path.join(rawDir, 'native-chunker-probe-layout-v2.json');
const output = {
  schema: 'zuri.hyper-held-cell-native-chunker-probe.v2',
  status: 'PASS_NO_QA',
  inputs: {
    nativeInputSha256: sha(await fs.readFile(path.join(rawDir, 'native-input-held-cell-repair-layout-v2.json'))),
    projectionSha256: sha(await fs.readFile(path.join(rawDir, 'held-cell-repair-projection-layout-v2.json'))),
    baselineNativeChunksSha256: sha(await fs.readFile(path.join(rawDir, 'native-table-current-attempt-1/chunks.json'))),
  },
  runtime: {
    parserVersion: parsedTreatment.parsed.metadata.extractorVersion,
    chunkerVersion: parsedTreatment.parsed.metadata.chunkerVersion,
    maxTokens: parsedTreatment.parsed.metadata.maxTokens,
    maxChars: parsedTreatment.parsed.metadata.maxChars,
    overlapChars: parsedTreatment.parsed.metadata.overlapChars,
    baselineNativeChunkParity: true,
  },
  baselinePacketCoverageAppearingInOneOrMoreChunks: { table: baselinePacketCount, treatment: treatmentPacketCount, total: 114 },
  sourceRows: {
    expectedCompleteRowBodies: 59,
    unchangedFromAttempt1: true,
    bodyLineWholeInExactlyOneNativeChunk: bodyLines.length,
    minCharacters: Math.min(...bodyLines.map((row) => row.characters)),
    medianCharacters: [...bodyLines].map((row) => row.characters).sort((a, b) => a - b)[Math.floor(bodyLines.length / 2)],
    maxCharacters: Math.max(...bodyLines.map((row) => row.characters)),
    rowBodies: bodyLines,
  },
  goldQuestionsOrMetricsReadOrUsed: false,
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: output.status, rows: output.sourceRows.bodyLineWholeInExactlyOneNativeChunk, baselinePackets: baselinePacketCount, treatmentPackets: treatmentPacketCount, outputPath }, null, 2));
