import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

type JsonObject = Record<string, unknown>;
type Decision = 'classified' | 'review_required' | 'unclassified';

const root = path.resolve(process.cwd());
const inputPath = path.resolve(
  process.env.GENESIS_AUTHORING_INPUT_PATH ||
    './data/catalog_vector_benchmark_round1_v1/authoring-input-round1.json'
);
const outputDir = path.resolve(
  process.env.GENESIS_AUTHORING_OUTPUT_DIR ||
    './data/catalog_vector_benchmark_round1_v1'
);
const baselinePath = path.resolve(
  process.env.GENESIS_IDENTITY_REVIEW_PATH ||
    './data/catalog_identity_review_v1/identity-review.json'
);
const ownerPath = path.resolve(
  process.env.GENESIS_USER_LOGIC_REVIEW_PATH ||
    './data/catalog_identity_review_user_logic_v1/identity-review.json'
);
const files = {
  luna: path.join(outputDir, 'luna-noemb.json'),
  sol: path.join(outputDir, 'sol-noemb.json'),
};

const promptContract = "Run the no-embedding authoring benchmark. Read only data/catalog_vector_benchmark_round1_v1/authoring-input-round1.json. Do not read the existing user-logic spec, user-logic report, owner-logic artifact, taxonomy projection report, internet, or any other catalog output. Do not modify files. Independently classify all 55 baseline-unclassified ProductMaster records using only the source evidence in the input and these rules: preserve productId and offerId values exactly; do not invent product IDs; colors, branding, packaging, sizes, and years are attributes/options unless source evidence proves a physical product change; if evidence is insufficient return unclassified; use lowercase snake_case typeId values; return exactly one JSON object with schemaVersion, decisionMode='llm_no_embedding_v1', records[]. Each record must contain productId, decision (classified|review_required|unclassified), typeId, parentTypeId, subtypeId, confidence (0..1), reasonCodes, evidenceOfferIds, and rationale. Include all 55 records exactly once. Output JSON only, with no markdown fences or commentary.";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as JsonObject;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

function fileSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as any;
}

function countByDecision(records: Array<{ decision: Decision }>): Record<string, number> {
  return Object.fromEntries(
    (['classified', 'review_required', 'unclassified'] as Decision[]).map((decision) => [
      decision,
      records.filter((record) => record.decision === decision).length,
    ])
  );
}

function sortedUnique(values: unknown): string[] {
  return [...new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [])].sort();
}

const input = readJson(inputPath) as {
  inputId: string;
  datasetId: string;
  sourceSnapshotId: string;
  records: Array<{
    productId: string;
    displayName: string;
    offers: Array<{ offerId: string }>;
  }>;
};
const owner = readJson(ownerPath) as {
  snapshotId: string;
  productMasters: Array<{
    productId: string;
    typeStatus: string;
    typeId: string | null;
    parentTypeId: string | null;
    subtypeId: string | null;
    decision: Decision;
  }>;
};
const baseline = readJson(baselinePath) as { snapshotId: string };
const expectedIds = new Set(input.records.map((record) => record.productId));
const offerIdsByProductId = new Map(input.records.map((record) => [record.productId, new Set(record.offers.map((offer) => offer.offerId))]));
const ownerReference = new Map(
  owner.productMasters
    .filter((record) => expectedIds.has(record.productId) && record.typeStatus === 'classified' && record.typeId)
    .map((record) => [record.productId, record])
);

function evaluateModel(modelKey: 'luna' | 'sol', modelId: string) {
  const filePath = files[modelKey];
  if (!fs.existsSync(filePath)) throw new Error(`Missing model output: ${filePath}`);
  const parsed = readJson(filePath) as {
    schemaVersion: number;
    decisionMode: string;
    records: Array<{
      productId: string;
      decision: Decision;
      typeId: string | null;
      parentTypeId: string | null;
      subtypeId: string | null;
      confidence: number;
      reasonCodes: string[];
      evidenceOfferIds: string[];
      rationale: string;
    }>;
  };
  const errors: Array<{ productId?: string; code: string; detail?: string }> = [];
  if (parsed.schemaVersion !== 1) errors.push({ code: 'schema_version_invalid' });
  if (parsed.decisionMode !== 'llm_no_embedding_v1') errors.push({ code: 'decision_mode_invalid' });
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!record || typeof record.productId !== 'string') {
      errors.push({ code: 'product_id_missing' });
      continue;
    }
    if (seen.has(record.productId)) errors.push({ productId: record.productId, code: 'duplicate_product_id' });
    seen.add(record.productId);
    if (!expectedIds.has(record.productId)) errors.push({ productId: record.productId, code: 'invented_product_id' });
    if (!['classified', 'review_required', 'unclassified'].includes(record.decision)) errors.push({ productId: record.productId, code: 'decision_invalid' });
    if (typeof record.confidence !== 'number' || record.confidence < 0 || record.confidence > 1) errors.push({ productId: record.productId, code: 'confidence_invalid' });
    if (!Array.isArray(record.reasonCodes)) errors.push({ productId: record.productId, code: 'reason_codes_missing' });
    if (!Array.isArray(record.evidenceOfferIds)) errors.push({ productId: record.productId, code: 'evidence_offer_ids_missing' });
    const allowedOffers = offerIdsByProductId.get(record.productId) || new Set<string>();
    for (const offerId of sortedUnique(record.evidenceOfferIds)) {
      if (!allowedOffers.has(offerId)) errors.push({ productId: record.productId, code: 'evidence_offer_id_out_of_scope', detail: offerId });
    }
    if (typeof record.rationale !== 'string' || !record.rationale.trim()) errors.push({ productId: record.productId, code: 'rationale_missing' });
  }
  const missingIds = [...expectedIds].filter((productId) => !seen.has(productId)).sort();
  for (const productId of missingIds) errors.push({ productId, code: 'missing_product_id' });
  const validRecords = records.filter((record) => expectedIds.has(record.productId));
  const referenceRows = [...ownerReference.entries()].map(([productId, reference]) => {
    const prediction = validRecords.find((record) => record.productId === productId);
    return {
      productId,
      referenceTypeId: reference.typeId,
      referenceDecision: reference.decision,
      predictedTypeId: prediction?.typeId || null,
      predictedDecision: prediction?.decision || null,
      typeAgreement: Boolean(prediction && prediction.typeId === reference.typeId),
      decisionAgreement: Boolean(prediction && prediction.decision === reference.decision),
      usableMapping: Boolean(prediction && prediction.typeId === reference.typeId && prediction.decision !== 'unclassified'),
    };
  });
  return {
    modelKey,
    modelId,
    sourceArtifact: path.basename(filePath),
    sourceArtifactSha256: fileSha256(filePath),
    schemaValid: errors.length === 0,
    recordCount: records.length,
    expectedRecordCount: input.records.length,
    uniqueProductIdCount: seen.size,
    decisionCounts: countByDecision(validRecords),
    actionableCoverage: validRecords.filter((record) => record.decision !== 'unclassified').length / input.records.length,
    ownerReferenceCount: referenceRows.length,
    ownerTypeAgreement: referenceRows.length ? referenceRows.filter((row) => row.typeAgreement).length / referenceRows.length : null,
    ownerDecisionAgreement: referenceRows.length ? referenceRows.filter((row) => row.decisionAgreement).length / referenceRows.length : null,
    ownerUsableMappingRate: referenceRows.length ? referenceRows.filter((row) => row.usableMapping).length / referenceRows.length : null,
    referenceRows,
    errors,
  };
}

const luna = evaluateModel('luna', 'gpt-5.6-luna');
const sol = evaluateModel('sol', 'gpt-5.6-sol');
const lunaById = new Map(readJson(files.luna).records.map((record: { productId: string }) => [record.productId, record]));
const solById = new Map(readJson(files.sol).records.map((record: { productId: string }) => [record.productId, record]));
const comparisonRows = [...expectedIds].sort().map((productId) => {
  const left = lunaById.get(productId) as { decision?: string; typeId?: string | null } | undefined;
  const right = solById.get(productId) as { decision?: string; typeId?: string | null } | undefined;
  return {
    productId,
    decisionAgreement: Boolean(left && right && left.decision === right.decision),
    typeAgreement: Boolean(left && right && left.typeId === right.typeId),
    jointAgreement: Boolean(left && right && left.decision === right.decision && left.typeId === right.typeId),
    lunaDecision: left?.decision || null,
    solDecision: right?.decision || null,
    lunaTypeId: left?.typeId || null,
    solTypeId: right?.typeId || null,
  };
});
const modelComparison = {
  pairCount: comparisonRows.length,
  decisionAgreementCount: comparisonRows.filter((row) => row.decisionAgreement).length,
  decisionAgreementRate: comparisonRows.filter((row) => row.decisionAgreement).length / comparisonRows.length,
  typeAgreementCount: comparisonRows.filter((row) => row.typeAgreement).length,
  typeAgreementRate: comparisonRows.filter((row) => row.typeAgreement).length / comparisonRows.length,
  jointAgreementCount: comparisonRows.filter((row) => row.jointAgreement).length,
  jointAgreementRate: comparisonRows.filter((row) => row.jointAgreement).length / comparisonRows.length,
  differingProductIds: comparisonRows.filter((row) => !row.jointAgreement).map((row) => row.productId),
};

const startedAt = process.env.GENESIS_AUTHORING_STARTED_AT || '2026-08-23T02:30:19.000Z';
const endedAt = new Date(Math.max(fs.statSync(files.luna).mtimeMs, fs.statSync(files.sol).mtimeMs)).toISOString();
const datasetRevisionId = `DSR1_${sha256(`${input.datasetId}|cohort-definition-r1-v1`).slice(0, 20)}`;
const config = {
  protocolVersion: 'authoring-factorial-round1-v1',
  inputId: input.inputId,
  datasetId: input.datasetId,
  datasetRevisionId,
  promptContractId: 'LLM_PROMPT_NOEMB_R1_V1',
  promptHash: sha256(promptContract),
  outputSchema: 'llm_no_embedding_v1',
  candidateSource: 'none_embedding_exact_input_only',
  models: ['gpt-5.6-luna', 'gpt-5.6-sol'],
};
const configHash = sha256(stableJson(config));
const benchmarkId = `BMR1_${datasetRevisionId.slice(5, 17)}_authoring-factorial_${configHash.slice(0, 12)}`;
const environmentManifest = {
  schemaVersion: 1,
  os: `${os.platform()}-${os.release()}`,
  architecture: os.arch(),
  timezone: 'Asia/Bangkok',
  node: process.version,
  codexCli: '0.147.0',
  provider: 'openai',
  sandbox: 'read-only',
  branch: null,
  commitSha: null,
  gitDirty: true,
  network: 'codex_provider_only',
  inputArtifactSha256: fileSha256(inputPath),
};
const environmentId = `ENV1_${sha256(stableJson(environmentManifest)).slice(0, 20)}`;
const resultRows = [luna, sol].flatMap((result) => result.referenceRows.map((referenceRow) => ({
  schemaVersion: 1,
  runId: `RUN1_${benchmarkId.slice(0, 20)}_${startedAt.replace(/[-:.]/g, '')}_01`,
  benchmarkId,
  datasetId: input.datasetId,
  datasetRevisionId,
  environmentId,
  cohortId: 'COHORT_R1_UNCLASSIFIED_55',
  querySetId: `QUERYSET1_AUTHORING_${input.inputId.slice(8, 20)}`,
  metricSetId: 'METRICS1_benchmark-measurement-v1',
  logicRunId: `LOGIC_C_AUTHORING_${configHash.slice(0, 12)}`,
  armId: result.modelKey === 'luna' ? 'LLM_NOEMB_LUNA' : 'LLM_NOEMB_SOL',
  authoringRunId: `AUTHORRUN1_${result.modelKey.toUpperCase()}_NOEMB_${input.inputId.slice(8, 20)}`,
  modelId: result.modelId,
  embeddingModelId: null,
  embeddingSpaceId: null,
  indexId: null,
  productId: referenceRow.productId,
  referenceTypeId: referenceRow.referenceTypeId,
  predictedTypeId: referenceRow.predictedTypeId,
  typeAgreement: referenceRow.typeAgreement,
  referenceDecision: referenceRow.referenceDecision,
  predictedDecision: referenceRow.predictedDecision,
  decisionAgreement: referenceRow.decisionAgreement,
  evidence: 'provisional_owner_reference_5_only',
})));
const metrics = [
  ...[luna, sol].flatMap((result) => {
    const armId = result.modelKey === 'luna' ? 'LLM_NOEMB_LUNA' : 'LLM_NOEMB_SOL';
    const runId = `RUN1_${benchmarkId.slice(0, 20)}_${startedAt.replace(/[-:.]/g, '')}_01`;
    return [
      {
        metricId: 'MET_INTEGRITY_RECORD_COMPLETENESS',
        metricSetId: 'METRICS1_benchmark-measurement-v1',
        runId,
        cohortId: 'COHORT_R1_UNCLASSIFIED_55',
        querySetId: `QUERYSET1_AUTHORING_${input.inputId.slice(8, 20)}`,
        method: armId,
        status: result.schemaValid ? 'measured' : 'failed',
        value: result.recordCount === result.expectedRecordCount && result.uniqueProductIdCount === result.expectedRecordCount ? 1 : result.uniqueProductIdCount / result.expectedRecordCount,
        numerator: result.uniqueProductIdCount,
        denominator: result.expectedRecordCount,
        evidence: [result.sourceArtifact],
      },
      {
        metricId: 'MET_ACTIONABLE_COVERAGE',
        metricSetId: 'METRICS1_benchmark-measurement-v1',
        runId,
        cohortId: 'COHORT_R1_UNCLASSIFIED_55',
        querySetId: `QUERYSET1_AUTHORING_${input.inputId.slice(8, 20)}`,
        method: armId,
        status: 'measured',
        value: result.actionableCoverage,
        numerator: result.decisionCounts.classified + result.decisionCounts.review_required,
        denominator: result.expectedRecordCount,
        evidence: [result.sourceArtifact],
      },
      {
        metricId: 'MET_OWNER_TYPE_AGREEMENT_PROVISIONAL',
        metricSetId: 'METRICS1_benchmark-measurement-v1',
        runId,
        cohortId: 'COHORT_R1_OWNER_MAPPED_5',
        querySetId: `QUERYSET1_AUTHORING_${input.inputId.slice(8, 20)}`,
        method: armId,
        status: result.ownerReferenceCount ? 'measured' : 'not_applicable',
        value: result.ownerTypeAgreement,
        numerator: result.referenceRows.filter((row) => row.typeAgreement).length,
        denominator: result.ownerReferenceCount,
        evidence: ['identity-review-user-logic-v1'],
        reason: '5 owner-mapped rows only; not independent gold',
      },
      {
        metricId: 'MET_OWNER_USABLE_MAPPING_RATE_PROVISIONAL',
        metricSetId: 'METRICS1_benchmark-measurement-v1',
        runId,
        cohortId: 'COHORT_R1_OWNER_MAPPED_5',
        querySetId: `QUERYSET1_AUTHORING_${input.inputId.slice(8, 20)}`,
        method: armId,
        status: result.ownerReferenceCount ? 'measured' : 'not_applicable',
        value: result.ownerUsableMappingRate,
        numerator: result.referenceRows.filter((row) => row.usableMapping).length,
        denominator: result.ownerReferenceCount,
        evidence: ['identity-review-user-logic-v1'],
        reason: '5 owner-mapped rows only; not independent gold',
      },
    ];
  }),
  {
    metricId: 'MET_LLM_DECISION_AGREEMENT_LUNA_VS_SOL',
    metricSetId: 'METRICS1_benchmark-measurement-v1',
    runId: `RUN1_${benchmarkId.slice(0, 20)}_${startedAt.replace(/[-:.]/g, '')}_01`,
    cohortId: 'COHORT_R1_UNCLASSIFIED_55',
    querySetId: `QUERYSET1_AUTHORING_${input.inputId.slice(8, 20)}`,
    method: 'paired_luna_vs_sol',
    status: 'measured',
    value: modelComparison.decisionAgreementRate,
    numerator: modelComparison.decisionAgreementCount,
    denominator: modelComparison.pairCount,
    evidence: ['luna-noemb.json', 'sol-noemb.json'],
  },
  {
    metricId: 'MET_LLM_TYPE_AGREEMENT_LUNA_VS_SOL',
    metricSetId: 'METRICS1_benchmark-measurement-v1',
    runId: `RUN1_${benchmarkId.slice(0, 20)}_${startedAt.replace(/[-:.]/g, '')}_01`,
    cohortId: 'COHORT_R1_UNCLASSIFIED_55',
    querySetId: `QUERYSET1_AUTHORING_${input.inputId.slice(8, 20)}`,
    method: 'paired_luna_vs_sol',
    status: 'measured',
    value: modelComparison.typeAgreementRate,
    numerator: modelComparison.typeAgreementCount,
    denominator: modelComparison.pairCount,
    evidence: ['luna-noemb.json', 'sol-noemb.json'],
  },
];
for (const row of metrics as Array<Record<string, unknown>>) {
  row.benchmarkId = benchmarkId;
  row.datasetId = input.datasetId;
  row.datasetRevisionId = datasetRevisionId;
  row.environmentId = environmentId;
  row.armId = row.method;
  row.logicRunId = `LOGIC_C_AUTHORING_${configHash.slice(0, 12)}`;
  row.modelId = row.method === 'LLM_NOEMB_LUNA' ? 'gpt-5.6-luna' : 'gpt-5.6-sol';
  row.embeddingModelId = null;
  row.embeddingSpaceId = null;
  row.indexId = null;
}
const runId = `RUN1_${benchmarkId.slice(0, 20)}_${startedAt.replace(/[-:.]/g, '')}_01`;
const runManifest = {
  schemaVersion: 1,
  runId,
  benchmarkId,
  datasetId: input.datasetId,
  datasetRevisionId,
  environmentId,
  startedAt,
  endedAt,
  durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
  timezone: 'Asia/Bangkok',
  status: 'completed',
  factors: [
    { armId: 'LLM_NOEMB_LUNA', modelId: 'gpt-5.6-luna', embedding: null, output: 'luna-noemb.json' },
    { armId: 'LLM_NOEMB_SOL', modelId: 'gpt-5.6-sol', embedding: null, output: 'sol-noemb.json' },
  ],
  promptContractId: config.promptContractId,
  promptHash: config.promptHash,
  outputSchema: 'llm_no_embedding_v1',
  evidence: {
    startedAt: 'codex-cli trace from execution turn',
    endedAt: 'output artifact filesystem mtime',
    modelRevision: 'unavailable from Codex CLI output',
  },
  sourceArtifacts: {
    input: { path: path.relative(root, inputPath), sha256: fileSha256(inputPath) },
    baseline: { path: path.relative(root, baselinePath), sha256: fileSha256(baselinePath), snapshotId: baseline.snapshotId },
    owner: { path: path.relative(root, ownerPath), sha256: fileSha256(ownerPath), snapshotId: owner.snapshotId },
    luna: { path: path.relative(root, files.luna), sha256: fileSha256(files.luna) },
    sol: { path: path.relative(root, files.sol), sha256: fileSha256(files.sol) },
  },
  counts: { inputRecords: input.records.length, ownerReferenceRows: ownerReference.size, differingRows: modelComparison.differingProductIds.length },
  results: { luna, sol, modelComparison },
};

writeAtomic(path.join(outputDir, 'llm-authoring-results.jsonl'), `${resultRows.map((row) => JSON.stringify(row)).join('\n')}\n`);
writeAtomic(path.join(outputDir, 'llm-authoring-metrics.jsonl'), `${metrics.map((row) => JSON.stringify(row)).join('\n')}\n`);
writeAtomic(path.join(outputDir, 'llm-authoring-run-manifest.json'), `${JSON.stringify({
  ...runManifest,
  authoringModelIds: ['gpt-5.6-luna', 'gpt-5.6-sol'],
  config,
  modelRunIds: {
    luna: `AUTHORRUN1_LUNA_NOEMB_${input.inputId.slice(8, 20)}`,
    sol: `AUTHORRUN1_SOL_NOEMB_${input.inputId.slice(8, 20)}`,
  },
}, null, 2)}\n`);
writeAtomic(path.join(outputDir, 'llm-authoring-comparison.json'), `${JSON.stringify({
  schemaVersion: 1,
  benchmarkId,
  runId,
  luna,
  sol,
  modelComparison,
  differingRows: comparisonRows.filter((row) => !row.jointAgreement),
}, null, 2)}\n`);
const derivedFiles = ['llm-authoring-results.jsonl', 'llm-authoring-metrics.jsonl', 'llm-authoring-run-manifest.json', 'llm-authoring-comparison.json'];
const checksumPaths = [...Object.values(files), ...derivedFiles.map((name) => path.join(outputDir, name))];
writeAtomic(path.join(outputDir, 'llm-authoring-checksums.sha256'), `${checksumPaths
  .map((filePath) => `${fileSha256(filePath)}  ${path.basename(filePath)}`)
  .join('\n')}\n`);

console.log(JSON.stringify({
  status: 'completed',
  benchmarkId,
  runId,
  environmentId,
  inputId: input.inputId,
  datasetId: input.datasetId,
  datasetRevisionId,
  promptHash: config.promptHash,
  luna: {
    recordCount: luna.recordCount,
    decisionCounts: luna.decisionCounts,
    ownerTypeAgreement: luna.ownerTypeAgreement,
    ownerUsableMappingRate: luna.ownerUsableMappingRate,
    outputSha256: luna.sourceArtifactSha256,
  },
  sol: {
    recordCount: sol.recordCount,
    decisionCounts: sol.decisionCounts,
    ownerTypeAgreement: sol.ownerTypeAgreement,
    ownerUsableMappingRate: sol.ownerUsableMappingRate,
    outputSha256: sol.sourceArtifactSha256,
  },
  modelComparison,
}, null, 2));
