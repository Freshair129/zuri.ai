import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, validateAndProject } from './adapter.mjs';

function fixture() {
  const sourceText = '## row-1\nAlice works for Acme Ltd.\n\n## row-2\nBeacon Ltd. sells widgets.\n';
  const firstStart = 0;
  const firstEnd = sourceText.indexOf('\n\n## row-2') + 1;
  const secondStart = sourceText.indexOf('## row-2');
  const zones = [
    {
      id: 'doc:row-1', kind: 'table-row', rangeId: 'doc', rangeSourceStart: 0,
      sourceStart: firstStart, sourceEnd: firstEnd,
      text: sourceText.slice(firstStart, firstEnd),
      anchorText: 'Alice works for Acme Ltd.',
      relationText: 'Alice works for Acme Ltd.',
      packet: { tableId: 't', row: 1 },
    },
    {
      id: 'doc:row-2', kind: 'table-row', rangeId: 'doc', rangeSourceStart: 0,
      sourceStart: secondStart, sourceEnd: sourceText.length,
      text: sourceText.slice(secondStart),
      anchorText: 'Beacon Ltd. sells widgets.',
      relationText: 'Beacon Ltd. sells widgets.',
      packet: { tableId: 't', row: 2 },
    },
  ];
  const bundle = {
    schema: 'zuri.hyper-extract-source-bundle.v1',
    sourceRanges: [{ id: 'doc', sourceStart: 0, sourceEnd: sourceText.length, text: sourceText, textSha256: sha256(sourceText) }],
    zones,
    sourceChars: sourceText.length,
    zoneCount: zones.length,
  };
  const freeze = {
    sourceBundleSha256: sha256(JSON.stringify(bundle)),
    package: { version: '0.10.5', installation: { sourceCommit: 'commit', sourceTreeSha256: 'tree' } },
    inference: {
      modelTag: 'qwen3.5:9b', modelDigest: 'digest', chunkSizeChars: 2048, chunkOverlapChars: 256,
      maxWorkers: 1, maxOutputTokens: 512, requestMaxTokensField: 512,
      structuredOutputMethod: 'json_schema', expectedContextLength: 4096, reasoningEffortRequest: 'none',
    },
    validationPolicy: {},
    projectionPolicy: {},
  };
  const makeChunk = (chunkIndex, start, end, nodes, edges) => ({
    chunkIndex,
    sourceStart: start,
    sourceEnd: end,
    sourceRelativeStart: start,
    sourceRelativeEnd: end,
    inputText: sourceText.slice(start, end),
    textChars: end - start,
    textSha256: sha256(sourceText.slice(start, end)),
    nodes,
    edges,
    extractionFailures: [],
    feedError: null,
  });
  const candidates = {
    status: 'COMPLETED',
    sourceBundleSha256: freeze.sourceBundleSha256,
    hyperExtractVersion: '0.10.5',
    hyperExtractInstallation: { editable: true, sourceCommit: 'commit', sourceTreeSha256: 'tree' },
    model: { tag: 'qwen3.5:9b', digest: 'digest', contextLengthObserved: 4096 },
    settings: {
      chunkSizeChars: 2048,
      chunkOverlapChars: 256,
      maxWorkers: 1,
      maxOutputTokens: 512,
      structuredOutputMethod: 'json_schema',
      legacyMaxTokensFieldSent: 512,
      expectedContextLength: 4096,
      plannedChunks: 1,
      plannedBaseStructuredCalls: 2,
      actualStructuredCallStarts: 2,
      actualStructuredCallResponses: 2,
      actualStructuredCallErrors: 0,
      actualStructuredCallRequestBodies: 2,
      requestConfigurationsMatchFreeze: true,
    },
    requestBodies: Array.from({ length: 2 }, () => ({
      path: '/v1/chat/completions', model: 'qwen3.5:9b', maxTokens: 512,
      maxCompletionTokens: 512, reasoningEffort: 'none', responseFormatType: 'json_schema',
    })),
    documents: [{
      sourceId: 'doc', sourceTextSha256: sha256(sourceText),
      chunks: [makeChunk(0, 0, sourceText.length,
        [
          { name: 'Alice', type: 'person', description: 'Founder of Acme' },
          { name: 'Acme Ltd.', type: 'organization', description: 'A company' },
          { name: 'Atlantis', type: 'geo', description: 'An island' },
        ],
        [
          { participants: ['Alice', 'Acme Ltd.'], description: 'Alice works for Acme Ltd.', keywords: [], strength: 8 },
          { participants: ['Alice', 'Beacon Ltd.'], description: 'Alice works for Beacon Ltd.', keywords: [], strength: 8 },
          { participants: ['Alice', 'Acme Ltd.'], description: 'Alice founded Acme Ltd.', keywords: [], strength: 9 },
        ])],
    }],
  };
  return { bundle, freeze, candidates, sourceText, makeChunk };
}

test('candidate nodes require exact mention anchors and descriptions remain unvalidated', () => {
  const { bundle, freeze, candidates } = fixture();
  const result = validateAndProject(bundle, freeze, candidates);
  assert.deepEqual(result.validation.nodes.map((item) => item.mentionStatus), [
    'MENTION_ANCHORED_ONLY', 'MENTION_ANCHORED_ONLY', 'REJECTED_UNGROUNDED_NAME',
  ]);
  assert.equal(result.validation.nodes[0].descriptionDisposition, 'UNVALIDATED_CANDIDATE_CLAIM_NOT_PROJECTED');
  assert.equal(result.projection.text.includes('Founder of Acme'), false);
  assert.equal(result.projection.text.includes('An island'), false);
});

test('relations require exact description quote and all participants in one source zone', () => {
  const { bundle, freeze, candidates } = fixture();
  const result = validateAndProject(bundle, freeze, candidates);
  assert.deepEqual(result.validation.edges.map((item) => item.sourceStatus), [
    'SOURCE_QUOTE_GROUNDED_CANDIDATE_ONLY',
    'HELD_PARTICIPANTS_NOT_IN_SAME_ZONE',
    'HELD_NO_EXACT_RELATION_QUOTE',
  ]);
  const accepted = result.validation.edges[0].exactSameZoneEvidence[0];
  assert.equal(accepted.relationEvidence.quote, 'Alice works for Acme Ltd.');
  assert.equal(accepted.relationEvidence.sourceStart, bundle.zones[0].sourceStart + bundle.zones[0].text.indexOf('Alice works'));
});

test('projection contains only exact source zones and never model-generated graph text', () => {
  const { bundle, freeze, candidates, sourceText } = fixture();
  const result = validateAndProject(bundle, freeze, candidates);
  assert.equal(result.projection.text, sourceText.slice(bundle.zones[0].sourceStart, bundle.zones[0].sourceEnd));
  assert.equal(result.projection.generatedCandidateTextIncluded, false);
  assert.equal(result.projection.textSha256, sha256(result.projection.text));
  assert.ok(result.projection.snippets.every((snippet) =>
    sourceText.slice(snippet.sourceStart, snippet.sourceEnd) === snippet.text));
});

test('source bundle hash and source text hash mismatches fail closed', () => {
  const { bundle, freeze, candidates } = fixture();
  assert.throws(() => validateAndProject(bundle, { ...freeze, sourceBundleSha256: 'bad' }, candidates), /frozen protocol hash/);
  assert.throws(() => validateAndProject(bundle, freeze, {
    ...candidates,
    documents: [{ ...candidates.documents[0], sourceTextSha256: 'bad' }],
  }), /Source document hash mismatch/);
});

test('installed Hyper-Extract source commit and tree hash must match the run freeze', () => {
  const { bundle, freeze, candidates } = fixture();
  assert.throws(() => validateAndProject(bundle, freeze, {
    ...candidates,
    hyperExtractInstallation: { ...candidates.hyperExtractInstallation, sourceTreeSha256: 'changed' },
  }), /source commit\/tree hash/);
});

test('actual request cap and schema method must match the run freeze', () => {
  const { bundle, freeze, candidates } = fixture();
  assert.throws(() => validateAndProject(bundle, freeze, {
    ...candidates,
    requestBodies: [{ ...candidates.requestBodies[0], maxTokens: 1024 }, candidates.requestBodies[1]],
  }), /outbound LLM request bodies/);
});

test('candidate receipt must uniquely cover every frozen source document', () => {
  const { bundle, freeze, candidates } = fixture();
  const secondText = '## row-3\nDelta Ltd. operates.\n';
  const secondRange = { id: 'doc-2', text: secondText, textSha256: sha256(secondText) };
  const twoDocBundle = { ...bundle, sourceRanges: [...bundle.sourceRanges, secondRange] };
  const twoDocFreeze = { ...freeze, sourceBundleSha256: sha256(JSON.stringify(twoDocBundle)) };
  const firstDoc = candidates.documents[0];
  const badDuplicate = { ...firstDoc, sourceId: 'doc' };
  assert.throws(() => validateAndProject(twoDocBundle, twoDocFreeze, {
    ...candidates,
    sourceBundleSha256: twoDocFreeze.sourceBundleSha256,
    documents: [firstDoc, badDuplicate],
  }), /duplicate source IDs/);
});

test('candidate mentions outside the exact emitting chunk cannot ground or select another zone', () => {
  const { bundle, freeze, candidates, sourceText, makeChunk } = fixture();
  const secondStart = sourceText.indexOf('## row-2');
  const crossChunkCandidates = {
    ...candidates,
    settings: {
      ...candidates.settings,
      plannedChunks: 2,
      plannedBaseStructuredCalls: 4,
      actualStructuredCallStarts: 4,
      actualStructuredCallResponses: 4,
      actualStructuredCallRequestBodies: 4,
    },
    requestBodies: Array.from({ length: 4 }, () => ({
      path: '/v1/chat/completions', model: 'qwen3.5:9b', maxTokens: 512,
      maxCompletionTokens: 512, reasoningEffort: 'none', responseFormatType: 'json_schema',
    })),
    documents: [{
      sourceId: 'doc',
      sourceTextSha256: sha256(sourceText),
      chunks: [
        makeChunk(0, 0, secondStart,
          [{ name: 'Beacon Ltd.', type: 'organization', description: 'Sells widgets.' }],
          [{ participants: ['Beacon Ltd.', 'widgets'], description: 'Beacon Ltd. sells widgets.', keywords: [], strength: 6 }]),
        makeChunk(1, secondStart, sourceText.length, [], []),
      ],
    }],
  };
  const result = validateAndProject(bundle, freeze, crossChunkCandidates);
  assert.equal(result.validation.nodes[0].mentionStatus, 'REJECTED_UNGROUNDED_NAME');
  assert.deepEqual(result.validation.nodes[0].mentionEvidence, []);
  assert.equal(result.validation.edges[0].sourceStatus, 'REJECTED_UNGROUNDED_PARTICIPANTS');
  assert.deepEqual(result.validation.edges[0].exactSameZoneEvidence, []);
  assert.equal(result.projection.selectedZones, 0);
  assert.equal(result.projection.text, '');
});
