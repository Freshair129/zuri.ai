// Post-extraction v6 lexical validator and exact-source TEXT builder. No inference or QA scoring.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEvidenceRun } from './evidence-adapter-v3.mjs';

const BASE_ROOT = '.local/hyper-relation-audit-20261025/run-5';
const OUTPUT_ROOT = '.local/hyper-relation-audit-20261025/run-5-validator-v6';
const TABLE_NATIVE_INPUT = '.local/thai-table-chunking-20261025/run-v2/native-input.json';
const CONTROL_FIXTURE = 'apps/server/tests/fixtures/genesisrag17-corpus-v1.json';
const REPORT_ROOT = 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256Text = (text) => sha256(Buffer.from(text, 'utf8'));
const readBytes = (file) => fs.readFileSync(file);
const readJson = (file) => JSON.parse(readBytes(file).toString('utf8'));
const writeNew = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

function assertCompleteRun(baseFreeze, baseFreezeSha256, candidate, candidateBytes, chunksFile, bundle, sourceBundleBytes) {
  const plannedCalls = chunksFile.documents.reduce((sum, document) => sum + document.chunks.length, 0);
  if (baseFreeze.runId !== 'run-5' || candidate.runId !== 'run-5' || candidate.status !== 'COMPLETED') {
    throw new Error('v6 validation requires the complete run-5 candidate receipt');
  }
  if (candidate.freezeSha256 !== baseFreezeSha256
    || candidate.sourceBundleSha256 !== baseFreeze.source.sourceBundleSha256
    || candidate.chunksFileSha256 !== baseFreeze.chunkFileSha256
    || sha256(candidateBytes) === '') throw new Error('Candidate receipt does not match the original run-5 freeze');
  if (sha256(sourceBundleBytes) !== baseFreeze.source.sourceBundleFileSha256
    || sha256Text(JSON.stringify(bundle)) !== baseFreeze.source.sourceBundleSha256) {
    throw new Error('Frozen source bundle does not match the original run-5 freeze');
  }
  if (candidate.settings.actualStructuredCallStarts !== plannedCalls
    || candidate.settings.actualStructuredCallResponses !== plannedCalls
    || candidate.settings.actualStructuredCallErrors !== 0
    || candidate.settings.requestConfigurationsMatchFreeze !== true) {
    throw new Error('Run-5 receipt has incomplete or mismatched native extraction calls');
  }
  const actualChunks = candidate.documents.flatMap((document) => document.chunks);
  if (actualChunks.length !== plannedCalls
    || actualChunks.some((chunk) => chunk.callError || chunk.callResponse?.done !== true || chunk.callResponse?.done_reason !== 'stop')) {
    throw new Error('Run-5 contains an incomplete or non-stop chunk response');
  }
  if (candidate.model?.digest !== baseFreeze.inference.modelDigest
    || candidate.model?.contextLengthObserved !== baseFreeze.inference.expectedContextLength
    || candidate.model?.contextLengthAfterExtraction !== baseFreeze.inference.expectedContextLength) {
    throw new Error('Run-5 model digest or observed context differs from its freeze');
  }
  return plannedCalls;
}

function buildProjection(bundle, chunksFile, validation, validatorFreezeSha256, baseFreezeSha256, candidateReceiptSha256) {
  const selectedIds = new Set(validation.facts
    .filter((item) => item.sourceStatus === 'LEXICALLY_GROUNDED_FACT_CANDIDATE')
    .map((item) => item.evidence?.zoneId)
    .filter(Boolean));
  const zones = (bundle.zones || [])
    .filter((zone) => selectedIds.has(zone.id))
    .sort((a, b) => a.rangeId.localeCompare(b.rangeId) || a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd);
  const sourceById = new Map(bundle.sourceRanges.map((source) => [source.id, source]));
  const zoneById = new Map(bundle.zones.map((zone) => [zone.id, zone]));
  const documentChunks = new Map(chunksFile.documents.map((document) => [document.sourceId, document.chunks]));
  for (const fact of validation.facts.filter((item) => item.sourceStatus === 'LEXICALLY_GROUNDED_FACT_CANDIDATE')) {
    const source = sourceById.get(fact.sourceId);
    const zone = zoneById.get(fact.evidence?.zoneId);
    const chunk = (documentChunks.get(fact.sourceId) || []).find((item) => item.chunkIndex === fact.chunkIndex);
    if (!source || !zone || !chunk || zone.rangeId !== fact.sourceId) throw new Error(`v6 evidence references an unknown source/zone/chunk: ${fact.candidateId}`);
    for (const span of [fact.evidence.subject, fact.evidence.value, fact.evidence.header]) {
      const sourceOffset = span.sourceStart - source.sourceStart;
      const chunkOffset = span.sourceStart - chunk.sourceStart;
      if (span.zoneId !== zone.id || span.sourceStart < zone.sourceStart || span.sourceEnd > zone.sourceEnd
        || source.text.slice(sourceOffset, sourceOffset + span.quote.length) !== span.quote
        || chunkOffset !== span.chunkTextStart || chunk.inputText.slice(chunkOffset, chunkOffset + span.quote.length) !== span.quote) {
        throw new Error(`v6 atomic evidence span no longer matches its frozen source zone and emitting chunk: ${fact.candidateId}`);
      }
    }
  }
  const snippets = zones.map((zone) => {
    const source = sourceById.get(zone.rangeId);
    if (!source) throw new Error(`Selected zone references unknown frozen source: ${zone.id}`);
    const localStart = zone.sourceStart - source.sourceStart;
    const localEnd = zone.sourceEnd - source.sourceStart;
    if (source.text.slice(localStart, localEnd) !== zone.text) throw new Error(`Selected zone is not an exact frozen source slice: ${zone.id}`);
    return {
      zoneId: zone.id,
      sourceId: zone.rangeId,
      sourceStart: zone.sourceStart,
      sourceEnd: zone.sourceEnd,
      text: zone.text,
      sourceTextSha256: sha256Text(zone.text),
    };
  });
  const text = snippets.map((snippet) => snippet.text).join('\n\n');
  const sourceChars = bundle.sourceChars;
  const selectedSourceChars = snippets.reduce((sum, snippet) => sum + snippet.text.length, 0);
  const validated = {
    schema: 'zuri.hyper-relation-evidence-validation-receipt.v3',
    runId: 'run-5',
    validatorRevision: 'v6-atomic-cell-header-binding',
    validatorFreezeSha256,
    inferenceFreezeSha256: baseFreezeSha256,
    candidateReceiptSha256,
    sourceBundleSha256: validation.sourceBundleSha256,
    graphAdmission: 'NONE; native interface accepts TEXT only; candidate facts/relations remain sidecar data',
    semanticStatus: 'NOT_ASSESSED',
    summary: validation.summary,
    facts: validation.facts,
    relations: validation.relations,
  };
  const validationObjectSha256 = sha256Text(JSON.stringify(validated));
  const projection = {
    schema: 'zuri.hyper-relation-source-text-projection.v3',
    type: 'budgeted evidence-guided subset of frozen Paddle OCR source zones',
    runId: 'run-5',
    validatorRevision: 'v6-atomic-cell-header-binding',
    validatorFreezeSha256,
    inferenceFreezeSha256: baseFreezeSha256,
    candidateReceiptSha256,
    validationObjectSha256,
    sourceBundleSha256: validation.sourceBundleSha256,
    text,
    textSha256: sha256Text(text),
    snippets,
    selectedZones: snippets.length,
    totalZones: bundle.zoneCount,
    selectedSourceChars,
    totalSourceChars: sourceChars,
    omittedSourceChars: sourceChars - selectedSourceChars,
    coveragePct: sourceChars ? Number((selectedSourceChars / sourceChars * 100).toFixed(2)) : 0,
    sourceTextOnly: true,
    candidateDescriptionsIncluded: false,
    candidateGraphIncluded: false,
    semanticStatus: 'NOT_ASSESSED',
    graphAdmission: validated.graphAdmission,
  };
  return { validated, validationObjectSha256, projection };
}

function buildNativeInput({ original, control, bundle, validation, projection, validatorFreezeSha256, inferenceFreezeSha256, candidateReceiptSha256 }) {
  const tableArm = original.arms.find((arm) => arm.parser === 'table');
  if (!tableArm || tableArm.ranges.length !== bundle.sourceRanges.length) throw new Error('Original frozen table arm not found');
  const controlPrefix = tableArm.content.slice(0, tableArm.ranges[0].start);
  const expectedPrefix = `${control.text}\n\n# Public PDF ${bundle.sourceRanges[0].id}\n\n`;
  if (controlPrefix !== expectedPrefix) throw new Error('Control/source prefix differs from the original table arm');

  const sourceById = new Map(bundle.sourceRanges.map((source) => [source.id, source]));
  const ranges = [];
  let cursor = controlPrefix.length;
  for (const [index, snippet] of projection.snippets.entries()) {
    const source = sourceById.get(snippet.sourceId);
    if (!source) throw new Error(`Projection references unknown source id: ${snippet.sourceId}`);
    const localStart = snippet.sourceStart - source.sourceStart;
    const localEnd = snippet.sourceEnd - source.sourceStart;
    if (source.text.slice(localStart, localEnd) !== snippet.text || sha256Text(snippet.text) !== snippet.sourceTextSha256) {
      throw new Error(`Projected zone is not an exact frozen source slice: ${snippet.zoneId}`);
    }
    if (index > 0) cursor += 2;
    const start = cursor;
    const end = start + snippet.text.length;
    ranges.push({
      id: snippet.zoneId,
      doc: snippet.sourceId,
      zoneId: snippet.zoneId,
      start,
      end,
      pdfSha256: source.pdfSha256,
      textSha256: snippet.sourceTextSha256,
      chars: snippet.text.length,
    });
    cursor = end;
  }
  const content = controlPrefix + projection.text;
  if (cursor !== content.length) throw new Error('Native ranges do not exactly cover assembled source text');
  const arm = {
    parser: 'hyper-evidence-v6',
    content,
    contentSha256: sha256Text(content),
    ranges,
    projection: {
      type: projection.type,
      sourceBundleSha256: projection.sourceBundleSha256,
      inferenceFreezeSha256,
      validatorFreezeSha256,
      candidateReceiptSha256,
      validationObjectSha256: projection.validationObjectSha256,
      sourceTextSha256: projection.textSha256,
      selectedZones: projection.selectedZones,
      totalZones: projection.totalZones,
      selectedSourceChars: projection.selectedSourceChars,
      totalSourceChars: projection.totalSourceChars,
      omittedSourceChars: projection.omittedSourceChars,
      graphFieldsIncluded: false,
      candidateTextIncluded: false,
      semanticStatus: 'NOT_ASSESSED',
    },
  };
  const result = {
    ...original,
    arms: [...original.arms, arm],
    hyperCandidateSidecar: {
      admission: 'sidecar only; no evidence-aware candidate values were submitted to GKS',
      graphStatus: validation.graphAdmission,
      candidateReceiptSha256,
      validationObjectSha256: projection.validationObjectSha256,
      inferenceFreezeSha256,
      validatorFreezeSha256,
      semanticStatus: 'NOT_ASSESSED',
    },
  };
  for (const parser of ['plain', 'table']) {
    const before = original.arms.find((item) => item.parser === parser);
    const after = result.arms.find((item) => item.parser === parser);
    if (!before || !after || before.contentSha256 !== after.contentSha256 || before.content !== after.content) {
      throw new Error(`Frozen baseline ${parser} arm changed while adding v6 evidence subset`);
    }
  }
  return { result, arm };
}

const outDir = path.resolve(OUTPUT_ROOT);
if (fs.existsSync(outDir)) throw new Error(`Refusing to overwrite existing v6 output directory: ${outDir}`);
const baseFreezeBytes = readBytes(`${BASE_ROOT}/freeze.json`);
const baseCandidateBytes = readBytes(`${BASE_ROOT}/evidence-candidates.json`);
const chunksBytes = readBytes(`${BASE_ROOT}/chunks.json`);
const sourceBundleBytes = readBytes(`${BASE_ROOT}/source-bundle.json`);
const baseFreezeSha256 = sha256(baseFreezeBytes);
const candidateReceiptSha256 = sha256(baseCandidateBytes);
const baseFreeze = JSON.parse(baseFreezeBytes.toString('utf8'));
const candidates = JSON.parse(baseCandidateBytes.toString('utf8'));
const chunksFile = JSON.parse(chunksBytes.toString('utf8'));
const bundle = JSON.parse(sourceBundleBytes.toString('utf8'));
assertCompleteRun(baseFreeze, baseFreezeSha256, candidates, baseCandidateBytes, chunksFile, bundle, sourceBundleBytes);
if (sha256(chunksBytes) !== baseFreeze.chunkFileSha256) throw new Error('Run-5 chunk input hash mismatch');

const v6Freeze = {
  schema: 'zuri.hyper-relation-evidence-validator-freeze.v1',
  validatorRevision: 'v6-atomic-cell-header-binding',
  createdAt: new Date().toISOString(),
  inference: {
    runId: 'run-5',
    freezeSha256: baseFreezeSha256,
    candidateReceiptSha256,
    sourceBundleSha256: baseFreeze.source.sourceBundleSha256,
    sourceBundleFileSha256: sha256(sourceBundleBytes),
    chunkFileSha256: sha256(chunksBytes),
    modelDigest: candidates.model.digest,
    completedCalls: candidates.settings.actualStructuredCallResponses,
    relationsEmitted: candidates.documents.reduce((sum, document) => sum + document.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.relations.length, 0), 0),
  },
  validator: {
    adapterSourceSha256: sha256(readBytes(`${REPORT_ROOT}/evidence-adapter-v3.mjs`)),
    adapterTestsSha256: sha256(readBytes(`${REPORT_ROOT}/evidence-adapter-v3.test.mjs`)),
    builderSourceSha256: sha256(readBytes(fileURLToPath(import.meta.url))),
    rule: 'Table fact is lexically grounded only when exact full subject-cell, value-cell and header-cell strings resolve uniquely to one frozen row/header binding, and all three exact spans lie within the same emitting chunk. Candidate rowQuote, evidenceQuote, tableId, rowLabel and valueColumnIndex are retained as audit metadata, not silently repaired or used as evidence. Semantic status remains NOT_ASSESSED.',
  },
  limits: {
    sourceBundleIsFrozenPaddleText: true,
    goldOrQuestionsUsedForValidationOrProjection: false,
    manualSemanticAuditUsedForValidationOrProjection: false,
    candidateGraphAdmission: 'NONE; TEXT-only native projection',
  },
};
const v6FreezeBytes = Buffer.from(`${JSON.stringify(v6Freeze, null, 2)}\n`, 'utf8');
const validatorFreezeSha256 = sha256(v6FreezeBytes);

const validationResult = validateEvidenceRun(bundle, baseFreeze, candidates, { freezeSha256: baseFreezeSha256 });
if (validationResult.validation.runDisposition !== 'COMPLETED_EXTRACTION_CANDIDATES') {
  throw new Error('Only complete run-5 candidate output may be validated');
}
const { validated, validationObjectSha256, projection } = buildProjection(
  bundle,
  chunksFile,
  { ...validationResult.validation, sourceBundleSha256: baseFreeze.source.sourceBundleSha256 },
  validatorFreezeSha256,
  baseFreezeSha256,
  candidateReceiptSha256,
);
const original = readJson(TABLE_NATIVE_INPUT);
const control = readJson(CONTROL_FIXTURE);
const native = buildNativeInput({
  original,
  control,
  bundle,
  validation: validated,
  projection,
  validatorFreezeSha256,
  inferenceFreezeSha256: baseFreezeSha256,
  candidateReceiptSha256,
});

fs.mkdirSync(outDir, { recursive: false });
writeNew(path.join(outDir, 'validator-freeze.json'), v6Freeze);
writeNew(path.join(outDir, 'validated-evidence.json'), validated);
writeNew(path.join(outDir, 'source-projection.json'), projection);
writeNew(path.join(outDir, 'native-input.json'), native.result);
writeNew(path.join(outDir, 'build-summary.json'), {
  status: 'BUILT_V6_EXACT_SOURCE_TEXT_SUBSET',
  validatorFreezeSha256,
  inferenceFreezeSha256: baseFreezeSha256,
  candidateReceiptSha256,
  validationObjectSha256,
  sourceBundleSha256: baseFreeze.source.sourceBundleSha256,
  arm: native.arm.parser,
  nativeArmChars: native.arm.content.length,
  selectedSourceZones: native.arm.ranges.length,
  totalSourceZones: projection.totalZones,
  selectedSourceChars: projection.selectedSourceChars,
  totalSourceChars: projection.totalSourceChars,
  sourceCoveragePct: projection.coveragePct,
  facts: validated.summary.facts,
  relations: validated.summary.relations,
  graphSubmittedToGks: false,
  semanticStatus: 'NOT_ASSESSED',
  goldOrQuestionsUsedByValidatorOrProjection: false,
});
console.log(JSON.stringify({ status: 'BUILT_V6_EXACT_SOURCE_TEXT_SUBSET', output: OUTPUT_ROOT, validatorFreezeSha256, ...JSON.parse(readBytes(path.join(outDir, 'build-summary.json')).toString('utf8')) }, null, 2));
