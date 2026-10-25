import crypto from 'node:crypto';
import fs from 'node:fs';

import { validateEvidenceRun } from './evidence-adapter-v2.mjs';

const RUN_ROOT = '.local/hyper-relation-audit-20261025/run-5';
const INPUT_PATH = '.local/thai-table-chunking-20261025/run-v2/native-input.json';
const CONTROL_PATH = 'apps/server/tests/fixtures/genesisrag17-corpus-v1.json';
const DRY_ROOT = '.local/hyper-relation-audit-20261025/run-5/dry-contract';
const sha256Bytes = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha256Text = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function assertActualRun(freeze, receipt, receiptBytes, freezeSha256) {
  const inference = freeze.inference;
  const plannedCalls = freeze.chunkManifest.reduce((sum, doc) => sum + doc.chunks.length, 0);
  if (receipt.status !== 'COMPLETED' || receipt.runId !== freeze.runId) throw new Error('Native build requires a completed run5 receipt');
  if (receipt.freezeSha256 !== freezeSha256 || receipt.sourceBundleSha256 !== freeze.source.sourceBundleSha256) {
    throw new Error('Candidate receipt does not bind the exact freeze/source bundle');
  }
  if (receipt.candidateSchemaSha256 !== freeze.candidateSchemaSha256) throw new Error('Candidate schema hash differs from freeze');
  if (receipt.model?.tag !== inference.modelTag || receipt.model?.digest !== inference.modelDigest) throw new Error('Candidate model tag/digest differs from freeze');
  if (receipt.model?.contextLengthObserved !== inference.expectedContextLength
    || receipt.model?.contextLengthAfterExtraction !== inference.expectedContextLength) {
    throw new Error('Observed Ollama context differs from frozen context');
  }
  const settings = receipt.settings || {};
  if (settings.endpoint !== inference.endpoint
    || settings.structuredOutputMethod !== inference.structuredOutputMethod
    || settings.chunkSizeChars !== inference.chunkSizeChars
    || settings.chunkOverlapChars !== inference.chunkOverlapChars
    || settings.maxWorkers !== inference.maxWorkers
    || settings.temperature !== inference.temperature
    || settings.maxOutputTokens !== inference.maxOutputTokens
    || settings.numPredict !== inference.numPredict
    || settings.numCtx !== inference.numCtx
    || settings.maxRetries !== inference.maxRetries
    || settings.perCallTimeoutSeconds !== inference.perCallTimeoutSeconds
    || JSON.stringify(settings.candidateLimits) !== JSON.stringify(inference.candidateLimits)
    || settings.actualStructuredCallStarts !== plannedCalls
    || settings.actualStructuredCallResponses !== plannedCalls
    || settings.actualStructuredCallErrors !== 0
    || settings.outgoingRequestSchemaSha256 !== freeze.candidateSchemaSha256
    || settings.outgoingRelationParticipantsMinItems !== 2
    || settings.outgoingRequestSchemaStableAcrossCalls !== true
    || settings.requestConfigurationsMatchFreeze !== true) {
    throw new Error('Candidate inference settings/call counts differ from freeze');
  }
  if (receipt.requestBodies?.length !== plannedCalls) throw new Error('Candidate request body count differs from planned chunks');
  for (const request of receipt.requestBodies) {
    if (request.endpoint !== inference.endpoint
      || request.model !== inference.modelTag
      || request.format !== 'json_schema'
      || request.requestSchemaSha256 !== freeze.candidateSchemaSha256
      || request.relationParticipantsMinItems !== 2
      || request.factCandidatesMaxItems !== inference.candidateLimits.factCandidatesPerChunk
      || request.relationCandidatesMaxItems !== inference.candidateLimits.relationCandidatesPerChunk
      || JSON.stringify(request.candidateLimits) !== JSON.stringify(inference.candidateLimits)
      || request.numCtx !== inference.numCtx
      || request.numPredict !== inference.numPredict
      || request.temperature !== inference.temperature
      || request.think !== inference.thinkingRequest
      || request.stream !== false) {
      throw new Error('An actual native /api/chat request differs from the frozen JSON Schema/model/context/output settings');
    }
  }
  if (sha256Bytes(receiptBytes) === '') throw new Error('Candidate receipt hash could not be computed');
}

function makeProjection(bundle, freeze, receipt, validationResult, freezeSha256, candidateReceiptSha256) {
  const selected = new Set(validationResult.projection.zoneIds);
  const snippets = (bundle.zones || []).filter((zone) => selected.has(zone.id)).map((zone) => ({
    zoneId: zone.id,
    sourceId: zone.rangeId,
    sourceStart: zone.sourceStart,
    sourceEnd: zone.sourceEnd,
    text: zone.text,
    sourceTextSha256: sha256Text(zone.text),
  }));
  const text = snippets.map((snippet) => snippet.text).join('\n\n');
  if (text !== validationResult.projection.content) throw new Error('Validated source-zone order/content changed while preparing native projection');
  const validation = {
    schema: 'zuri.hyper-relation-evidence-validation-receipt.v2',
    runId: freeze.runId,
    runDisposition: validationResult.validation.runDisposition,
    freezeSha256,
    candidateReceiptSha256,
    sourceBundleSha256: freeze.source.sourceBundleSha256,
    graphAdmission: 'NONE; current GenesisRAG17 interface accepts TEXT only; evidence-aware facts/relations remain candidate sidecar data',
    semanticStatus: 'NOT_ASSESSED',
    summary: validationResult.validation.summary,
    facts: validationResult.validation.facts,
    relations: validationResult.validation.relations,
  };
  const validationSha256 = sha256Text(JSON.stringify(validation));
  const selectedSourceChars = snippets.reduce((sum, snippet) => sum + snippet.text.length, 0);
  return {
    validation,
    validationSha256,
    projection: {
      schema: 'zuri.hyper-relation-source-text-projection.v2',
      type: 'evidence-guided subset of frozen Paddle OCR source zones',
      runId: freeze.runId,
      freezeSha256,
      candidateReceiptSha256,
      sourceBundleSha256: freeze.source.sourceBundleSha256,
      validationSha256,
      text,
      textSha256: sha256Text(text),
      snippets,
      selectedZones: snippets.length,
      totalZones: bundle.zoneCount,
      selectedSourceChars,
      totalSourceChars: bundle.sourceChars,
      omittedSourceChars: bundle.sourceChars - selectedSourceChars,
      coveragePct: bundle.sourceChars ? Number((selectedSourceChars / bundle.sourceChars * 100).toFixed(2)) : 0,
      sourceTextOnly: true,
      candidateDescriptionsIncluded: false,
      candidateGraphIncluded: false,
      semanticStatus: 'NOT_ASSESSED',
      graphAdmission: validation.graphAdmission,
    },
  };
}

function buildNativeInput({ original, control, bundle, freeze, validation, projection, freezeSha256, candidateReceiptSha256 }) {
  const tableArm = original.arms.find((arm) => arm.parser === 'table');
  if (!tableArm || tableArm.ranges.length !== bundle.sourceRanges.length) throw new Error('Frozen native table arm not found');
  const controlPrefix = tableArm.content.slice(0, tableArm.ranges[0].start);
  const expectedPrefix = `${control.text}\n\n# Public PDF ${bundle.sourceRanges[0].id}\n\n`;
  if (controlPrefix !== expectedPrefix) throw new Error('Native input control/source prefix differs from prior frozen input');

  const sourceById = new Map(bundle.sourceRanges.map((range) => [range.id, range]));
  const ranges = [];
  let cursor = controlPrefix.length;
  for (const [index, snippet] of projection.snippets.entries()) {
    const source = sourceById.get(snippet.sourceId);
    if (!source) throw new Error(`Projection references unknown source ${snippet.sourceId}`);
    const localStart = snippet.sourceStart - source.sourceStart;
    const localEnd = snippet.sourceEnd - source.sourceStart;
    if (source.text.slice(localStart, localEnd) !== snippet.text || sha256Text(snippet.text) !== snippet.sourceTextSha256) {
      throw new Error(`Projection snippet is not an exact frozen source slice: ${snippet.zoneId}`);
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
  if (cursor !== content.length) throw new Error('Native source ranges do not cover assembled content');

  const hyperArm = {
    parser: 'hyper-evidence',
    content,
    contentSha256: sha256Text(content),
    ranges,
    projection: {
      type: projection.type,
      sourceBundleSha256: projection.sourceBundleSha256,
      freezeSha256,
      candidateReceiptSha256,
      validationSha256: projection.validationSha256,
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
  const output = {
    ...original,
    arms: [...original.arms, hyperArm],
    hyperCandidateSidecar: {
      admission: 'sidecar only; no evidence-aware candidate values were submitted to GKS',
      graphStatus: validation.graphAdmission,
      candidateReceiptSha256,
      validationSha256: projection.validationSha256,
      freezeSha256,
      semanticStatus: 'NOT_ASSESSED',
    },
  };
  for (const baselineParser of ['plain', 'table']) {
    const before = original.arms.find((arm) => arm.parser === baselineParser);
    const after = output.arms.find((arm) => arm.parser === baselineParser);
    if (!before || !after || before.contentSha256 !== after.contentSha256 || before.content !== after.content) {
      throw new Error(`Frozen ${baselineParser} arm changed while adding the evidence subset`);
    }
  }
  return { output, hyperArm };
}

function makeDryReceipt(freeze, chunksFile, freezeSha256) {
  return {
    schema: 'zuri.hyper-relation-evidence-aware-candidates.v2',
    runId: freeze.runId,
    status: 'DRY_RUN_EMPTY',
    dryRun: true,
    freezeSha256,
    sourceBundleSha256: freeze.source.sourceBundleSha256,
    documents: chunksFile.documents.map((doc) => ({
      sourceId: doc.sourceId,
      sourceTextSha256: doc.sourceTextSha256,
      chunks: doc.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        sourceStart: chunk.sourceStart,
        sourceEnd: chunk.sourceEnd,
        inputText: chunk.inputText,
        textSha256: chunk.textSha256,
        facts: [],
        relations: [],
      })),
    })),
  };
}

function main() {
  const dry = process.argv.includes('--dry');
  const freezeBytes = fs.readFileSync(`${RUN_ROOT}/freeze.json`);
  const freezeSha256 = sha256Bytes(freezeBytes);
  const freeze = JSON.parse(freezeBytes.toString('utf8'));
  const frozenSources = [
    ['runnerSha256', 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/extract-evidence-native-v5.py'],
    ['adapterSha256', 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/evidence-adapter-v2.mjs'],
    ['testsSha256', 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/evidence-adapter-v2.test.mjs'],
    ['runnerTestSha256', 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/test-evidence-runner-v5.py'],
    ['promptSha256', 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/evidence-prompt-budgeted.md'],
    ['schemaSourceSha256', 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/evidence_schema_budgeted.py'],
    ['validationRunnerSha256', 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/validate-and-build-native-v5.mjs'],
    ['preparationRunnerSha256', 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/prepare-evidence-run5.py'],
  ];
  for (const [key, path] of frozenSources) {
    if (sha256Bytes(fs.readFileSync(path)) !== freeze.hashes[key]) throw new Error(`Frozen run source changed: ${path}`);
  }
  const bundleBytes = fs.readFileSync(`${RUN_ROOT}/source-bundle.json`);
  const bundle = JSON.parse(bundleBytes.toString('utf8'));
  const chunksFile = readJson(`${RUN_ROOT}/chunks.json`);
  if (sha256Bytes(bundleBytes) !== freeze.source.sourceBundleFileSha256) throw new Error('Frozen source bundle file hash mismatch');
  if (sha256Text(JSON.stringify(bundle)) !== freeze.source.sourceBundleSha256) throw new Error('Frozen source bundle object hash mismatch');

  const original = readJson(INPUT_PATH);
  const control = readJson(CONTROL_PATH);
  let receiptBytes;
  let receipt;
  if (dry) {
    receipt = makeDryReceipt(freeze, chunksFile, freezeSha256);
    receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  } else {
    receiptBytes = fs.readFileSync(`${RUN_ROOT}/evidence-candidates.json`);
    receipt = JSON.parse(receiptBytes.toString('utf8'));
    if (sha256Bytes(fs.readFileSync(`${RUN_ROOT}/chunks.json`)) !== freeze.chunkFileSha256) throw new Error('Frozen chunk input hash mismatch');
    assertActualRun(freeze, receipt, receiptBytes, freezeSha256);
  }
  const candidateReceiptSha256 = sha256Bytes(receiptBytes);
  const validationResult = validateEvidenceRun(bundle, freeze, receipt, {
    freezeSha256,
    allowDryRunEmpty: dry,
  });
  if (dry && validationResult.validation.runDisposition !== 'DRY_RUN_SHAPE_ONLY') {
    throw new Error('Dry contract check must never report extraction completion');
  }
  if (!dry && validationResult.validation.runDisposition !== 'COMPLETED_EXTRACTION_CANDIDATES') {
    throw new Error('Only complete extraction candidates may build the scored native arm');
  }
  const built = makeProjection(bundle, freeze, receipt, validationResult, freezeSha256, candidateReceiptSha256);
  const native = buildNativeInput({
    original,
    control,
    bundle,
    freeze,
    validation: built.validation,
    projection: built.projection,
    freezeSha256,
    candidateReceiptSha256,
  });

  if (dry) {
    fs.mkdirSync(DRY_ROOT, { recursive: true });
    const target = `${DRY_ROOT}/native-input.json`;
    const statusTarget = `${DRY_ROOT}/contract-check.json`;
    if (fs.existsSync(target) || fs.existsSync(statusTarget)) throw new Error('Refusing to overwrite dry contract artifacts');
    fs.writeFileSync(target, JSON.stringify(native.output, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(statusTarget, JSON.stringify({
      status: 'DRY_RUN_SHAPE_ONLY',
      extractionPerformed: false,
      candidateCount: 0,
      validatedFactCount: 0,
      validatedRelationCount: 0,
      projectedSourceZones: native.hyperArm.ranges.length,
      nativeInputHash: native.hyperArm.contentSha256,
      goldOrQuestionsUsedByExtractorOrValidator: false,
      goldOrQuestionsSentToModel: false,
    }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({
      status: 'DRY_RUN_SHAPE_ONLY',
      nativeInput: target,
      arm: native.hyperArm.parser,
      armChars: native.hyperArm.content.length,
      projectedSourceZones: native.hyperArm.ranges.length,
      validatedFactCount: 0,
      validatedRelationCount: 0,
      extractionPerformed: false,
    }, null, 2));
    return;
  }

  const validatedPath = `${RUN_ROOT}/validated-evidence.json`;
  const projectionPath = `${RUN_ROOT}/source-projection.json`;
  const nativeInputPath = `${RUN_ROOT}/native-input.json`;
  for (const path of [validatedPath, projectionPath, nativeInputPath]) {
    if (fs.existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
  }
  fs.writeFileSync(validatedPath, JSON.stringify(built.validation, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(projectionPath, JSON.stringify(built.projection, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(nativeInputPath, JSON.stringify(native.output, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({
    status: 'BUILT_EXACT_SOURCE_TEXT_SUBSET',
    nativeInput: nativeInputPath,
    arm: native.hyperArm.parser,
    armChars: native.hyperArm.content.length,
    selectedSourceZones: native.hyperArm.ranges.length,
    sourceCoveragePct: built.projection.coveragePct,
    facts: built.validation.summary.facts,
    relations: built.validation.summary.relations,
    graphSubmittedToGks: false,
  }, null, 2));
}

main();
