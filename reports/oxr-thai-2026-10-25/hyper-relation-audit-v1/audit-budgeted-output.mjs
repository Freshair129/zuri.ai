// No-gold mechanical audit of the completed run-5 candidate and validator output.
import fs from 'node:fs';
import crypto from 'node:crypto';

const runRoot = '.local/hyper-relation-audit-20261025/run-5';
const reportRoot = 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1';
const readBytes = (file) => fs.readFileSync(file);
const readJson = (file) => JSON.parse(readBytes(file).toString('utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha256Text = (value) => sha256(Buffer.from(value, 'utf8'));

const freezeBytes = readBytes(`${runRoot}/freeze.json`);
const candidateBytes = readBytes(`${runRoot}/evidence-candidates.json`);
const validationBytes = readBytes(`${runRoot}/validated-evidence.json`);
const sourceBundleBytes = readBytes(`${runRoot}/source-bundle.json`);
const freeze = JSON.parse(freezeBytes.toString('utf8'));
const candidates = JSON.parse(candidateBytes.toString('utf8'));
const validation = JSON.parse(validationBytes.toString('utf8'));
const bundle = JSON.parse(sourceBundleBytes.toString('utf8'));
const sourceById = new Map(bundle.sourceRanges.map((source) => [source.id, source]));
const validationById = new Map(validation.facts.map((fact) => [fact.candidateId, fact]));

if (freeze.runId !== 'run-5' || candidates.status !== 'COMPLETED' || validation.runId !== 'run-5') {
  throw new Error('Audit requires the complete, frozen run-5 receipt and validation');
}
if (candidates.freezeSha256 !== sha256(freezeBytes)
  || candidates.sourceBundleSha256 !== freeze.source.sourceBundleSha256
  || sha256(sourceBundleBytes) !== freeze.source.sourceBundleFileSha256
  || sha256Text(JSON.stringify(bundle)) !== freeze.source.sourceBundleSha256) {
  throw new Error('Run-5 freeze/source hash mismatch');
}
if (validation.candidateReceiptSha256 !== sha256(candidateBytes)
  || validation.freezeSha256 !== sha256(freezeBytes)) {
  throw new Error('Run-5 candidate/validation binding mismatch');
}

function sourceSpan(source, chunk, start, end, quote, kind, zoneId) {
  const sourceOffset = start - source.sourceStart;
  const chunkOffset = start - chunk.sourceStart;
  const valid = Number.isInteger(start) && Number.isInteger(end) && end > start
    && sourceOffset >= 0 && end <= source.sourceStart + source.text.length
    && chunkOffset >= 0 && end <= chunk.sourceEnd
    && source.text.slice(sourceOffset, sourceOffset + quote.length) === quote
    && chunk.inputText.slice(chunkOffset, chunkOffset + quote.length) === quote;
  return valid ? {
    kind,
    zoneId,
    sourceStart: start,
    sourceEnd: end,
    chunkIndex: chunk.chunkIndex,
    chunkTextStart: chunkOffset,
    chunkTextEnd: chunkOffset + quote.length,
    quote,
    quoteSha256: sha256Text(quote),
  } : null;
}

function cellSpan(source, chunk, zone, binding, quote, kind) {
  if (!binding || typeof quote !== 'string' || !quote) return null;
  const cells = zone.anchorText.split('\t');
  const rawCell = cells[binding.cell];
  if (typeof rawCell !== 'string' || rawCell.trim() !== quote) return null;
  const anchorStart = zone.text.indexOf(zone.anchorText);
  if (anchorStart < 0) return null;
  const cellStart = cells.slice(0, binding.cell).reduce((length, cell) => length + cell.length + 1, 0);
  return sourceSpan(source, chunk,
    zone.sourceStart + anchorStart + cellStart + rawCell.indexOf(quote),
    zone.sourceStart + anchorStart + cellStart + rawCell.indexOf(quote) + quote.length,
    quote, kind, zone.id);
}

function headerSpans(source, chunk, zone, binding, quote) {
  if (!quote || !binding || !Array.isArray(binding.headerRefs)) return [];
  const relationStart = zone.text.indexOf(zone.relationText);
  if (relationStart < 0) return [];
  const spans = [];
  let lineStart = 0;
  for (const line of zone.relationText.split('\n')) {
    const match = /^h(\d+) c(\d+)(?:-(\d+))?=(.*)$/u.exec(line);
    if (match) {
      const row = Number(match[1]) - 1;
      const firstCell = Number(match[2]) - 1;
      const lastCell = match[3] ? Number(match[3]) - 1 : firstCell;
      const headerCell = match[4];
      const hasBoundRef = binding.headerRefs.some((ref) =>
        ref.row === row && binding.col >= firstCell && binding.col <= lastCell);
      if (hasBoundRef && headerCell.trim() === quote) {
        const quoteAt = headerCell.indexOf(quote);
        const start = zone.sourceStart + relationStart + lineStart + line.indexOf('=') + 1 + quoteAt;
        const span = sourceSpan(source, chunk, start, start + quote.length, quote, 'header_cell', zone.id);
        if (span) spans.push({ ...span, headerRow: row, renderedColumnSpan: { start: firstCell, end: lastCell } });
      }
    }
    lineStart += line.length + 1;
  }
  return spans;
}

function exactRowMatches(source, chunk, zones, quote) {
  if (!quote) return [];
  return zones.filter((zone) => zone.kind === 'table-row' && zone.anchorText === quote).map((zone) => {
    const anchorAt = zone.text.indexOf(zone.anchorText);
    if (anchorAt < 0) return { zone, span: null };
    const start = zone.sourceStart + anchorAt;
    return { zone, span: sourceSpan(source, chunk, start, start + quote.length, quote, 'whole_row_quote', zone.id) };
  });
}

function analyzeFact(sourceId, chunk, candidate, originalValidation, zones) {
  const source = sourceById.get(sourceId);
  const rowMatches = exactRowMatches(source, chunk, zones, candidate.rowQuote);
  const exactRows = rowMatches.filter((match) => match.span);
  const sourceRows = rowMatches.length;
  const uniqueExactRow = exactRows.length === 1 ? exactRows[0] : null;
  const packet = uniqueExactRow?.zone.packet || null;
  const candidateSubjectBinding = packet?.bindings?.find((binding) => binding.col === candidate.subjectColumnIndex) || null;
  const candidateValueBinding = packet?.bindings?.find((binding) => binding.col === candidate.columnIndex) || null;
  const candidateSubjectSpan = uniqueExactRow && cellSpan(source, chunk, uniqueExactRow.zone, candidateSubjectBinding, candidate.subject, 'subject_cell');
  const candidateValueSpan = uniqueExactRow && cellSpan(source, chunk, uniqueExactRow.zone, candidateValueBinding, candidate.value, 'value_cell');
  const candidateHeaderSpans = uniqueExactRow && candidateValueBinding
    ? headerSpans(source, chunk, uniqueExactRow.zone, candidateValueBinding, candidate.headerQuote)
    : [];

  const uniqueCellHeaderMatches = [];
  const cellHeaderRows = [];
  for (const zone of zones.filter((item) => item.kind === 'table-row')) {
    const zonePacket = zone.packet || {};
    const subjectBinding = zonePacket.bindings?.find((binding) => binding.col === candidate.subjectColumnIndex);
    const subject = subjectBinding && cellSpan(source, chunk, zone, subjectBinding, candidate.subject, 'subject_cell');
    if (!subject) continue;
    const valueHeaderPairs = [];
    for (const valueBinding of zonePacket.bindings || []) {
      const value = cellSpan(source, chunk, zone, valueBinding, candidate.value, 'value_cell');
      if (!value) continue;
      const headers = headerSpans(source, chunk, zone, valueBinding, candidate.headerQuote);
      for (const header of headers) valueHeaderPairs.push({ value, header, valueColumn: valueBinding.col });
    }
    if (valueHeaderPairs.length) {
      cellHeaderRows.push({ zoneId: zone.id, subject, valueHeaderPairs });
      for (const pair of valueHeaderPairs) uniqueCellHeaderMatches.push({ zoneId: zone.id, subject, ...pair });
    }
  }

  const metadataMatches = uniqueExactRow ? {
    tableIdMatchesPacket: candidate.tableId === packet.tableId,
    tableRowLabelMatchesPacket: candidate.tableRowLabel === packet.sourceHeadingLabel,
    packetTableId: packet.tableId,
    packetRowLabel: packet.sourceHeadingLabel,
  } : null;
  let candidateRowQuoteStatus = 'NO_EXACT_SOURCE_ROW';
  if (sourceRows > 1 || exactRows.length > 1) candidateRowQuoteStatus = 'AMBIGUOUS_EXACT_ROWS';
  else if (sourceRows === 1 && exactRows.length === 1) candidateRowQuoteStatus = 'EXACT_ROW_IN_EMITTING_CHUNK';
  else if (sourceRows === 1) candidateRowQuoteStatus = 'EXACT_ROW_OUTSIDE_EMITTING_CHUNK';
  else if (zones.some((zone) => zone.kind === 'table-row' && zone.anchorText === candidate.rowQuote)) candidateRowQuoteStatus = 'EXACT_ROW_OTHER_SOURCE';

  return {
    candidateId: originalValidation.candidateId,
    sourceId,
    chunkIndex: chunk.chunkIndex,
    candidateKind: candidate.kind,
    candidateSubject: candidate.subject,
    candidatePredicate: candidate.predicate,
    candidateValue: candidate.value,
    candidateDescription: candidate.description,
    candidateHeaderQuote: candidate.headerQuote,
    modelTableId: candidate.tableId,
    modelTableRowLabel: candidate.tableRowLabel,
    modelSubjectColumnIndex: candidate.subjectColumnIndex,
    modelValueColumnIndex: candidate.columnIndex,
    validatorSourceStatus: originalValidation.sourceStatus,
    semanticStatus: 'NOT_ASSESSED',
    rowQuote: {
      quoteSha256: candidate.rowQuote ? sha256Text(candidate.rowQuote) : null,
      exactRowStatus: candidateRowQuoteStatus,
      exactSourceMatchCount: sourceRows,
      exactEmittingChunkSpanCount: exactRows.length,
      exactSpan: uniqueExactRow?.span || null,
      packetMetadata: metadataMatches,
    },
    candidateIndexedCells: {
      subjectSpan: candidateSubjectSpan,
      valueSpan: candidateValueSpan,
      headerSpans: candidateHeaderSpans,
      modelIndicesBindExactSource: Boolean(candidateSubjectSpan && candidateValueSpan && candidateHeaderSpans.length),
    },
    sourceResolvedCellHeaderProbe: {
      rule: 'Keep model subjectColumnIndex fixed; resolve any value cell with exact full-cell equality and an exact header quote bound to that value column in the same table row and emitting chunk. Does not use packet label, model columnIndex, audit labels, gold, or questions.',
      uniqueExactMatches: uniqueCellHeaderMatches.length,
      matches: uniqueCellHeaderMatches,
      rowCountWithAnyExactMatch: cellHeaderRows.length,
      status: uniqueCellHeaderMatches.length === 1 ? 'UNIQUE_EXACT_SUBJECT_HEADER_VALUE_CANDIDATE' : uniqueCellHeaderMatches.length > 1 ? 'AMBIGUOUS_EXACT_CELL_HEADER_CANDIDATE' : 'NO_EXACT_CELL_HEADER_CANDIDATE',
    },
  };
}

const facts = [];
for (const document of candidates.documents) {
  const source = sourceById.get(document.sourceId);
  if (!source || document.sourceTextSha256 !== source.textSha256) throw new Error(`Source receipt mismatch: ${document.sourceId}`);
  const zones = bundle.zones.filter((zone) => zone.rangeId === document.sourceId);
  for (const chunk of document.chunks) {
    for (let index = 0; index < chunk.facts.length; index += 1) {
      const candidateId = `${document.sourceId}:${chunk.chunkIndex}:fact:${index}`;
      const originalValidation = validationById.get(candidateId);
      if (!originalValidation) throw new Error(`Validator omitted candidate: ${candidateId}`);
      facts.push(analyzeFact(document.sourceId, chunk, chunk.facts[index], originalValidation, zones));
    }
  }
}

const statusCounts = facts.reduce((counts, item) => {
  counts[item.validatorSourceStatus] = (counts[item.validatorSourceStatus] || 0) + 1;
  return counts;
}, {});
const probeCounts = facts.reduce((counts, item) => {
  counts[item.sourceResolvedCellHeaderProbe.status] = (counts[item.sourceResolvedCellHeaderProbe.status] || 0) + 1;
  return counts;
}, {});
const output = {
  schema: 'zuri.hyper-relation-budgeted-output-mechanical-audit.v1',
  scope: 'Run-5 evidence candidates, exact frozen Paddle source bundle and run-5 v5 validator output only.',
  goldOrQuestionsUsed: false,
  manualSemanticAuditUsed: false,
  semanticStatus: 'NOT_ASSESSED',
  candidateBudgetIsNonExhaustive: true,
  provenance: {
    freezeSha256: sha256(freezeBytes),
    candidateReceiptSha256: sha256(candidateBytes),
    validationReceiptSha256: sha256(validationBytes),
    sourceBundleFileSha256: sha256(sourceBundleBytes),
    sourceBundleSha256: freeze.source.sourceBundleSha256,
    validatorSourceSha256: sha256(readBytes(`${reportRoot}/evidence-adapter-v2.mjs`)),
    auditScriptSha256: sha256(readBytes(`${reportRoot}/audit-budgeted-output.mjs`)),
  },
  summary: {
    chunks: candidates.documents.reduce((sum, document) => sum + document.chunks.length, 0),
    factCandidateOccurrences: facts.length,
    relationCandidateOccurrences: candidates.documents.reduce((sum, document) => sum + document.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.relations.length, 0), 0),
    sourceStatusCounts: statusCounts,
    exactCellHeaderProbeCounts: probeCounts,
    uniquelyResolvedExactCellHeaderCandidates: facts.filter((item) => item.sourceResolvedCellHeaderProbe.status === 'UNIQUE_EXACT_SUBJECT_HEADER_VALUE_CANDIDATE').length,
    interpretation: 'Mechanical lexical evidence diagnostics only. Unique cell/header resolution is not a semantic verdict and was not used to change the frozen v5 projection or scoring input.',
  },
  facts,
};

const target = `${runRoot}/budgeted-output-audit.json`;
if (fs.existsSync(target)) throw new Error(`Refusing to overwrite ${target}`);
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status: 'COMPLETED_NO_GOLD_MECHANICAL_AUDIT', output: target, summary: output.summary }, null, 2));
