import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reportDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(reportDir, '../../..');
const runDir = path.join(repoRoot, '.local/hyper-extract-20261025/run-3');
const bundlePath = path.join(runDir, 'source-bundle.json');
const freezePath = path.join(runDir, 'freeze.json');
const candidatesPath = path.join(runDir, 'candidates.json');
const outputPath = path.join(reportDir, 'mechanical-audit.json');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha256Text = (value) => sha256(Buffer.from(value, 'utf8'));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fileSha = (file) => sha256(fs.readFileSync(file));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function allHits(text, needle, absoluteStart, filter = () => true) {
  if (typeof needle !== 'string' || needle.length === 0) return [];
  const hits = [];
  let from = 0;
  while (from <= text.length - needle.length) {
    const offset = text.indexOf(needle, from);
    if (offset < 0) break;
    const hit = {
      start: absoluteStart + offset,
      end: absoluteStart + offset + needle.length,
      text: needle,
      sha256: sha256Text(needle),
    };
    if (filter(hit)) hits.push(hit);
    from = offset + 1;
  }
  return hits;
}

function ngrams(text, size = 3) {
  const normalized = [...text.normalize('NFC')];
  const n = Math.min(size, normalized.length);
  if (n === 0) return new Set();
  const output = new Set();
  for (let i = 0; i <= normalized.length - n; i += 1) {
    output.add(normalized.slice(i, i + n).join(''));
  }
  return output;
}

function ngramCoverage(candidate, source) {
  const candidateGrams = ngrams(candidate, candidate.length < 3 ? 2 : 3);
  const sourceGrams = ngrams(source, candidate.length < 3 ? 2 : 3);
  if (candidateGrams.size === 0) return { grams: 0, matched: 0, coverage: null };
  let matched = 0;
  for (const gram of candidateGrams) if (sourceGrams.has(gram)) matched += 1;
  return {
    grams: candidateGrams.size,
    matched,
    coverage: Number((matched / candidateGrams.size).toFixed(4)),
  };
}

function normalizeForWhitespaceNfkcComparison(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function longestCommonSubstring(left, right) {
  if (!left || !right) return null;
  let previous = new Uint32Array(right.length + 1);
  let bestLength = 0;
  let bestLeftEnd = 0;
  let bestRightEnd = 0;
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Uint32Array(right.length + 1);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > bestLength) {
          bestLength = current[j];
          bestLeftEnd = i;
          bestRightEnd = j;
        }
      }
    }
    previous = current;
  }
  if (bestLength === 0) return null;
  return {
    candidateStart: bestLeftEnd - bestLength,
    candidateEnd: bestLeftEnd,
    sourceStart: bestRightEnd - bestLength,
    sourceEnd: bestRightEnd,
    text: left.slice(bestLeftEnd - bestLength, bestLeftEnd),
    length: bestLength,
  };
}

function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function closestNearMatch(target, regionText, regionStart) {
  if ([...target].length < 6) return null;
  const minLength = Math.max(1, target.length - 2);
  const maxLength = Math.min(regionText.length, target.length + 2);
  let best = null;
  for (let size = minLength; size <= maxLength; size += 1) {
    for (let offset = 0; offset <= regionText.length - size; offset += 1) {
      const quote = regionText.slice(offset, offset + size);
      const distance = editDistance(target, quote);
      if (!best || distance < best.distance || (distance === best.distance && size === target.length)) {
        best = { distance, start: regionStart + offset, end: regionStart + offset + size, text: quote };
      }
      if (best?.distance === 0) return null;
    }
  }
  const threshold = Math.max(1, Math.floor(target.length * 0.08));
  return best && best.distance <= threshold ? { ...best, threshold, status: 'NEAR_MATCH_ONLY_NOT_EVIDENCE' } : null;
}

function regionHits(zone, field, phrase, chunk) {
  const { text, start } = zone.regions[field];
  return allHits(text, phrase, start, (hit) => hit.start >= chunk.sourceStart && hit.end <= chunk.sourceEnd);
}

function redactParticipantLiterals(description, participants) {
  let core = description;
  const removed = [];
  for (const participant of [...participants].sort((a, b) => b.length - a.length)) {
    if (participant && core.includes(participant)) {
      core = core.split(participant).join(' ');
      removed.push(participant);
    }
  }
  return { core: core.trim(), removed };
}

function makeZone(range, zone) {
  const sourceOffset = zone.sourceStart - range.sourceStart;
  assert(sourceOffset >= 0, `zone before source range: ${zone.id}`);
  assert(range.text.slice(sourceOffset, sourceOffset + zone.text.length) === zone.text, `zone text does not match frozen range: ${zone.id}`);
  const relationOffset = zone.text.indexOf(zone.relationText);
  const bodyOffset = zone.anchorText ? zone.text.indexOf(zone.anchorText, Math.max(0, relationOffset)) : -1;
  assert(relationOffset >= 0, `relationText not in zone text: ${zone.id}`);
  if (zone.anchorText) assert(bodyOffset >= 0, `anchorText not in zone text: ${zone.id}`);
  const isTable = zone.kind === 'table-row';
  const bodyText = zone.anchorText || '';
  const bodyStart = bodyOffset >= 0 ? zone.sourceStart + bodyOffset : zone.sourceStart;
  const headerStart = zone.sourceStart + relationOffset;
  const headerText = isTable && bodyOffset >= 0
    ? zone.text.slice(relationOffset, bodyOffset)
    : '';
  return {
    ...zone,
    regions: {
      full: { text: zone.text, start: zone.sourceStart },
      body: { text: bodyText, start: bodyStart },
      header: { text: headerText, start: headerStart },
      relation: { text: isTable ? bodyText : zone.relationText, start: isTable ? bodyStart : zone.sourceStart + relationOffset },
    },
  };
}

function main() {
  const bundle = readJson(bundlePath);
  const freeze = readJson(freezePath);
  const candidates = readJson(candidatesPath);
  const freezeSha256 = fileSha(freezePath);
  const bundleSha256 = sha256Text(JSON.stringify(bundle));
  assert(freeze.runId === 'run-3', 'unexpected freeze run id');
  assert(candidates.status === 'COMPLETED', 'candidate receipt is not complete');
  assert(candidates.freezeSha256 === freezeSha256, 'candidate freeze hash mismatch');
  assert(bundleSha256 === freeze.sourceBundleSha256, 'freeze/source bundle hash mismatch');
  assert(candidates.sourceBundleSha256 === bundleSha256, 'candidate/source bundle hash mismatch');

  const ranges = new Map(bundle.sourceRanges.map((range) => [range.id, range]));
  const zoneMap = new Map();
  for (const rawZone of bundle.zones) {
    const range = ranges.get(rawZone.rangeId);
    assert(range, `unknown zone range: ${rawZone.id}`);
    if (!zoneMap.has(rawZone.rangeId)) zoneMap.set(rawZone.rangeId, []);
    zoneMap.get(rawZone.rangeId).push(makeZone(range, rawZone));
  }

  const chunkCalls = new Map();
  let requestCursor = 0;
  for (const document of candidates.documents) {
    for (const chunk of document.chunks) {
      const timing = candidates.timing.perChunk.find((item) => item.sourceId === document.sourceId && item.chunkIndex === chunk.chunkIndex);
      assert(timing, `missing per-chunk call timing: ${document.sourceId}/${chunk.chunkIndex}`);
      const requests = candidates.requestBodies.slice(requestCursor, requestCursor + timing.callStarts);
      assert(requests.length === timing.callStarts, `request capture incomplete: ${document.sourceId}/${chunk.chunkIndex}`);
      chunkCalls.set(`${document.sourceId}:${chunk.chunkIndex}`, {
        observedCallStarts: timing.callStarts,
        responseFormatNames: requests.map((request) => request.responseFormatName),
      });
      requestCursor += timing.callStarts;
    }
  }
  assert(requestCursor === candidates.requestBodies.length, 'per-chunk call counts do not cover every observed request');

  const edges = [];
  let edgeNumber = 0;
  const strictReasons = new Map();
  for (const document of candidates.documents) {
    const range = ranges.get(document.sourceId);
    assert(range, `unknown candidate source: ${document.sourceId}`);
    assert(document.sourceTextSha256 === range.textSha256, `candidate source text hash mismatch: ${document.sourceId}`);
    for (const chunk of document.chunks) {
      const start = chunk.sourceStart - range.sourceStart;
      const end = chunk.sourceEnd - range.sourceStart;
      assert(range.text.slice(start, end) === chunk.inputText, `chunk/source mismatch: ${document.sourceId}/${chunk.chunkIndex}`);
      assert(sha256Text(chunk.inputText) === chunk.textSha256, `chunk hash mismatch: ${document.sourceId}/${chunk.chunkIndex}`);
      const sourceZones = zoneMap.get(document.sourceId) || [];
      for (let edgeIndex = 0; edgeIndex < chunk.edges.length; edgeIndex += 1) {
        const item = chunk.edges[edgeIndex];
        edgeNumber += 1;
        const id = `E${String(edgeNumber).padStart(4, '0')}`;
        const callEvidence = chunkCalls.get(`${document.sourceId}:${chunk.chunkIndex}`);
        const participants = Array.isArray(item.participants) ? item.participants : [];
        const chunkSpan = (phrase) => allHits(chunk.inputText, phrase, chunk.sourceStart);
        const sourceSpan = (phrase) => allHits(range.text, phrase, range.sourceStart);
        const participantEvidence = participants.map((name) => {
          const exactChunk = chunkSpan(name);
          const exactSource = sourceSpan(name);
          return {
            name,
            exactChunk,
            exactSourceHitCount: exactSource.length,
            exactSourceOutsideEmittingChunk: exactChunk.length === 0
              ? exactSource.map((hit) => {
                const zone = sourceZones.find((candidateZone) => hit.start >= candidateZone.sourceStart && hit.end <= candidateZone.sourceEnd);
                return { ...hit, zoneId: zone?.id ?? null, zoneKind: zone?.kind ?? null };
              })
              : [],
          };
        });
        const description = typeof item.description === 'string' ? item.description : '';
        const descriptionChunkHits = chunkSpan(description);
        const descriptionSourceHits = sourceSpan(description);
        const normalizedDescription = normalizeForWhitespaceNfkcComparison(description);
        const normalizedDescriptionSourceMatch = normalizeForWhitespaceNfkcComparison(range.text).includes(normalizedDescription);
        const overlappingZones = sourceZones.filter((zone) =>
          zone.sourceStart < chunk.sourceEnd && zone.sourceEnd > chunk.sourceStart,
        );
        const byZone = overlappingZones.map((zone) => {
          const bodyText = zone.regions.body.text;
          const headerText = zone.regions.header.text;
          const bodyDescription = regionHits(zone, 'body', description, chunk);
          const headerDescription = regionHits(zone, 'header', description, chunk);
          const bodyParticipants = participants.map((name) => ({ name, matches: regionHits(zone, 'body', name, chunk) }));
          const headerParticipants = participants.map((name) => ({ name, matches: regionHits(zone, 'header', name, chunk) }));
          const keywords = (Array.isArray(item.keywords) ? item.keywords : []).map((keyword) => ({
            keyword,
            participantLiteral: participants.includes(keyword),
            body: regionHits(zone, 'body', keyword, chunk),
            header: regionHits(zone, 'header', keyword, chunk),
          }));
          const { core, removed } = redactParticipantLiterals(description, participants);
          const bodyCommon = longestCommonSubstring(core, bodyText);
          const headerCommon = longestCommonSubstring(core, headerText);
          const bodyCommonEvidence = bodyCommon && bodyCommon.length >= 2 ? {
            ...bodyCommon,
            sourceStart: zone.regions.body.start + bodyCommon.sourceStart,
            sourceEnd: zone.regions.body.start + bodyCommon.sourceEnd,
            sha256: sha256Text(bodyCommon.text),
          } : null;
          const headerCommonEvidence = headerCommon && headerCommon.length >= 2 ? {
            ...headerCommon,
            sourceStart: zone.regions.header.start + headerCommon.sourceStart,
            sourceEnd: zone.regions.header.start + headerCommon.sourceEnd,
            sha256: sha256Text(headerCommon.text),
          } : null;
          const bodyCommonText = bodyCommonEvidence?.text || '';
          const headerCommonText = headerCommonEvidence?.text || '';
          const nearParticipantMatches = participants.map((name) => {
            const exactBody = allHits(bodyText, name, zone.regions.body.start).length > 0;
            const exactHeader = allHits(headerText, name, zone.regions.header.start).length > 0;
            if (exactBody || exactHeader) return null;
            const bodyNear = closestNearMatch(name, bodyText, zone.regions.body.start);
            const headerNear = closestNearMatch(name, headerText, zone.regions.header.start);
            const best = !bodyNear ? headerNear : !headerNear ? bodyNear : bodyNear.distance <= headerNear.distance ? bodyNear : headerNear;
            return best ? { name, region: best === bodyNear ? 'row_body' : 'table_header', ...best } : null;
          }).filter(Boolean);
          return {
            zoneId: zone.id,
            kind: zone.kind,
            sourceStart: zone.sourceStart,
            sourceEnd: zone.sourceEnd,
            zoneTextSha256: sha256Text(zone.text),
            headerTextChars: headerText.length,
            headerTextSha256: sha256Text(headerText),
            headerStart: zone.regions.header.start,
            bodyTextChars: bodyText.length,
            bodyTextSha256: sha256Text(bodyText),
            bodyStart: zone.regions.body.start,
            visibleChunkIntersection: {
              start: Math.max(zone.sourceStart, chunk.sourceStart),
              end: Math.min(zone.sourceEnd, chunk.sourceEnd),
            },
            description: { body: bodyDescription, header: headerDescription },
            participants: { body: bodyParticipants, header: headerParticipants },
            exactKeywordMatches: keywords,
            relationCore: {
              text: core,
              removedExactParticipantStrings: removed,
              bodyNgramCoverage: ngramCoverage(core, bodyText),
              headerNgramCoverage: ngramCoverage(core, headerText),
              longestExactSubstringInBody: bodyCommonEvidence,
              longestExactSubstringInHeader: headerCommonEvidence,
              note: 'Lexical overlap only; does not establish a semantic relation.',
            },
            nearParticipantMatches,
          };
        });
        const sameZoneParticipantBody = byZone.filter((zone) =>
          participants.length >= 2 && zone.participants.body.every((part) => part.matches.length > 0),
        );
        const strictGrounded = sameZoneParticipantBody.filter((zone) => zone.description.body.length > 0);
        const exactParticipantMatchesInChunk = participantEvidence.filter((itemEvidence) => itemEvidence.exactChunk.length > 0).length;
        const exactDescriptionInBody = byZone.some((zone) => zone.description.body.length > 0);
        const exactDescriptionInHeader = byZone.some((zone) => zone.description.header.length > 0);
        const flags = [];
        if (participants.length < 2) flags.push('ONE_PARTICIPANT_OUTPUT');
        if (exactParticipantMatchesInChunk === 0) flags.push('NO_LITERAL_PARTICIPANT_IN_EMITTING_CHUNK');
        if (participants.length >= 2 && !sameZoneParticipantBody.length) flags.push('NO_SINGLE_ROW_OR_PROSE_BODY_WITH_ALL_PARTICIPANTS');
        if (!descriptionChunkHits.length) flags.push('FULL_DESCRIPTION_NOT_LITERAL_IN_EMITTING_CHUNK');
        if (!exactDescriptionInBody && exactDescriptionInHeader) flags.push('FULL_DESCRIPTION_LITERAL_ONLY_IN_TABLE_HEADER');
        if (!exactDescriptionInBody && !exactDescriptionInHeader && descriptionSourceHits.length) flags.push('FULL_DESCRIPTION_LITERAL_OUTSIDE_EMITTING_ZONE_OR_CHUNK');
        if (exactDescriptionInBody && !strictGrounded.length) flags.push('EXACT_DESCRIPTION_BODY_WITHOUT_ALL_PARTICIPANTS_IN_SAME_ZONE');
        const className = participants.length < 2
          ? 'SINGLE_PARTICIPANT_SCHEMA_OUTPUT'
          : strictGrounded.length
            ? 'STRICT_RELATION_QUOTE_AND_PARTICIPANTS_MATCH'
            : sameZoneParticipantBody.length
              ? 'PARTICIPANTS_SAME_ZONE_BUT_DESCRIPTION_NOT_VERBATIM'
              : exactParticipantMatchesInChunk === 0
                ? 'PARTICIPANTS_NOT_LITERAL_IN_EMITTING_CHUNK'
                : 'PARTICIPANTS_SPAN_MULTIPLE_ZONES_OR_REGIONS';
        for (const flag of flags) strictReasons.set(flag, (strictReasons.get(flag) || 0) + 1);

        const sourceDescriptionLocations = descriptionSourceHits.map((hit) => {
          const zone = sourceZones.find((candidateZone) => hit.start >= candidateZone.sourceStart && hit.end <= candidateZone.sourceEnd);
          return { ...hit, inEmittingChunk: hit.start >= chunk.sourceStart && hit.end <= chunk.sourceEnd, zoneId: zone?.id ?? null, zoneKind: zone?.kind ?? null };
        });
        edges.push({
          candidateId: id,
          sourceId: document.sourceId,
          edgeIndexInEmittingChunk: edgeIndex,
          candidate: {
            participants,
            description,
            keywords: item.keywords || [],
            strength: item.strength,
          },
          emission: {
            chunkIndex: chunk.chunkIndex,
            sourceStart: chunk.sourceStart,
            sourceEnd: chunk.sourceEnd,
            sourceRelativeStart: chunk.sourceRelativeStart,
            sourceRelativeEnd: chunk.sourceRelativeEnd,
            textChars: chunk.textChars,
            chunkTextSha256: chunk.textSha256,
            observedStructuredCallStartsInChunk: callEvidence.observedCallStarts,
            observedStructuredCallResponseFormatNames: callEvidence.responseFormatNames,
            exactDescriptionHits: descriptionChunkHits,
          },
          participantEvidence,
          exactDescriptionInSource: sourceDescriptionLocations,
          normalizedDescriptionOccursInFrozenSource: normalizedDescriptionSourceMatch,
          inspectedEmittingChunkZones: byZone,
          mechanicalClassification: {
            class: className,
            flags,
            oldValidatorEquivalentPass: strictGrounded.length > 0,
            semanticDisposition: 'NOT_ASSESSED_BY_MECHANICAL_LEDGER',
          },
        });
      }
    }
  }

  assert(edgeNumber === 85, `expected 85 run3 edge occurrences; found ${edgeNumber}`);
  const classCounts = Object.fromEntries([...new Set(edges.map((edge) => edge.mechanicalClassification.class))]
    .map((name) => [name, edges.filter((edge) => edge.mechanicalClassification.class === name).length]));
  const sameZoneAll = (edge, region) => edge.candidate.participants.length >= 2
    && edge.inspectedEmittingChunkZones.some((zone) => zone.participants[region].every((participant) => participant.matches.length > 0));
  const headerKeywordEdges = edges.filter((edge) => edge.inspectedEmittingChunkZones.some((zone) =>
    zone.exactKeywordMatches.some((keyword) => !keyword.participantLiteral && keyword.header.length > 0),
  ));
  const bodyKeywordEdges = edges.filter((edge) => edge.inspectedEmittingChunkZones.some((zone) =>
    zone.exactKeywordMatches.some((keyword) => !keyword.participantLiteral && keyword.body.length > 0),
  ));
  const nearEntries = edges.flatMap((edge) => edge.inspectedEmittingChunkZones.flatMap((zone) =>
    zone.nearParticipantMatches.map((match) => ({ candidateId: edge.candidateId, ...match })),
  ));
  const participantSlots = edges.flatMap((edge) => edge.participantEvidence);
  const cardinality = Object.fromEntries([...new Set(edges.map((edge) => String(edge.candidate.participants.length)))].sort((a, b) => Number(a) - Number(b))
    .map((size) => [size, edges.filter((edge) => edge.candidate.participants.length === Number(size)).length]));
  const output = {
    schema: 'zuri.hyper-relation-mechanical-audit.v1',
    createdAt: new Date().toISOString(),
    scope: {
      candidateFile: '.local/hyper-extract-20261025/run-3/candidates.json',
      candidateFileSha256: fileSha(candidatesPath),
      sourceBundleFile: '.local/hyper-extract-20261025/run-3/source-bundle.json',
      sourceBundleFileSha256: fileSha(bundlePath),
      sourceBundleSha256: bundleSha256,
      freezeFile: '.local/hyper-extract-20261025/run-3/freeze.json',
      freezeFileSha256: freezeSha256,
      modelOutputRawEdgeOccurrences: edgeNumber,
      sourceRanges: bundle.sourceRanges.map((range) => ({ id: range.id, sourceStart: range.sourceStart, sourceEnd: range.sourceEnd, textChars: range.text.length, textSha256: range.textSha256 })),
      frozenZones: bundle.zoneCount,
      sourceZoneIndex: bundle.zones.map((zone) => {
        const parsed = zoneMap.get(zone.rangeId).find((candidateZone) => candidateZone.id === zone.id);
        return {
          id: zone.id,
          rangeId: zone.rangeId,
          kind: zone.kind,
          sourceStart: zone.sourceStart,
          sourceEnd: zone.sourceEnd,
          zoneTextSha256: sha256Text(zone.text),
          anchorTextStart: zone.anchorText ? zone.sourceStart + zone.text.indexOf(zone.anchorText) : null,
          anchorTextEnd: zone.anchorText ? zone.sourceStart + zone.text.indexOf(zone.anchorText) + zone.anchorText.length : null,
          anchorTextSha256: sha256Text(zone.anchorText || ''),
          relationTextSha256: sha256Text(zone.relationText || ''),
          headerTextChars: parsed.regions.header.text.length,
          headerTextSha256: sha256Text(parsed.regions.header.text),
        };
      }),
      goldOpened: false,
      questionOrScoreDataOpened: false,
    },
    method: {
      participantAndDescriptionHits: exactStringsOnly,
      exactStringNormalization: 'none; offsets are JavaScript UTF-16 source offsets into the frozen sourceRange text',
      extraDescriptionCheck: 'separate diagnostic normalizes each candidate description and whole frozen range with NFKC plus whitespace collapse; normalized results have no exact source offset and are not used for grounding',
      tableEvidenceRegions: 'table header context is derived from the frozen zone relationText prefix before anchorText; row body is frozen anchorText',
      lexicalCoverage: 'candidate description with literal participant strings removed; exact NFC 3-gram overlap (2-gram only for strings shorter than 3 code points), plus longest literal substring; diagnostic only, never semantic proof',
      nearMatches: 'Levenshtein distance on unnormalized source and candidate strings, emitted only within a length-based threshold; diagnostic only, never admitted as evidence',
      oldValidatorEquivalent: 'reproduces exact-chunk, same-zone participant literals plus complete exact relation description in the body region; table headers are not relation evidence',
    },
    summary: {
      totalEdgeOccurrences: edges.length,
      sourceCounts: Object.fromEntries([...new Set(edges.map((edge) => edge.sourceId))]
        .map((id) => [id, edges.filter((edge) => edge.sourceId === id).length])),
      byMechanicalClass: classCounts,
      oldValidatorEquivalentPasses: edges.filter((edge) => edge.mechanicalClassification.oldValidatorEquivalentPass).length,
      oneParticipantOutputs: edges.filter((edge) => edge.candidate.participants.length < 2).length,
      oneParticipantOutputsFromDirectTwoCallChunks: edges.filter((edge) => edge.candidate.participants.length < 2
        && edge.emission.observedStructuredCallStartsInChunk === 2
        && JSON.stringify(edge.emission.observedStructuredCallResponseFormatNames) === JSON.stringify(['NodeSchemaList', 'EdgeSchemaList']),
      ).length,
      participantCardinalityDistribution: cardinality,
      participantStrings: {
        totalSlots: participantSlots.length,
        exactLiteralInFrozenSource: participantSlots.filter((item) => item.exactSourceHitCount > 0).length,
        exactLiteralInEmittingChunk: participantSlots.filter((item) => item.exactChunk.length > 0).length,
        exactLiteralOnlyOutsideEmittingChunk: participantSlots.filter((item) => item.exactSourceHitCount > 0 && item.exactChunk.length === 0).length,
        slotsWithNearMatchCandidate: nearEntries.length,
        distinctEdgeOccurrencesWithNearMatchCandidate: new Set(nearEntries.map((item) => item.candidateId)).size,
      },
      fullDescriptionLiteralInEmittingChunk: edges.filter((edge) => edge.emission.exactDescriptionHits.length > 0).length,
      fullDescriptionLiteralInFrozenSource: edges.filter((edge) => edge.exactDescriptionInSource.length > 0).length,
      fullDescriptionFoundAfterNfkcWhitespaceNormalization: edges.filter((edge) => edge.normalizedDescriptionOccursInFrozenSource).length,
      edgesWithAllParticipantsLiteralInEmittingChunk: edges.filter((edge) => edge.participantEvidence.every((item) => item.exactChunk.length > 0)).length,
      edgesWithAllParticipantsLiteralInOneBodyZoneAndChunk: edges.filter((edge) => sameZoneAll(edge, 'body')).length,
      edgesWithAllParticipantsLiteralInOneHeaderZoneAndChunk: edges.filter((edge) => sameZoneAll(edge, 'header')).length,
      edgesWithAnyParticipantLiteralInTableHeader: edges.filter((edge) => edge.inspectedEmittingChunkZones.some((zone) =>
        zone.participants.header.some((participant) => participant.matches.length > 0),
      )).length,
      edgesWithExactNonparticipantKeywordInHeader: headerKeywordEdges.length,
      edgesWithExactNonparticipantKeywordInBody: bodyKeywordEdges.length,
      exactNonparticipantKeywordsInHeader: [...new Set(headerKeywordEdges.flatMap((edge) => edge.inspectedEmittingChunkZones.flatMap((zone) =>
        zone.exactKeywordMatches.filter((keyword) => !keyword.participantLiteral && keyword.header.length > 0).map((keyword) => keyword.keyword),
      )))],
      exactNonparticipantKeywordsInBody: [...new Set(bodyKeywordEdges.flatMap((edge) => edge.inspectedEmittingChunkZones.flatMap((zone) =>
        zone.exactKeywordMatches.filter((keyword) => !keyword.participantLiteral && keyword.body.length > 0).map((keyword) => keyword.keyword),
      )))],
      failureFlags: Object.fromEntries([...strictReasons].sort(([a], [b]) => a.localeCompare(b))),
    },
    edges,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, totalEdges: output.summary.totalEdgeOccurrences, byMechanicalClass: classCounts, oneParticipantOutputs: output.summary.oneParticipantOutputs, strictPasses: output.summary.oldValidatorEquivalentPasses }, null, 2));
}

const exactStringsOnly = 'exact literal substring occurrence plus source offsets and hashes; no identity or semantic inference';
main();
