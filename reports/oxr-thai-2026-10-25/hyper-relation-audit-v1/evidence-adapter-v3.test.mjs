import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { validateEvidenceRun } from './evidence-adapter-v3.mjs';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function tableFixture({
  candidate = {},
  rows = ['1\tจังหวัด A\t100\t200\t2024'],
  chunkRange,
} = {}) {
  const headerLines = 'h1 c1=ลำดับ\nh1 c2=จังหวัด\nh2 c3-4=จำนวนราษฎร\nh3 c5=ปี\n';
  const zones = [];
  let cursor = 0;
  for (const [index, row] of rows.entries()) {
    const heading = `## table-1 row ${index}\n`;
    const body = `${headerLines}${row}\n[table-row-end]`;
    const text = heading + body;
    const cells = row.split('\t');
    const bindings = [
      { col: 0, cell: 0, headerRefs: [{ row: 0, cell: 0 }] },
      { col: 1, cell: 1, headerRefs: [{ row: 0, cell: 1 }] },
      { col: 2, cell: 2, headerRefs: [{ row: 1, cell: 0 }] },
      { col: 3, cell: 3, headerRefs: [{ row: 1, cell: 0 }] },
      { col: 4, cell: 4, headerRefs: [{ row: 2, cell: 0 }] },
    ];
    zones.push({
      id: `doc:table-row-${index}`,
      rangeId: 'doc',
      rangeSourceStart: 0,
      sourceStart: cursor,
      sourceEnd: cursor + text.length,
      kind: 'table-row',
      text,
      anchorText: row,
      relationText: body,
      packet: {
        tableId: 'table-1',
        row: index,
        sourceHeadingLabel: `table-1 row ${index}`,
        bindings: bindings.slice(0, cells.length),
      },
    });
    cursor += text.length + (index < rows.length - 1 ? 1 : 0);
  }
  const text = zones.map((zone) => zone.text).join('\n');
  const sourceRange = { id: 'doc', sourceStart: 0, sourceEnd: text.length, text, textSha256: sha256(text) };
  const defaultChunk = { sourceStart: 0, sourceEnd: text.length, inputText: text };
  const selectedChunk = chunkRange
    ? { sourceStart: chunkRange.start, sourceEnd: chunkRange.end, inputText: text.slice(chunkRange.start, chunkRange.end) }
    : defaultChunk;
  const fact = {
    kind: 'table_row',
    subject: 'จังหวัด A',
    predicate: 'has population',
    value: '100',
    description: 'Population for Province A.',
    evidenceQuote: 'fabricated row quote that is not source text',
    predicateCue: 'has population',
    rowQuote: 'fabricated row quote that is not source text',
    headerQuote: 'จำนวนราษฎร',
    tableId: 'model-invented-table-id',
    tableRowLabel: 'model-invented-row-label',
    subjectColumnIndex: 1,
    columnIndex: 4,
    ...candidate,
  };
  const bundle = { sourceRanges: [sourceRange], zones };
  const sourceBundleSha256 = sha256(JSON.stringify(bundle));
  const chunkManifest = [{
    chunkIndex: 0,
    sourceStart: selectedChunk.sourceStart,
    sourceEnd: selectedChunk.sourceEnd,
    textSha256: sha256(selectedChunk.inputText),
  }];
  const freeze = {
    source: { sourceBundleSha256 },
    chunkManifest: [{ sourceId: 'doc', sourceTextSha256: sourceRange.textSha256, chunks: chunkManifest }],
  };
  const freezeSha256 = sha256(JSON.stringify(freeze));
  const receipt = {
    status: 'COMPLETED',
    sourceBundleSha256,
    freezeSha256,
    documents: [{
      sourceId: 'doc',
      sourceTextSha256: sourceRange.textSha256,
      chunks: [{
        ...selectedChunk,
        chunkIndex: 0,
        textSha256: sha256(selectedChunk.inputText),
        facts: [fact],
        relations: [],
      }],
    }],
  };
  return { bundle, freeze, receipt, fact, sourceRange };
}

test('exact subject, value and bound header atoms ground a fact despite model packet metadata and row-quote errors', () => {
  const fixture = tableFixture();
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  const fact = result.validation.facts[0];
  assert.equal(fact.sourceStatus, 'LEXICALLY_GROUNDED_FACT_CANDIDATE');
  assert.equal(fact.semanticStatus, 'NOT_ASSESSED');
  assert.equal(fact.candidateQuoteAudit.rowQuoteUsedAsEvidence, false);
  assert.equal(fact.candidateQuoteAudit.rowQuote.status, 'NOT_EXACT_SOURCE_TEXT');
  assert.equal(fact.candidateQuoteAudit.rowQuote.usedAsEvidence, false);
  assert.equal(fact.candidateMetadataAudit.packetIdsDerivedFromFrozenRow, true);
  assert.equal(fact.candidateMetadataAudit.modelValueColumnIndexMatchesResolved, false);
  assert.deepEqual(result.validation.relations, []);
  assert.deepEqual(result.projection.zoneIds, ['doc:table-row-0']);
  for (const span of [fact.evidence.subject, fact.evidence.value, fact.evidence.header]) {
    assert.equal(fixture.sourceRange.text.slice(span.sourceStart, span.sourceEnd), span.quote);
    const chunk = fixture.receipt.documents[0].chunks[0];
    assert.equal(chunk.inputText.slice(span.chunkTextStart, span.chunkTextEnd), span.quote);
  }
});

test('a subject must match the explicitly selected subject column exactly', () => {
  const fixture = tableFixture({ candidate: { subjectColumnIndex: 0 } });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('exact cell matching does not accept 100 as a substring of 1100', () => {
  const fixture = tableFixture({ rows: ['1\tจังหวัด A\t1100\t200\t2024'] });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('repeated values under one merged header remain ambiguous', () => {
  const fixture = tableFixture({ rows: ['1\tจังหวัด A\t100\t100\t2024'] });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_AMBIGUOUS_ATOMIC_TABLE_BINDING');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('partial or wrong headers do not bind the candidate value', () => {
  for (const headerQuote of ['จำนวน', 'ปี']) {
    const fixture = tableFixture({ candidate: { headerQuote } });
    const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
    assert.equal(result.validation.facts[0].sourceStatus, 'HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING');
    assert.deepEqual(result.projection.zoneIds, []);
  }
});

test('same subject and value repeated in sibling rows remain ambiguous', () => {
  const fixture = tableFixture({ rows: [
    '1\tจังหวัด A\t100\t200\t2024',
    '2\tจังหวัด A\t100\t300\t2025',
  ] });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_AMBIGUOUS_ATOMIC_TABLE_BINDING');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('all exact atoms must be inside the same emitting chunk', () => {
  const full = tableFixture();
  const headerEnd = full.bundle.zones[0].sourceStart + full.bundle.zones[0].text.indexOf('1\tจังหวัด A');
  const fixture = tableFixture({ chunkRange: { start: headerEnd, end: full.sourceRange.text.length } });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_ATOMIC_EVIDENCE_OUTSIDE_EMITTING_CHUNK');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('missing candidate atoms cannot be reconstructed from descriptions or row quotes', () => {
  const fixture = tableFixture({ candidate: { subject: 'missing subject', value: 'missing value', headerQuote: '' } });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING');
  assert.deepEqual(result.projection.zoneIds, []);
});
