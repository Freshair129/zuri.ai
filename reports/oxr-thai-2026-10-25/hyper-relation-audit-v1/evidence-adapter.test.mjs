import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { validateEvidenceRun } from './evidence-adapter.mjs';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function makeFixture({ text, zones, chunks }) {
  const sourceRange = {
    id: 'doc',
    sourceStart: 0,
    sourceEnd: text.length,
    text,
    textSha256: sha256(text),
  };
  const bundle = { sourceRanges: [sourceRange], zones };
  const chunkManifest = chunks.map((chunk, chunkIndex) => ({
    chunkIndex,
    sourceStart: chunk.sourceStart,
    sourceEnd: chunk.sourceEnd,
    textSha256: sha256(chunk.inputText),
  }));
  const freeze = {
    sourceBundleSha256: sha256(JSON.stringify(bundle)),
    chunkManifest: [{ sourceId: 'doc', sourceTextSha256: sourceRange.textSha256, chunks: chunkManifest }],
  };
  const freezeSha256 = sha256(JSON.stringify(freeze));
  const receipt = {
    status: 'COMPLETED',
    sourceBundleSha256: freeze.sourceBundleSha256,
    freezeSha256,
    documents: [{
      sourceId: 'doc',
      sourceTextSha256: sourceRange.textSha256,
      chunks: chunks.map((chunk, chunkIndex) => ({
        ...chunk,
        chunkIndex,
        textSha256: sha256(chunk.inputText),
        facts: chunk.facts || [],
        relations: chunk.relations || [],
      })),
    }],
  };
  return { bundle, freeze, receipt };
}

function proseFixture({ relation, inputText } = {}) {
  const text = 'Alice founded Acme in Bangkok.';
  const zone = {
    id: 'doc:prose-1',
    rangeId: 'doc',
    rangeSourceStart: 0,
    sourceStart: 0,
    sourceEnd: text.length,
    kind: 'source-section',
    text,
    anchorText: text,
    relationText: text,
  };
  return makeFixture({
    text,
    zones: [zone],
    chunks: [{
      sourceStart: 0,
      sourceEnd: (inputText || text).length,
      inputText: inputText || text,
      relations: relation ? [relation] : [],
    }],
  });
}

const proseRelation = {
  participants: ['Alice', 'Acme'],
  predicate: 'founded',
  description: 'Alice founded the company Acme in Bangkok.',
  evidenceQuote: 'Alice founded Acme in Bangkok.',
  relationCue: 'founded',
};

function tableFixture({ candidate, secondRow = false, rowOne = '1\tจังหวัด A\t100\t200\t300\t2024' } = {}) {
  const rowTwo = '2\tจังหวัด B\t200\t300\t400\t2024';
  const headerLines = 'h1 c1=No.\nh1 c2=Province\nh2 c3-5=Population count\nh3 c6=Year\n';
  const makeZone = (row, packetRow) => {
    const heading = `## table-1 row ${packetRow}\n`;
    const content = heading + headerLines + `${row}\n[table-row-end]`;
    return {
      id: `doc:table-row-${packetRow}`,
      rangeId: 'doc',
      rangeSourceStart: 0,
      sourceStart: 0,
      sourceEnd: content.length,
      kind: 'table-row',
      text: content,
      anchorText: row,
      relationText: headerLines + row,
      packet: {
        tableId: 'table-1',
        row: packetRow,
        sourceHeadingLabel: `table-1 row ${packetRow}`,
        bindings: [
          { col: 0, cell: 0, headerRefs: [{ row: 0, cell: 0 }] },
          { col: 1, cell: 1, headerRefs: [{ row: 0, cell: 1 }] },
          { col: 2, cell: 2, headerRefs: [{ row: 1, cell: 0 }] },
          { col: 3, cell: 3, headerRefs: [{ row: 1, cell: 0 }] },
          { col: 4, cell: 4, headerRefs: [{ row: 1, cell: 0 }] },
          { col: 5, cell: 5, headerRefs: [{ row: 2, cell: 0 }] },
        ],
      },
    };
  };
  const zones = secondRow ? [makeZone(rowOne, 0), makeZone(rowTwo, 1)] : [makeZone(rowOne, 0)];
  zones[0].sourceStart = 0;
  zones[0].sourceEnd = zones[0].text.length;
  if (secondRow) {
    zones[1].sourceStart = zones[0].sourceEnd + 1;
    zones[1].sourceEnd = zones[1].sourceStart + zones[1].text.length;
  }
  const fullText = zones.map((zone) => zone.text).join('\n');
  const chunks = [{
    sourceStart: 0,
    sourceEnd: fullText.length,
    inputText: fullText,
    facts: candidate ? [candidate] : [],
  }];
  return makeFixture({ text: fullText, zones, chunks });
}

test('an exact prose quote and relation cue ground a candidate without asserting entailment', () => {
  const fixture = proseFixture({ relation: proseRelation });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  const relation = result.validation.relations[0];
  assert.equal(relation.sourceStatus, 'LEXICALLY_GROUNDED_CANDIDATE');
  assert.equal(relation.semanticStatus, 'NOT_ASSESSED');
  assert.equal(relation.evidence[0].quote, proseRelation.evidenceQuote);
  assert.deepEqual(relation.evidence[0].participants.map(({ name, quote }) => ({ name, quote })), [
    { name: 'Alice', quote: 'Alice' },
    { name: 'Acme', quote: 'Acme' },
  ]);
  assert.deepEqual(result.projection.zoneIds, ['doc:prose-1']);
  assert.equal(result.projection.content, 'Alice founded Acme in Bangkok.');
});

test('a model paraphrase without a verbatim evidence quote is held', () => {
  const fixture = proseFixture({ relation: {
    ...proseRelation,
    evidenceQuote: '',
    relationCue: '',
  } });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.relations[0].sourceStatus, 'HELD_NO_EVIDENCE_QUOTE');
  assert.equal(result.validation.relations[0].semanticStatus, 'NOT_ASSESSED');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('a cue absent from an otherwise exact quote is held', () => {
  const fixture = proseFixture({ relation: { ...proseRelation, relationCue: 'supports' } });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.relations[0].sourceStatus, 'HELD_NO_EXACT_CUE_QUOTE');
});

test('relations with fewer than two distinct participants are held as malformed relations', () => {
  const fixture = proseFixture({ relation: { ...proseRelation, participants: ['Alice'] } });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.relations[0].sourceStatus, 'HELD_RELATION_CARDINALITY');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('duplicate participant strings do not satisfy relation cardinality', () => {
  const fixture = proseFixture({ relation: { ...proseRelation, participants: ['Alice', 'Alice'] } });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.relations[0].sourceStatus, 'HELD_RELATION_CARDINALITY');
});

test('an exact quote spanning adjacent zones cannot ground a relation', () => {
  const first = 'Alice founded Acme.';
  const second = 'Bob works nearby.';
  const fullText = `${first}\n${second}`;
  const relation = {
    participants: ['Alice', 'Bob'],
    predicate: 'founded',
    description: 'Alice founded the business with Bob.',
    evidenceQuote: `${first}\n${second}`,
    relationCue: 'founded',
  };
  const zones = [
    {
      id: 'doc:prose-1', rangeId: 'doc', rangeSourceStart: 0, sourceStart: 0,
      sourceEnd: first.length, kind: 'source-section', text: first,
      anchorText: first, relationText: first,
    },
    {
      id: 'doc:prose-2', rangeId: 'doc', rangeSourceStart: 0, sourceStart: first.length + 1,
      sourceEnd: fullText.length, kind: 'source-section', text: second,
      anchorText: second, relationText: second,
    },
  ];
  const fixture = makeFixture({
    text: fullText,
    zones,
    chunks: [{ sourceStart: 0, sourceEnd: fullText.length, inputText: fullText, relations: [relation] }],
  });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.relations[0].sourceStatus, 'HELD_EVIDENCE_CROSSES_ZONES');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('a quote outside the exact emitting chunk cannot ground a relation', () => {
  const full = 'Alice founded Acme in Bangkok.';
  const splitAt = full.indexOf('in Bangkok');
  const fixture = proseFixture({
    relation: proseRelation,
    inputText: full.slice(0, splitAt),
  });
  fixture.receipt.documents[0].chunks.push({
    chunkIndex: 1,
    sourceStart: splitAt,
    sourceEnd: full.length,
    inputText: full.slice(splitAt),
    textSha256: sha256(full.slice(splitAt)),
    facts: [],
    relations: [],
  });
  fixture.freeze.chunkManifest[0].chunks.push({
    chunkIndex: 1,
    sourceStart: splitAt,
    sourceEnd: full.length,
    textSha256: sha256(full.slice(splitAt)),
  });
  fixture.receipt.freezeSha256 = sha256(JSON.stringify(fixture.freeze));
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.relations[0].sourceStatus, 'HELD_EVIDENCE_OUTSIDE_CHUNK');
});

test('a table fact requires a same-row value and a header bound to that column', () => {
  const candidate = {
    kind: 'table_row',
    subject: 'จังหวัด A',
    predicate: 'population',
    value: '100',
    description: 'Province A population count',
    tableId: 'table-1',
    tableRowLabel: 'table-1 row 0',
    subjectColumnIndex: 1,
    rowQuote: '1\tจังหวัด A\t100\t200\t300\t2024',
    headerQuote: 'Population count',
    columnIndex: 2,
  };
  const fixture = tableFixture({ candidate });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  const fact = result.validation.facts[0];
  assert.equal(fact.sourceStatus, 'LEXICALLY_GROUNDED_FACT_CANDIDATE');
  assert.equal(fact.semanticStatus, 'NOT_ASSESSED');
  assert.equal(fact.evidence.header.quote, 'Population count');
  assert.equal(fact.evidence.row.quote, candidate.rowQuote);
  assert.equal(result.validation.relations.length, 0);
});

test('header-only evidence cannot ground a missing or wrong-row value', () => {
  const candidate = {
    kind: 'table_row',
    subject: 'จังหวัด A',
    predicate: 'population',
    value: '999',
    description: 'Province A population count',
    tableId: 'table-1',
    tableRowLabel: 'table-1 row 0',
    subjectColumnIndex: 1,
    rowQuote: '1\tจังหวัด A\t100\t200\t300\t2024',
    headerQuote: 'Population count',
    columnIndex: 2,
  };
  const fixture = tableFixture({ candidate });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_TABLE_VALUE_NOT_BOUND');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('a value appearing only in a sibling row cannot support this table fact', () => {
  const candidate = {
    kind: 'table_row',
    subject: 'จังหวัด A',
    predicate: 'population',
    value: '200',
    description: 'Province A population count',
    tableId: 'table-1',
    tableRowLabel: 'table-1 row 0',
    subjectColumnIndex: 1,
    rowQuote: '1\tจังหวัด A\t100\t200\t300\t2024',
    headerQuote: 'Population count',
    columnIndex: 2,
  };
  const fixture = tableFixture({ candidate, secondRow: true });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_TABLE_VALUE_NOT_BOUND');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('a header from another column cannot support the selected table value', () => {
  const candidate = {
    kind: 'table_row',
    subject: 'จังหวัด A',
    predicate: 'population',
    value: '2024',
    description: 'Province A population count',
    tableId: 'table-1',
    tableRowLabel: 'table-1 row 0',
    subjectColumnIndex: 1,
    rowQuote: '1\tจังหวัด A\t100\t200\t300\t2024',
    headerQuote: 'Population count',
    columnIndex: 5,
  };
  const fixture = tableFixture({ candidate });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_TABLE_HEADER_NOT_BOUND');
  assert.deepEqual(result.projection.zoneIds, []);
});

test('a shortened subject string cannot match only part of its table cell', () => {
  const candidate = {
    kind: 'table_row',
    subject: 'จังหวัด',
    predicate: 'population',
    value: '100',
    description: 'Province A population count',
    tableId: 'table-1',
    tableRowLabel: 'table-1 row 0',
    subjectColumnIndex: 1,
    rowQuote: '1\tจังหวัด A\t100\t200\t300\t2024',
    headerQuote: 'Population count',
    columnIndex: 2,
  };
  const fixture = tableFixture({ candidate });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_TABLE_SUBJECT_NOT_BOUND');
});

test('a numeric substring cannot match a different full value cell', () => {
  const row = '1\tจังหวัด A\t1100\t200\t300\t2024';
  const candidate = {
    kind: 'table_row',
    subject: 'จังหวัด A',
    predicate: 'population',
    value: '100',
    description: 'Province A population count',
    tableId: 'table-1',
    tableRowLabel: 'table-1 row 0',
    subjectColumnIndex: 1,
    rowQuote: row,
    headerQuote: 'Population count',
    columnIndex: 2,
  };
  const fixture = tableFixture({ candidate, rowOne: row });
  const result = validateEvidenceRun(fixture.bundle, fixture.freeze, fixture.receipt);
  assert.equal(result.validation.facts[0].sourceStatus, 'HELD_TABLE_VALUE_NOT_BOUND');
});

