import crypto from 'node:crypto';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function occurrences(text, needle) {
  if (typeof text !== 'string' || typeof needle !== 'string' || needle.length === 0) return [];
  const found = [];
  let from = 0;
  while (from <= text.length - needle.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    found.push(index);
    from = index + 1;
  }
  return found;
}

function exactRegionSpans(source, zone, chunk, regionText, quote) {
  if (typeof quote !== 'string' || !quote || typeof regionText !== 'string' || !regionText) return [];
  const regionInZone = zone.text.indexOf(regionText);
  if (regionInZone < 0) return [];
  const spans = [];
  for (const offset of occurrences(regionText, quote)) {
    const sourceStart = zone.sourceStart + regionInZone + offset;
    const sourceEnd = sourceStart + quote.length;
    const sourceOffset = sourceStart - source.sourceStart;
    if (sourceStart < zone.sourceStart || sourceEnd > zone.sourceEnd) continue;
    if (sourceOffset < 0 || source.text.slice(sourceOffset, sourceOffset + quote.length) !== quote) continue;
    const chunkTextStart = sourceStart - chunk.sourceStart;
    if (chunkTextStart < 0 || sourceStart + quote.length > chunk.sourceEnd) continue;
    if (chunk.inputText.slice(chunkTextStart, chunkTextStart + quote.length) !== quote) continue;
    spans.push({
      zoneId: zone.id,
      sourceStart,
      sourceEnd,
      quote,
      quoteSha256: sha256(quote),
      chunkIndex: chunk.chunkIndex,
      chunkTextStart,
      chunkTextEnd: chunkTextStart + quote.length,
    });
  }
  return spans;
}

function sourceContainsQuote(source, zone, regionText, quote) {
  if (!quote || !regionText) return false;
  const regionInZone = zone.text.indexOf(regionText);
  if (regionInZone < 0) return false;
  return occurrences(regionText, quote).some((offset) => {
    const sourceOffset = zone.sourceStart + regionInZone + offset - source.sourceStart;
    return source.text.slice(sourceOffset, sourceOffset + quote.length) === quote;
  });
}

function spanWithinQuote(quoteSpan, quote, needle) {
  const relativeStart = quote.indexOf(needle);
  if (relativeStart < 0) return null;
  return {
    zoneId: quoteSpan.zoneId,
    sourceStart: quoteSpan.sourceStart + relativeStart,
    sourceEnd: quoteSpan.sourceStart + relativeStart + needle.length,
    quote: needle,
    quoteSha256: sha256(needle),
    chunkIndex: quoteSpan.chunkIndex,
    chunkTextStart: quoteSpan.chunkTextStart + relativeStart,
    chunkTextEnd: quoteSpan.chunkTextStart + relativeStart + needle.length,
  };
}

function participantEvidence(quoteSpan, quote, participants) {
  return participants.map((name) => ({
    name,
    ...spanWithinQuote(quoteSpan, quote, name),
  }));
}

function describeRelation(source, zones, chunk, candidate, candidateId) {
  const participants = Array.isArray(candidate.participants) ? candidate.participants : [];
  const distinctParticipants = [...new Set(participants.filter((name) => typeof name === 'string' && name.length > 0))];
  const evidenceQuote = typeof candidate.evidenceQuote === 'string' ? candidate.evidenceQuote : '';
  const relationCue = typeof candidate.relationCue === 'string' ? candidate.relationCue : '';
  const common = {
    candidateId,
    sourceId: source.id,
    chunkIndex: chunk.chunkIndex,
    participants,
    candidatePredicate: candidate.predicate || null,
    candidateDescription: candidate.description || '',
    candidateDescriptionDisposition: 'NOT_PROJECTED_UNVERIFIED_PARAPHRASE',
    semanticStatus: 'NOT_ASSESSED',
  };
  if (distinctParticipants.length < 2 || distinctParticipants.length !== participants.length) {
    return { ...common, sourceStatus: 'HELD_RELATION_CARDINALITY', evidence: [] };
  }
  if (!evidenceQuote) return { ...common, sourceStatus: 'HELD_NO_EVIDENCE_QUOTE', evidence: [] };
  if (!relationCue || !evidenceQuote.includes(relationCue)) {
    return { ...common, sourceStatus: 'HELD_NO_EXACT_CUE_QUOTE', evidence: [] };
  }
  if (participants.some((name) => !evidenceQuote.includes(name))) {
    return { ...common, sourceStatus: 'HELD_PARTICIPANT_NOT_IN_QUOTE', evidence: [] };
  }

  const zoneResults = zones.map((zone) => {
    const region = zone.kind === 'table-row' ? '' : zone.anchorText;
    const quoteSpans = exactRegionSpans(source, zone, chunk, region, evidenceQuote);
    return { zone, quoteSpans };
  });
  const grounded = zoneResults.filter(({ quoteSpans }) => quoteSpans.length > 0);
  if (!grounded.length) {
    const literalOutsideChunk = zoneResults.some(({ zone }) =>
      zone.kind !== 'table-row' && sourceContainsQuote(source, zone, zone.anchorText, evidenceQuote));
    const tableLiteral = zones.some((zone) =>
      zone.kind === 'table-row' && sourceContainsQuote(source, zone, zone.text, evidenceQuote));
    return {
      ...common,
      sourceStatus: literalOutsideChunk ? 'HELD_EVIDENCE_OUTSIDE_CHUNK'
        : tableLiteral ? 'HELD_TABLE_RELATION_REQUIRES_FACT'
          : source.text.includes(evidenceQuote) ? 'HELD_EVIDENCE_CROSSES_ZONES' : 'HELD_QUOTE_NOT_SOURCE_LITERAL',
      evidence: [],
    };
  }
  const chosen = grounded.find(({ zone }) =>
    participants.every((name) => zone.anchorText.includes(name))) || null;
  if (!chosen) return { ...common, sourceStatus: 'HELD_PARTICIPANT_NOT_IN_QUOTE_ZONE', evidence: [] };
  const evidence = chosen.quoteSpans.map((span) => ({
    ...span,
    relationCue: spanWithinQuote(span, evidenceQuote, relationCue),
    participants: participantEvidence(span, evidenceQuote, participants),
  }));
  return { ...common, sourceStatus: 'LEXICALLY_GROUNDED_CANDIDATE', evidence };
}

function tableHeaderSpans(source, zone, chunk, quote, binding) {
  if (!quote || !binding || !Array.isArray(binding.headerRefs)) return [];
  const relationStart = zone.text.indexOf(zone.relationText);
  if (relationStart < 0) return [];
  const spans = [];
  const lines = zone.relationText.split('\n');
  let lineStart = 0;
  for (const line of lines) {
    const match = /^h(\d+) c(\d+)(?:-(\d+))?=(.*)$/u.exec(line);
    if (match) {
      const row = Number(match[1]) - 1;
      const firstCell = Number(match[2]) - 1;
      const lastCell = match[3] ? Number(match[3]) - 1 : firstCell;
      const headerValue = match[4];
      const hasBoundRef = binding.headerRefs.some((ref) =>
        ref.row === row && binding.col >= firstCell && binding.col <= lastCell);
      if (hasBoundRef && headerValue.trim() === quote) {
        for (const quoteOffset of occurrences(headerValue, quote)) {
          const sourceStart = zone.sourceStart + relationStart + lineStart + line.indexOf('=') + 1 + quoteOffset;
          const sourceEnd = sourceStart + quote.length;
          const sourceOffset = sourceStart - source.sourceStart;
          const chunkTextStart = sourceStart - chunk.sourceStart;
          if (source.text.slice(sourceOffset, sourceOffset + quote.length) !== quote) continue;
          if (chunkTextStart < 0 || sourceStart + quote.length > chunk.sourceEnd) continue;
          if (chunk.inputText.slice(chunkTextStart, chunkTextStart + quote.length) !== quote) continue;
          spans.push({
            zoneId: zone.id,
            sourceStart,
            sourceEnd,
            quote,
            quoteSha256: sha256(quote),
            chunkIndex: chunk.chunkIndex,
            chunkTextStart,
            chunkTextEnd: chunkTextStart + quote.length,
            headerRef: binding.headerRefs.find((ref) => ref.row === row),
            renderedColumnSpan: { start: firstCell, end: lastCell },
          });
        }
      }
    }
    lineStart += line.length + 1;
  }
  return spans;
}

function boundCellSpan(source, zone, chunk, binding, quote) {
  if (!binding || typeof quote !== 'string' || !quote) return null;
  const cells = zone.anchorText.split('\t');
  const rawCell = cells[binding.cell];
  if (typeof rawCell !== 'string' || rawCell.trim() !== quote) return null;
  const trimOffset = rawCell.indexOf(quote);
  const anchorStart = zone.text.indexOf(zone.anchorText);
  if (anchorStart < 0) return null;
  const cellStart = cells.slice(0, binding.cell).reduce((length, cell) => length + cell.length + 1, 0);
  const sourceStart = zone.sourceStart + anchorStart + cellStart + trimOffset;
  const sourceEnd = sourceStart + quote.length;
  const sourceOffset = sourceStart - source.sourceStart;
  const chunkTextStart = sourceStart - chunk.sourceStart;
  if (source.text.slice(sourceOffset, sourceOffset + quote.length) !== quote) return null;
  if (chunkTextStart < 0 || sourceStart + quote.length > chunk.sourceEnd) return null;
  if (chunk.inputText.slice(chunkTextStart, chunkTextStart + quote.length) !== quote) return null;
  return {
    zoneId: zone.id,
    sourceStart,
    sourceEnd,
    quote,
    quoteSha256: sha256(quote),
    chunkIndex: chunk.chunkIndex,
    chunkTextStart,
    chunkTextEnd: chunkTextStart + quote.length,
  };
}

function auditCandidateQuote(source, chunk, quote) {
  if (typeof quote !== 'string' || !quote) {
    return { status: 'MISSING', quoteSha256: null, sourceSpans: [], emittingChunkSpans: [], usedAsEvidence: false };
  }
  const sourceOffsets = occurrences(source.text, quote);
  const chunkOffsets = occurrences(chunk.inputText, quote);
  const sourceSpans = sourceOffsets.map((offset) => ({
    sourceStart: source.sourceStart + offset,
    sourceEnd: source.sourceStart + offset + quote.length,
  }));
  const emittingChunkSpans = chunkOffsets.map((offset) => ({
    sourceStart: chunk.sourceStart + offset,
    sourceEnd: chunk.sourceStart + offset + quote.length,
    chunkTextStart: offset,
    chunkTextEnd: offset + quote.length,
  })).filter((span) => sourceSpans.some((sourceSpan) =>
    sourceSpan.sourceStart === span.sourceStart && sourceSpan.sourceEnd === span.sourceEnd));
  const status = emittingChunkSpans.length ? 'EXACT_SOURCE_AND_EMITTING_CHUNK'
    : sourceSpans.length ? 'EXACT_SOURCE_OUTSIDE_EMITTING_CHUNK' : 'NOT_EXACT_SOURCE_TEXT';
  return {
    status,
    quoteSha256: sha256(quote),
    quoteChars: quote.length,
    sourceSpans,
    emittingChunkSpans,
    usedAsEvidence: false,
  };
}

function atomicTableMatches(source, zones, chunk, candidate) {
  const sourceWideChunk = {
    chunkIndex: chunk.chunkIndex,
    sourceStart: source.sourceStart,
    sourceEnd: source.sourceEnd,
    inputText: source.text,
  };
  const inChunk = [];
  const inSource = [];
  for (const zone of zones.filter((item) => item.kind === 'table-row')) {
    const packet = zone.packet || {};
    const subjectBindings = (packet.bindings || []).filter((binding) => binding.col === candidate.subjectColumnIndex);
    if (subjectBindings.length !== 1) continue;
    const subjectBinding = subjectBindings[0];
    const subjectSourceSpan = boundCellSpan(source, zone, sourceWideChunk, subjectBinding, candidate.subject);
    if (!subjectSourceSpan) continue;
    for (const valueBinding of packet.bindings || []) {
      const valueSourceSpan = boundCellSpan(source, zone, sourceWideChunk, valueBinding, candidate.value);
      if (!valueSourceSpan) continue;
      const headerSourceSpans = tableHeaderSpans(source, zone, sourceWideChunk, candidate.headerQuote, valueBinding);
      for (const headerSourceSpan of headerSourceSpans) {
        const match = {
          zone,
          packet,
          subjectBinding,
          valueBinding,
          subjectSourceSpan,
          valueSourceSpan,
          headerSourceSpan,
        };
        inSource.push(match);
        const subjectSpan = boundCellSpan(source, zone, chunk, subjectBinding, candidate.subject);
        const valueSpan = boundCellSpan(source, zone, chunk, valueBinding, candidate.value);
        const headerSpans = tableHeaderSpans(source, zone, chunk, candidate.headerQuote, valueBinding);
        if (subjectSpan && valueSpan && headerSpans.some((span) =>
          span.sourceStart === headerSourceSpan.sourceStart && span.sourceEnd === headerSourceSpan.sourceEnd)) {
          inChunk.push({ ...match, subjectSpan, valueSpan, headerSpan: headerSpans.find((span) =>
            span.sourceStart === headerSourceSpan.sourceStart && span.sourceEnd === headerSourceSpan.sourceEnd) });
        }
      }
    }
  }
  return { inChunk, inSource };
}

function describeTableFact(source, zones, chunk, candidate, candidateId) {
  const common = {
    candidateId,
    sourceId: source.id,
    chunkIndex: chunk.chunkIndex,
    candidateKind: 'table_row_fact',
    candidateSubject: candidate.subject || '',
    candidatePredicate: candidate.predicate || '',
    candidateValue: candidate.value || '',
    candidateDescription: candidate.description || '',
    candidateDescriptionDisposition: 'NOT_PROJECTED_UNVERIFIED_PARAPHRASE',
    semanticStatus: 'NOT_ASSESSED',
  };
  const subjectColumnIndex = candidate.subjectColumnIndex;
  if (!Number.isInteger(subjectColumnIndex) || subjectColumnIndex < 0) {
    return { ...common, sourceStatus: 'HELD_TABLE_SUBJECT_COLUMN_NOT_BOUND', evidence: null };
  }
  const rowQuoteAudit = auditCandidateQuote(source, chunk, candidate.rowQuote);
  const evidenceQuoteAudit = auditCandidateQuote(source, chunk, candidate.evidenceQuote);
  const atomic = atomicTableMatches(source, zones, chunk, candidate);
  if (atomic.inChunk.length > 1) {
    return {
      ...common,
      sourceStatus: 'HELD_AMBIGUOUS_ATOMIC_TABLE_BINDING',
      candidateQuoteAudit: { rowQuote: rowQuoteAudit, evidenceQuote: evidenceQuoteAudit, rowQuoteUsedAsEvidence: false, evidenceQuoteUsedAsEvidence: false },
      evidence: null,
    };
  }
  if (atomic.inChunk.length === 0) {
    return {
      ...common,
      sourceStatus: atomic.inSource.length ? 'HELD_ATOMIC_EVIDENCE_OUTSIDE_EMITTING_CHUNK' : 'HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING',
      candidateQuoteAudit: { rowQuote: rowQuoteAudit, evidenceQuote: evidenceQuoteAudit, rowQuoteUsedAsEvidence: false, evidenceQuoteUsedAsEvidence: false },
      evidence: null,
    };
  }
  const match = atomic.inChunk[0];
  const { zone, packet, valueBinding, subjectSpan, valueSpan, headerSpan } = match;
  const exactRowSpan = candidate.rowQuote === zone.anchorText
    ? exactRegionSpans(source, zone, chunk, zone.anchorText, candidate.rowQuote)[0] || null
    : null;
  const metadataMatches = {
    packetIdsDerivedFromFrozenRow: true,
    modelTableIdMatchesResolved: candidate.tableId === packet.tableId,
    modelTableRowLabelMatchesResolved: candidate.tableRowLabel === packet.sourceHeadingLabel,
    modelSubjectColumnIndexMatchesResolved: candidate.subjectColumnIndex === match.subjectBinding.col,
    modelValueColumnIndexMatchesResolved: candidate.columnIndex === valueBinding.col,
    resolvedTableId: packet.tableId,
    resolvedTableRowLabel: packet.sourceHeadingLabel,
    resolvedSubjectColumnIndex: match.subjectBinding.col,
    resolvedValueColumnIndex: valueBinding.col,
    metadataDisposition: 'Derived from the uniquely matched frozen row and header binding; model identifiers and column index are retained only for audit.',
  };
  return {
    ...common,
    sourceStatus: 'LEXICALLY_GROUNDED_FACT_CANDIDATE',
    candidateQuoteAudit: {
      rowQuote: rowQuoteAudit,
      evidenceQuote: evidenceQuoteAudit,
      rowQuoteUsedAsEvidence: false,
      evidenceQuoteUsedAsEvidence: false,
    },
    candidateMetadataAudit: metadataMatches,
    evidence: {
      zoneId: zone.id,
      row: exactRowSpan,
      header: headerSpan,
      subject: subjectSpan,
      value: valueSpan,
    },
  };
}

function describeProseFact(source, zones, chunk, candidate, candidateId) {
  const common = {
    candidateId,
    sourceId: source.id,
    chunkIndex: chunk.chunkIndex,
    candidateKind: 'prose_fact',
    candidateSubject: candidate.subject || '',
    candidatePredicate: candidate.predicate || '',
    candidateValue: candidate.value || '',
    candidateDescription: candidate.description || '',
    candidateDescriptionDisposition: 'NOT_PROJECTED_UNVERIFIED_PARAPHRASE',
    semanticStatus: 'NOT_ASSESSED',
  };
  const quote = typeof candidate.evidenceQuote === 'string' ? candidate.evidenceQuote : '';
  const cue = typeof candidate.predicateCue === 'string' ? candidate.predicateCue : '';
  if (!quote) return { ...common, sourceStatus: 'HELD_NO_EVIDENCE_QUOTE', evidence: null };
  if (!cue || !quote.includes(cue)) return { ...common, sourceStatus: 'HELD_NO_EXACT_CUE_QUOTE', evidence: null };
  if (!quote.includes(candidate.subject || '') || !quote.includes(candidate.value || '')) {
    return { ...common, sourceStatus: 'HELD_FACT_TERMS_NOT_IN_QUOTE', evidence: null };
  }
  const matches = zones.flatMap((zone) => zone.kind === 'table-row'
    ? []
    : exactRegionSpans(source, zone, chunk, zone.anchorText, quote).map((span) => ({ zone, span })));
  if (!matches.length) {
    const inSource = zones.some((zone) => zone.kind !== 'table-row' && sourceContainsQuote(source, zone, zone.anchorText, quote));
    return { ...common, sourceStatus: inSource ? 'HELD_EVIDENCE_OUTSIDE_CHUNK' : 'HELD_QUOTE_NOT_SOURCE_LITERAL', evidence: null };
  }
  return {
    ...common,
    sourceStatus: 'LEXICALLY_GROUNDED_FACT_CANDIDATE',
    evidence: { quote: matches[0].span, zoneId: matches[0].zone.id },
  };
}

function verifyRun(bundle, freeze, receipt, freezeSha256, allowDryRunEmpty) {
  const frozenSourceBundleSha256 = freeze.sourceBundleSha256 || freeze.source?.sourceBundleSha256;
  if (!frozenSourceBundleSha256 || sha256(JSON.stringify(bundle)) !== frozenSourceBundleSha256) {
    throw new Error('Source bundle does not match frozen hash');
  }
  if (receipt.sourceBundleSha256 !== frozenSourceBundleSha256) throw new Error('Evidence run source bundle hash mismatch');
  const isDryRunEmpty = receipt.status === 'DRY_RUN_EMPTY';
  if (receipt.status !== 'COMPLETED' && !(allowDryRunEmpty && isDryRunEmpty)) {
    throw new Error(`Evidence run is not complete: ${receipt.status}`);
  }
  if (isDryRunEmpty && (receipt.documents || []).some((doc) =>
    (doc.chunks || []).some((chunk) => (chunk.facts || []).length || (chunk.relations || []).length))) {
    throw new Error('DRY_RUN_EMPTY receipt must not contain candidate outputs');
  }
  if (freezeSha256 && receipt.freezeSha256 !== freezeSha256) throw new Error('Evidence run freeze hash mismatch');

  const ranges = bundle.sourceRanges || [];
  const expectedDocs = freeze.chunkManifest || [];
  if (expectedDocs.length !== ranges.length) throw new Error('Frozen chunk manifest must cover every source range');
  const expectedById = new Map(expectedDocs.map((doc) => [doc.sourceId, doc]));
  if (expectedById.size !== expectedDocs.length) throw new Error('Frozen chunk manifest has duplicate source IDs');
  const actualDocs = receipt.documents || [];
  const actualById = new Map(actualDocs.map((doc) => [doc.sourceId, doc]));
  if (actualById.size !== actualDocs.length || actualDocs.length !== ranges.length) {
    throw new Error('Evidence receipt must uniquely cover every source range');
  }
  const sourceById = new Map(ranges.map((range) => [range.id, range]));
  const zoneById = new Map();
  for (const zone of bundle.zones || []) {
    if (!zoneById.has(zone.rangeId)) zoneById.set(zone.rangeId, []);
    zoneById.get(zone.rangeId).push(zone);
  }

  const normalizedDocs = [];
  for (const [sourceId, expected] of expectedById) {
    const source = sourceById.get(sourceId);
    const actual = actualById.get(sourceId);
    if (!source || !actual || actual.sourceTextSha256 !== source.textSha256 || expected.sourceTextSha256 !== source.textSha256) {
      throw new Error(`Evidence receipt source text mismatch: ${sourceId}`);
    }
    const expectedChunks = expected.chunks || [];
    const actualChunks = actual.chunks || [];
    if (expectedChunks.length !== actualChunks.length) throw new Error(`Evidence receipt chunk count mismatch: ${sourceId}`);
    for (let index = 0; index < expectedChunks.length; index += 1) {
      const frozenChunk = expectedChunks[index];
      const chunk = actualChunks[index];
      if (chunk.chunkIndex !== index || frozenChunk.chunkIndex !== index
        || chunk.sourceStart !== frozenChunk.sourceStart || chunk.sourceEnd !== frozenChunk.sourceEnd
        || chunk.textSha256 !== frozenChunk.textSha256 || sha256(chunk.inputText) !== frozenChunk.textSha256) {
        throw new Error(`Evidence receipt chunk differs from freeze: ${sourceId}/${index}`);
      }
      const sourceStart = chunk.sourceStart - source.sourceStart;
      const sourceEnd = chunk.sourceEnd - source.sourceStart;
      if (sourceStart < 0 || sourceEnd > source.text.length || source.text.slice(sourceStart, sourceEnd) !== chunk.inputText) {
        throw new Error(`Evidence receipt chunk is not an exact frozen source slice: ${sourceId}/${index}`);
      }
    }
    normalizedDocs.push({ source, chunks: actualChunks, zones: zoneById.get(sourceId) || [] });
  }
  return normalizedDocs;
}

export function validateEvidenceRun(bundle, freeze, receipt, { freezeSha256, allowDryRunEmpty = false } = {}) {
  const documents = verifyRun(bundle, freeze, receipt, freezeSha256, allowDryRunEmpty);
  const facts = [];
  const relations = [];
  const selectedZoneIds = new Set();
  for (const document of documents) {
    for (const chunk of document.chunks) {
      (chunk.facts || []).forEach((candidate, index) => {
        const item = candidate.kind === 'table_row'
          ? describeTableFact(document.source, document.zones, chunk, candidate, `${document.source.id}:${chunk.chunkIndex}:fact:${index}`)
          : describeProseFact(document.source, document.zones, chunk, candidate, `${document.source.id}:${chunk.chunkIndex}:fact:${index}`);
        facts.push(item);
        if (item.sourceStatus === 'LEXICALLY_GROUNDED_FACT_CANDIDATE') {
          const zoneId = item.evidence?.row?.zoneId || item.evidence?.zoneId;
          if (zoneId) selectedZoneIds.add(zoneId);
        }
      });
      (chunk.relations || []).forEach((candidate, index) => {
        const item = describeRelation(document.source, document.zones, chunk, candidate, `${document.source.id}:${chunk.chunkIndex}:relation:${index}`);
        relations.push(item);
        if (item.sourceStatus === 'LEXICALLY_GROUNDED_CANDIDATE') item.evidence.forEach((span) => selectedZoneIds.add(span.zoneId));
      });
    }
  }
  const zones = [...selectedZoneIds].map((id) => (bundle.zones || []).find((zone) => zone.id === id)).filter(Boolean)
    .sort((a, b) => a.rangeId.localeCompare(b.rangeId) || a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd);
  const summary = (items) => items.reduce((counts, item) => {
    counts[item.sourceStatus] = (counts[item.sourceStatus] || 0) + 1;
    return counts;
  }, {});
  return {
    validation: {
      schema: 'zuri.hyper-relation-evidence-validation.v1',
      facts,
      relations,
      summary: { facts: summary(facts), relations: summary(relations) },
      semanticStatus: 'NOT_ASSESSED',
      runDisposition: receipt.status === 'DRY_RUN_EMPTY' ? 'DRY_RUN_SHAPE_ONLY' : 'COMPLETED_EXTRACTION_CANDIDATES',
    },
    projection: {
      zoneIds: zones.map((zone) => zone.id),
      content: zones.map((zone) => zone.text).join('\n\n'),
      sourceTextOnly: true,
      modelCandidateTextIncluded: false,
    },
  };
}

