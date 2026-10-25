import crypto from 'node:crypto';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function occurrences(text, needle) {
  if (typeof needle !== 'string' || needle.length === 0) return [];
  const positions = [];
  let from = 0;
  while (from <= text.length - needle.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    positions.push(index);
    from = index + 1;
  }
  return positions;
}

function zoneMatches(zone, sourceText, needle, anchorField, chunk) {
  const anchor = zone[anchorField];
  if (!anchor || typeof needle !== 'string' || needle.length === 0) return [];
  const anchorStart = zone.text.indexOf(anchor);
  if (anchorStart < 0) throw new Error(`Evidence anchor is not contained in zone ${zone.id}`);
  return occurrences(anchor, needle).map((offset) => {
    const start = zone.sourceStart + anchorStart + offset;
    const end = start + needle.length;
    if (start < chunk.sourceStart || end > chunk.sourceEnd) return null;
    const sourceQuote = sourceText.slice(start - zone.rangeSourceStart, end - zone.rangeSourceStart);
    if (sourceQuote !== needle) throw new Error(`Evidence does not match source at ${zone.id}`);
    const chunkOffset = start - chunk.sourceStart;
    if (chunk.inputText.slice(chunkOffset, chunkOffset + needle.length) !== needle) {
      throw new Error(`Candidate evidence is outside its model-input chunk at ${zone.id}`);
    }
    return {
      zoneId: zone.id,
      sourceStart: start,
      sourceEnd: end,
      quote: sourceQuote,
      quoteSha256: sha256(sourceQuote),
      chunkIndex: chunk.chunkIndex,
      chunkTextStart: chunkOffset,
      chunkTextEnd: chunkOffset + needle.length,
    };
  }).filter(Boolean);
}

function relationEvidence(zone, sourceText, description, chunk) {
  if (typeof description !== 'string' || description.length < 3) return null;
  // Table headers are preserved in the projection as context, but only the
  // original row body can support an extracted relation.
  const relationText = zone.kind === 'table-row' ? zone.anchorText : zone.relationText;
  const relationStartInZone = zone.text.indexOf(relationText);
  if (relationStartInZone < 0) throw new Error(`Relation evidence region is not contained in zone ${zone.id}`);
  const inRelation = occurrences(relationText, description)[0];
  if (inRelation === undefined) return null;
  const zoneOffset = relationStartInZone + inRelation;
  const start = zone.sourceStart + zoneOffset;
  const end = start + description.length;
  if (start < chunk.sourceStart || end > chunk.sourceEnd) return null;
  const quote = sourceText.slice(start - zone.rangeSourceStart, end - zone.rangeSourceStart);
  if (quote !== description) throw new Error(`Relation quote does not match source at ${zone.id}`);
  const chunkOffset = start - chunk.sourceStart;
  if (chunk.inputText.slice(chunkOffset, chunkOffset + description.length) !== description) {
    throw new Error(`Relation quote is outside its model-input chunk at ${zone.id}`);
  }
  return {
    zoneId: zone.id,
    sourceStart: start,
    sourceEnd: end,
    quote,
    quoteSha256: sha256(quote),
    chunkIndex: chunk.chunkIndex,
    chunkTextStart: chunkOffset,
    chunkTextEnd: chunkOffset + description.length,
  };
}

function describeNode(bundle, document, item, candidateId, chunk) {
  const sourceId = document.id;
  const matches = bundle.zones
    .filter((zone) => zone.rangeId === sourceId)
    .flatMap((zone) => zoneMatches(zone, document.text, item.name, 'anchorText', chunk));
  const descriptionQuotes = bundle.zones
    .filter((zone) => zone.rangeId === sourceId)
    .flatMap((zone) => zoneMatches(zone, document.text, item.description || '', 'anchorText', chunk));
  return {
    candidateId,
    sourceId,
    chunkIndex: item.chunkIndex,
    name: item.name,
    type: item.type,
    typeDisposition: 'UNVALIDATED_CANDIDATE_TYPE',
    candidateDescription: item.description,
    mentionStatus: matches.length ? 'MENTION_ANCHORED_ONLY' : 'REJECTED_UNGROUNDED_NAME',
    mentionEvidence: matches,
    descriptionEvidence: descriptionQuotes,
    descriptionDisposition: 'UNVALIDATED_CANDIDATE_CLAIM_NOT_PROJECTED',
  };
}

function describeEdge(bundle, document, item, candidateId, chunk) {
  const sourceId = document.id;
  const zones = bundle.zones.filter((zone) => zone.rangeId === sourceId);
  const participantNames = Array.isArray(item.participants) ? item.participants : [];
  const perZone = zones.map((zone) => {
    const participantEvidence = participantNames.map((name) => ({
      name,
      matches: zoneMatches(zone, document.text, name, 'anchorText', chunk),
    }));
    const relation = relationEvidence(zone, document.text, item.description, chunk);
    return { zoneId: zone.id, participantEvidence, relationEvidence: relation };
  });
  const grounded = perZone.filter((zone) =>
    participantNames.length >= 2
    && zone.participantEvidence.every((participant) => participant.matches.length > 0)
    && Boolean(zone.relationEvidence),
  );
  const anyParticipants = perZone.some((zone) => zone.participantEvidence.some((p) => p.matches.length > 0));
  const colocatedParticipants = perZone.some((zone) =>
    participantNames.length >= 2 && zone.participantEvidence.every((participant) => participant.matches.length > 0),
  );
  let sourceStatus;
  if (grounded.length) sourceStatus = 'SOURCE_QUOTE_GROUNDED_CANDIDATE_ONLY';
  else if (!anyParticipants) sourceStatus = 'REJECTED_UNGROUNDED_PARTICIPANTS';
  else if (!colocatedParticipants) sourceStatus = 'HELD_PARTICIPANTS_NOT_IN_SAME_ZONE';
  else sourceStatus = 'HELD_NO_EXACT_RELATION_QUOTE';
  return {
    candidateId,
    sourceId,
    chunkIndex: item.chunkIndex,
    participants: participantNames,
    candidateDescription: item.description,
    candidateKeywords: item.keywords,
    candidateStrength: item.strength,
    sourceStatus,
    exactSameZoneEvidence: grounded.map((zone) => ({
      zoneId: zone.zoneId,
      participantEvidence: zone.participantEvidence.map(({ name, matches }) => ({ name, matches })),
      relationEvidence: zone.relationEvidence,
    })),
    policy: 'description must be a complete literal source substring and every participant must have a literal mention in that same source zone',
  };
}

export function validateAndProject(bundle, freeze, candidates) {
  const actualBundleHash = sha256(JSON.stringify(bundle));
  if (actualBundleHash !== freeze.sourceBundleSha256) throw new Error('Source bundle does not match frozen protocol hash');
  if (candidates.sourceBundleSha256 !== freeze.sourceBundleSha256) throw new Error('Candidate run source hash mismatch');
  if (candidates.status !== 'COMPLETED') throw new Error(`Candidate run is not complete: ${candidates.status}`);
  if (candidates.hyperExtractVersion !== freeze.package.version) throw new Error('Hyper-Extract package version does not match freeze');
  const expectedInstallation = freeze.package.installation;
  const actualInstallation = candidates.hyperExtractInstallation;
  if (!expectedInstallation || !actualInstallation?.editable
    || actualInstallation.sourceCommit !== expectedInstallation.sourceCommit
    || actualInstallation.sourceTreeSha256 !== expectedInstallation.sourceTreeSha256) {
    throw new Error('Hyper-Extract installed source commit/tree hash does not match freeze');
  }
  if (candidates.model?.tag !== freeze.inference.modelTag || candidates.model?.digest !== freeze.inference.modelDigest) {
    throw new Error('Candidate run model tag/digest does not match freeze');
  }
  if (candidates.model?.contextLengthObserved !== freeze.inference.expectedContextLength) {
    throw new Error('Observed Ollama context length does not match freeze');
  }
  if (candidates.settings?.chunkSizeChars !== freeze.inference.chunkSizeChars
    || candidates.settings?.chunkOverlapChars !== freeze.inference.chunkOverlapChars
    || candidates.settings?.maxWorkers !== freeze.inference.maxWorkers
    || candidates.settings?.maxOutputTokens !== freeze.inference.maxOutputTokens
    || candidates.settings?.structuredOutputMethod !== freeze.inference.structuredOutputMethod
    || candidates.settings?.legacyMaxTokensFieldSent !== freeze.inference.requestMaxTokensField
    || candidates.settings?.expectedContextLength !== freeze.inference.expectedContextLength) {
    throw new Error('Candidate run extraction settings do not match freeze');
  }
  if (candidates.settings.actualStructuredCallResponses !== candidates.settings.actualStructuredCallStarts
    || candidates.settings.actualStructuredCallErrors !== 0
    || candidates.settings.actualStructuredCallStarts < candidates.settings.plannedBaseStructuredCalls
    || candidates.settings.plannedBaseStructuredCalls !== candidates.settings.plannedChunks * 2) {
    throw new Error('Candidate run has incomplete structured-call responses');
  }
  const requestBodies = candidates.requestBodies;
  if (!Array.isArray(requestBodies)
    || requestBodies.length !== candidates.settings.actualStructuredCallStarts
    || candidates.settings.actualStructuredCallRequestBodies !== requestBodies.length
    || candidates.settings.requestConfigurationsMatchFreeze !== true
    || requestBodies.some((request) => request.path !== '/v1/chat/completions'
      || request.model !== freeze.inference.modelTag
      || request.maxTokens !== freeze.inference.requestMaxTokensField
      || request.maxCompletionTokens !== freeze.inference.maxOutputTokens
      || request.reasoningEffort !== freeze.inference.reasoningEffortRequest
      || request.responseFormatType !== freeze.inference.structuredOutputMethod)) {
    throw new Error('Observed outbound LLM request bodies do not match freeze');
  }
  if (!Array.isArray(candidates.documents) || candidates.documents.length !== bundle.sourceRanges.length) {
    throw new Error('Candidate document set does not match frozen source ranges');
  }
  const docsById = new Map(bundle.sourceRanges.map((range) => [range.id, range]));
  const actualSourceIds = candidates.documents.map((document) => document.sourceId);
  if (new Set(actualSourceIds).size !== actualSourceIds.length) throw new Error('Candidate receipt contains duplicate source IDs');
  const expectedSourceIds = [...docsById.keys()].sort();
  if ([...actualSourceIds].sort().join('\n') !== expectedSourceIds.join('\n')) {
    throw new Error('Candidate receipt source IDs do not exactly cover frozen source ranges');
  }
  const nodeValidation = [];
  const edgeValidation = [];
  const selected = new Set();
  let nodeIndex = 0;
  let edgeIndex = 0;
  let receiptChunkCount = 0;
  for (const document of candidates.documents) {
    const source = docsById.get(document.sourceId);
    if (!source || document.sourceTextSha256 !== source.textSha256) throw new Error(`Source document hash mismatch: ${document.sourceId}`);
    if (!Array.isArray(document.chunks)) throw new Error(`Candidate receipt has no chunk list: ${document.sourceId}`);
    const indices = document.chunks.map((chunk) => chunk.chunkIndex).sort((a, b) => a - b);
    if (indices.some((index, position) => index !== position)) throw new Error(`Candidate chunk indices are incomplete: ${document.sourceId}`);
    receiptChunkCount += document.chunks.length;
    for (const chunk of document.chunks) {
      const relativeStart = chunk.sourceRelativeStart;
      const relativeEnd = chunk.sourceRelativeEnd;
      if (!Number.isInteger(chunk.chunkIndex) || !Number.isInteger(relativeStart) || !Number.isInteger(relativeEnd)
        || relativeStart < 0 || relativeEnd <= relativeStart || relativeEnd > source.text.length
        || chunk.sourceStart !== source.sourceStart + relativeStart
        || chunk.sourceEnd !== source.sourceStart + relativeEnd
        || typeof chunk.inputText !== 'string'
        || chunk.inputText.length !== relativeEnd - relativeStart
        || source.text.slice(relativeStart, relativeEnd) !== chunk.inputText
        || sha256(chunk.inputText) !== chunk.textSha256) {
        throw new Error(`Candidate chunk source-span/hash mismatch: ${document.sourceId}/${chunk.chunkIndex}`);
      }
      if (!Array.isArray(chunk.nodes) || !Array.isArray(chunk.edges)
        || !Array.isArray(chunk.extractionFailures) || chunk.extractionFailures.length > 0 || chunk.feedError) {
        throw new Error(`Candidate chunk is incomplete or failed: ${document.sourceId}/${chunk.chunkIndex}`);
      }
      for (const item of chunk.nodes) {
        const candidate = { ...item, chunkIndex: chunk.chunkIndex };
        const validated = describeNode(bundle, source, candidate, `N${String(++nodeIndex).padStart(4, '0')}`, chunk);
        nodeValidation.push(validated);
        for (const evidence of validated.mentionEvidence) selected.add(evidence.zoneId);
      }
      for (const item of chunk.edges) {
        const candidate = { ...item, chunkIndex: chunk.chunkIndex };
        const validated = describeEdge(bundle, source, candidate, `E${String(++edgeIndex).padStart(4, '0')}`, chunk);
        edgeValidation.push(validated);
        for (const evidence of validated.exactSameZoneEvidence) selected.add(evidence.zoneId);
      }
    }
  }
  if (receiptChunkCount !== candidates.settings.plannedChunks) throw new Error('Candidate receipt does not cover every planned chunk');
  const selectedZones = bundle.zones.filter((zone) => selected.has(zone.id));
  const snippets = selectedZones.map((zone) => ({
    zoneId: zone.id,
    sourceId: zone.rangeId,
    sourceStart: zone.sourceStart,
    sourceEnd: zone.sourceEnd,
    sourceTextSha256: sha256(zone.text),
    text: zone.text,
  }));
  const projectionText = snippets.map((snippet) => snippet.text).join('\n\n');
  return {
    validation: {
      schema: 'zuri.hyper-extract-evidence-validation.v1',
      adapterVersion: 'exact-chunk-same-zone-v2',
      sourceBundleSha256: freeze.sourceBundleSha256,
      policy: {
        nodes: 'literal node name must occur in the exact chunk text and body anchor of the same source zone; type and description remain candidate-only',
        edges: 'all participant names and the complete description quote must occur in the exact emitting chunk and same source zone; table relation evidence is row body only, not header context',
      },
      graphAdmission: 'NONE; all Hyper-Extract candidates remain sidecar data and are never serialized into native GKS facts',
      summary: {
        nodeCandidates: nodeValidation.length,
        mentionAnchoredNodes: nodeValidation.filter((item) => item.mentionStatus === 'MENTION_ANCHORED_ONLY').length,
        ungroundedNodeNames: nodeValidation.filter((item) => item.mentionStatus === 'REJECTED_UNGROUNDED_NAME').length,
        nodeDescriptionsWithLiteralQuote: nodeValidation.filter((item) => item.descriptionEvidence.length > 0).length,
        edgeCandidates: edgeValidation.length,
        exactSameZoneRelationCandidates: edgeValidation.filter((item) => item.sourceStatus === 'SOURCE_QUOTE_GROUNDED_CANDIDATE_ONLY').length,
        heldOrRejectedEdges: edgeValidation.filter((item) => item.sourceStatus !== 'SOURCE_QUOTE_GROUNDED_CANDIDATE_ONLY').length,
        projectedZones: snippets.length,
      },
      nodes: nodeValidation,
      edges: edgeValidation,
    },
    projection: {
      schema: 'zuri.hyper-extract-source-text-projection.v1',
      sourceBundleSha256: freeze.sourceBundleSha256,
      policy: freeze.projectionPolicy,
      graphFieldsIncluded: false,
      generatedCandidateTextIncluded: false,
      joinDelimiter: '\n\n',
      snippets,
      text: projectionText,
      textSha256: sha256(projectionText),
      chars: projectionText.length,
      totalSourceChars: bundle.sourceChars,
      selectedSourceChars: snippets.reduce((sum, snippet) => sum + snippet.text.length, 0),
      omittedSourceChars: bundle.sourceChars - snippets.reduce((sum, snippet) => sum + snippet.text.length, 0),
      totalZones: bundle.zoneCount,
      selectedZones: snippets.length,
      omittedZones: bundle.zoneCount - snippets.length,
      zoneCoveragePercent: bundle.zoneCount ? Number((snippets.length / bundle.zoneCount * 100).toFixed(2)) : 0,
      sourceCharCoveragePercent: bundle.sourceChars ? Number((snippets.reduce((sum, snippet) => sum + snippet.text.length, 0) / bundle.sourceChars * 100).toFixed(2)) : 0,
    },
  };
}

export { sha256 };
