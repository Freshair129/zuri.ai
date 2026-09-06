import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

type JsonObject = Record<string, unknown>;
type Decision = 'classified' | 'review_required' | 'unclassified';
type ModelKey = 'luna_noemb' | 'sol_noemb' | 'luna_emb' | 'sol_emb';

const root = path.resolve(process.cwd());
const dir = path.resolve(process.env.GENESIS_AUTHORING_OUTPUT_DIR || './data/catalog_vector_benchmark_round1_v1');
const noEmbeddingDir = path.resolve(process.env.GENESIS_NOEMB_OUTPUT_DIR || dir);
const embeddingOutputDir = path.resolve(process.env.GENESIS_EMBEDDING_OUTPUT_DIR || dir);
const inputPath = path.resolve(process.env.GENESIS_AUTHORING_INPUT_PATH || path.join(dir, 'authoring-input-round1.json'));
const ownerPath = path.resolve(process.env.GENESIS_USER_LOGIC_REVIEW_PATH || './data/catalog_identity_review_user_logic_v1/identity-review.json');
const vectorInputPath = path.resolve(process.env.GENESIS_VECTOR_INPUT_PATH || './data/catalog_vector_benchmark_round1_v1/vector-input-round1.json');
const vectorRunDir = path.resolve(process.env.GENESIS_VECTOR_RUN_DIR || './data/catalog_vector_benchmark_round1_v1/gpu-run-corrected-20260823T025624Z');
const embeddingLabel = (process.env.GENESIS_EMBEDDING_LABEL || 'E5S').toUpperCase();
const embeddingModelName = process.env.GENESIS_EMBEDDING_MODEL_NAME || 'intfloat/multilingual-e5-small';
const files: Record<ModelKey, string> = {
  luna_noemb: path.join(noEmbeddingDir, 'luna-noemb.json'),
  sol_noemb: path.join(noEmbeddingDir, 'sol-noemb.json'),
  luna_emb: path.join(embeddingOutputDir, `luna-emb-${embeddingLabel.toLowerCase()}.json`),
  sol_emb: path.join(embeddingOutputDir, `sol-emb-${embeddingLabel.toLowerCase()}.json`),
};
const armIds: Record<ModelKey, string> = {
  luna_noemb: 'LLM_NOEMB_LUNA',
  sol_noemb: 'LLM_NOEMB_SOL',
  luna_emb: `LLM_EMB_LUNA_${embeddingLabel}`,
  sol_emb: `LLM_EMB_SOL_${embeddingLabel}`,
};
const modelIds: Record<ModelKey, string> = {
  luna_noemb: 'gpt-5.6-luna',
  sol_noemb: 'gpt-5.6-sol',
  luna_emb: 'gpt-5.6-luna',
  sol_emb: 'gpt-5.6-sol',
};

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
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as any;
}

function decisionCounts(records: Array<{ decision: Decision }>): Record<Decision, number> {
  return {
    classified: records.filter((record) => record.decision === 'classified').length,
    review_required: records.filter((record) => record.decision === 'review_required').length,
    unclassified: records.filter((record) => record.decision === 'unclassified').length,
  };
}

const input = readJson(inputPath) as {
  inputId: string;
  datasetId: string;
  records: Array<{ productId: string; offers: Array<{ offerId: string }> }>;
};
const owner = readJson(ownerPath) as {
  snapshotId: string;
  productMasters: Array<{ productId: string; typeStatus: string; typeId: string | null; decision: Decision }>;
};
const vectorInput = readJson(vectorInputPath) as { datasetRevisionId: string; querySetId: string; inputId: string };
const vectorRun = readJson(path.join(vectorRunDir, 'run-manifest.json')) as { runId: string; modelId: string; modelRevision: string | null; embeddingSpaceId: string; indexId: string };
const expectedIds = new Set(input.records.map((record) => record.productId));
const ownerReference = new Map(owner.productMasters.filter((record) => expectedIds.has(record.productId) && record.typeStatus === 'classified' && record.typeId).map((record) => [record.productId, record]));

function evaluate(key: ModelKey) {
  const filePath = files[key];
  if (!fs.existsSync(filePath)) throw new Error(`Missing model output: ${filePath}`);
  const parsed = readJson(filePath) as {
    schemaVersion: number;
    decisionMode: string;
    records: Array<{
      productId: string;
      decision: Decision;
      typeId: string | null;
      confidence: number;
      reasonCodes: string[];
      evidenceOfferIds: string[];
      rationale: string;
    }>;
  };
  const expectedMode = key.endsWith('_emb') ? 'llm_embedding_v1' : 'llm_no_embedding_v1';
  const errors: Array<{ productId?: string; code: string }> = [];
  if (parsed.schemaVersion !== 1) errors.push({ code: 'schema_version_invalid' });
  if (parsed.decisionMode !== expectedMode) errors.push({ code: 'decision_mode_invalid' });
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
    if (typeof record.rationale !== 'string' || !record.rationale.trim()) errors.push({ productId: record.productId, code: 'rationale_missing' });
  }
  for (const productId of expectedIds) if (!seen.has(productId)) errors.push({ productId, code: 'missing_product_id' });
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
  const counts = decisionCounts(validRecords);
  return {
    key,
    armId: armIds[key],
    modelId: modelIds[key],
    embedding: key.endsWith('_emb') ? embeddingModelName : null,
    sourceArtifact: path.basename(filePath),
    sourceArtifactSha256: fileSha256(filePath),
    schemaValid: errors.length === 0,
    recordCount: records.length,
    expectedRecordCount: input.records.length,
    uniqueProductIdCount: seen.size,
    decisionCounts: counts,
    classifiedRate: counts.classified / input.records.length,
    reviewRate: counts.review_required / input.records.length,
    unclassifiedRate: counts.unclassified / input.records.length,
    actionableCoverage: (counts.classified + counts.review_required) / input.records.length,
    ownerReferenceCount: referenceRows.length,
    ownerTypeAgreement: referenceRows.length ? referenceRows.filter((row) => row.typeAgreement).length / referenceRows.length : null,
    ownerDecisionAgreement: referenceRows.length ? referenceRows.filter((row) => row.decisionAgreement).length / referenceRows.length : null,
    ownerUsableMappingRate: referenceRows.length ? referenceRows.filter((row) => row.usableMapping).length / referenceRows.length : null,
    referenceRows,
    errors,
  };
}

const evaluated = Object.fromEntries((Object.keys(files) as ModelKey[]).map((key) => [key, evaluate(key)])) as Record<ModelKey, ReturnType<typeof evaluate>>;

function pair(leftKey: ModelKey, rightKey: ModelKey) {
  const leftRecords = readJson(files[leftKey]).records as Array<{ productId: string; decision: Decision; typeId: string | null }>;
  const rightRecords = readJson(files[rightKey]).records as Array<{ productId: string; decision: Decision; typeId: string | null }>;
  const rightById = new Map(rightRecords.map((record) => [record.productId, record]));
  const rows = leftRecords.filter((record) => expectedIds.has(record.productId)).map((left) => {
    const right = rightById.get(left.productId);
    return {
      productId: left.productId,
      decisionAgreement: Boolean(right && left.decision === right.decision),
      typeAgreement: Boolean(right && left.typeId === right.typeId),
      jointAgreement: Boolean(right && left.decision === right.decision && left.typeId === right.typeId),
      leftDecision: left.decision,
      rightDecision: right?.decision || null,
      leftTypeId: left.typeId,
      rightTypeId: right?.typeId || null,
    };
  });
  return {
    leftArm: armIds[leftKey],
    rightArm: armIds[rightKey],
    pairCount: rows.length,
    decisionAgreementCount: rows.filter((row) => row.decisionAgreement).length,
    decisionAgreementRate: rows.length ? rows.filter((row) => row.decisionAgreement).length / rows.length : null,
    typeAgreementCount: rows.filter((row) => row.typeAgreement).length,
    typeAgreementRate: rows.length ? rows.filter((row) => row.typeAgreement).length / rows.length : null,
    jointAgreementCount: rows.filter((row) => row.jointAgreement).length,
    jointAgreementRate: rows.length ? rows.filter((row) => row.jointAgreement).length / rows.length : null,
    differingRows: rows.filter((row) => !row.jointAgreement),
  };
}

const pairs = {
  noEmbeddingModelEffect: pair('luna_noemb', 'sol_noemb'),
  embeddingModelEffect: pair('luna_emb', 'sol_emb'),
  lunaEmbeddingLift: pair('luna_noemb', 'luna_emb'),
  solEmbeddingLift: pair('sol_noemb', 'sol_emb'),
};
const startedAtNoEmbedding = process.env.GENESIS_AUTHORING_NOEMB_STARTED_AT || '2026-08-23T02:30:19.000Z';
const startedAtEmbedding = process.env.GENESIS_AUTHORING_EMBEDDING_STARTED_AT || new Date(Math.min(fs.statSync(files.luna_emb).mtimeMs, fs.statSync(files.sol_emb).mtimeMs)).toISOString();
const endedAtNoEmbedding = new Date(Math.max(fs.statSync(files.luna_noemb).mtimeMs, fs.statSync(files.sol_noemb).mtimeMs)).toISOString();
const endedAtEmbedding = new Date(Math.max(fs.statSync(files.luna_emb).mtimeMs, fs.statSync(files.sol_emb).mtimeMs)).toISOString();
const config = {
  protocolVersion: 'authoring-factorial-round1-v1',
  inputId: input.inputId,
  embeddingInputId: readJson(process.env.GENESIS_LLM_EMBED_INPUT_PATH || path.join(dir, `authoring-input-round1-embedding-${embeddingLabel.toLowerCase()}.json`)).inputId,
  datasetId: input.datasetId,
  datasetRevisionId: vectorInput.datasetRevisionId,
  querySetId: vectorInput.querySetId,
  arms: Object.values(armIds),
  embeddingModelId: vectorRun.modelId,
  embeddingModelName,
  embeddingSpaceId: vectorRun.embeddingSpaceId,
  candidatePolicy: 'vector_top20_max_score_across_offers_compact_display_name_only_v1',
  outputSchema: ['llm_no_embedding_v1', 'llm_embedding_v1'],
};
const configHash = sha256(stableJson(config));
const benchmarkId = `BMR1_${vectorInput.datasetRevisionId.slice(5, 17)}_authoring-factorial_${configHash.slice(0, 12)}`;
const runId = `RUN1_${benchmarkId.slice(0, 20)}_${startedAtEmbedding.replace(/[-:.]/g, '')}_01`;
const environmentManifest = {
  schemaVersion: 1,
  os: `${os.platform()}-${os.release()}`,
  architecture: os.arch(),
  timezone: 'Asia/Bangkok',
  node: process.version,
  codexCli: '0.147.0',
  provider: 'openai',
  sandbox: 'read-only',
  gitDirty: true,
  inputArtifactSha256: fileSha256(inputPath),
  embeddingInputArtifactSha256: fileSha256(process.env.GENESIS_LLM_EMBED_INPUT_PATH || path.join(dir, `authoring-input-round1-embedding-${embeddingLabel.toLowerCase()}.json`)),
};
const environmentId = `ENV1_${sha256(stableJson(environmentManifest)).slice(0, 20)}`;

const resultRows = (Object.keys(evaluated) as ModelKey[]).flatMap((key) => evaluated[key].referenceRows.map((row) => ({
  schemaVersion: 1,
  runId,
  benchmarkId,
  datasetId: input.datasetId,
  datasetRevisionId: vectorInput.datasetRevisionId,
  environmentId,
  cohortId: 'COHORT_R1_OWNER_MAPPED_5',
  querySetId: vectorInput.querySetId,
  metricSetId: 'METRICS1_benchmark-measurement-v1',
  logicRunId: `LOGIC_C_AUTHORING_${configHash.slice(0, 12)}`,
  armId: armIds[key],
  authoringRunId: `AUTHORRUN1_${key.toUpperCase()}_${input.inputId.slice(8, 20)}`,
  modelId: modelIds[key],
    embeddingModelId: evaluated[key].embedding ? vectorRun.modelId : null,
    embeddingModelRevision: evaluated[key].embedding ? vectorRun.modelRevision : null,
  embeddingSpaceId: evaluated[key].embedding ? vectorRun.embeddingSpaceId : null,
  indexId: evaluated[key].embedding ? vectorRun.indexId : null,
  productId: row.productId,
  referenceTypeId: row.referenceTypeId,
  predictedTypeId: row.predictedTypeId,
  typeAgreement: row.typeAgreement,
  referenceDecision: row.referenceDecision,
  predictedDecision: row.predictedDecision,
  decisionAgreement: row.decisionAgreement,
  evidence: 'provisional_owner_reference_5_only',
})));

const metrics = (Object.keys(evaluated) as ModelKey[]).flatMap((key) => {
  const result = evaluated[key];
  const common = {
    benchmarkId,
    datasetId: input.datasetId,
    datasetRevisionId: vectorInput.datasetRevisionId,
    environmentId,
    metricSetId: 'METRICS1_benchmark-measurement-v1',
    runId,
    cohortId: 'COHORT_R1_UNCLASSIFIED_55',
    querySetId: vectorInput.querySetId,
    method: armIds[key],
    armId: armIds[key],
    modelId: modelIds[key],
    embeddingModelId: evaluated[key].embedding ? vectorRun.modelId : null,
    embeddingSpaceId: evaluated[key].embedding ? vectorRun.embeddingSpaceId : null,
    indexId: evaluated[key].embedding ? vectorRun.indexId : null,
    logicRunId: `LOGIC_C_AUTHORING_${configHash.slice(0, 12)}`,
    evidence: [result.sourceArtifact],
  };
  return [
    { ...common, metricId: 'MET_ACTIONABLE_COVERAGE', status: 'measured', value: result.actionableCoverage, numerator: result.decisionCounts.classified + result.decisionCounts.review_required, denominator: result.expectedRecordCount },
    { ...common, metricId: 'MET_CLASSIFIED_RATE', status: 'measured', value: result.classifiedRate, numerator: result.decisionCounts.classified, denominator: result.expectedRecordCount },
    { ...common, metricId: 'MET_REVIEW_REQUIRED_RATE', status: 'measured', value: result.reviewRate, numerator: result.decisionCounts.review_required, denominator: result.expectedRecordCount },
    { ...common, metricId: 'MET_UNCLASSIFIED_RATE', status: 'measured', value: result.unclassifiedRate, numerator: result.decisionCounts.unclassified, denominator: result.expectedRecordCount },
    { ...common, metricId: 'MET_OWNER_TYPE_AGREEMENT_PROVISIONAL', cohortId: 'COHORT_R1_OWNER_MAPPED_5', status: result.ownerReferenceCount ? 'measured' : 'not_applicable', value: result.ownerTypeAgreement, numerator: result.referenceRows.filter((row) => row.typeAgreement).length, denominator: result.ownerReferenceCount, reason: '5 owner-mapped rows only; not independent gold' },
    { ...common, metricId: 'MET_OWNER_DECISION_AGREEMENT_PROVISIONAL', cohortId: 'COHORT_R1_OWNER_MAPPED_5', status: result.ownerReferenceCount ? 'measured' : 'not_applicable', value: result.ownerDecisionAgreement, numerator: result.referenceRows.filter((row) => row.decisionAgreement).length, denominator: result.ownerReferenceCount, reason: '5 owner-mapped rows only; not independent gold' },
    { ...common, metricId: 'MET_OWNER_USABLE_MAPPING_RATE_PROVISIONAL', cohortId: 'COHORT_R1_OWNER_MAPPED_5', status: result.ownerReferenceCount ? 'measured' : 'not_applicable', value: result.ownerUsableMappingRate, numerator: result.referenceRows.filter((row) => row.usableMapping).length, denominator: result.ownerReferenceCount, reason: '5 owner-mapped rows only; not independent gold' },
  ];
});
for (const [name, comparison] of Object.entries(pairs)) {
  metrics.push({
    metricSetId: 'METRICS1_benchmark-measurement-v1',
    runId,
    cohortId: 'COHORT_R1_UNCLASSIFIED_55',
    querySetId: vectorInput.querySetId,
    method: name,
    armId: 'PAIRED_COMPARISON',
    benchmarkId,
    datasetId: input.datasetId,
    datasetRevisionId: vectorInput.datasetRevisionId,
    environmentId,
    metricId: 'MET_PAIRED_JOINT_AGREEMENT',
    status: 'measured',
    value: comparison.jointAgreementRate,
    numerator: comparison.jointAgreementCount,
    denominator: comparison.pairCount,
    evidence: Object.values(files).map((filePath) => path.basename(filePath)),
  });
}

const manifest = {
  schemaVersion: 1,
  runId,
  benchmarkId,
  datasetId: input.datasetId,
  datasetRevisionId: vectorInput.datasetRevisionId,
  environmentId,
  querySetId: vectorInput.querySetId,
  metricSetId: 'METRICS1_benchmark-measurement-v1',
  startedAt: startedAtNoEmbedding,
  endedAt: endedAtEmbedding,
  status: 'completed',
  arms: evaluated,
  pairs,
  timing: {
    noEmbedding: { startedAt: startedAtNoEmbedding, endedAt: endedAtNoEmbedding, evidence: 'codex-cli trace + output artifact mtime' },
    embedding: { startedAt: startedAtEmbedding, endedAt: endedAtEmbedding, evidence: 'codex-cli process creation + output artifact mtime' },
  },
  vector: { runId: vectorRun.runId, modelId: vectorRun.modelId, embeddingSpaceId: vectorRun.embeddingSpaceId },
  config,
  promptHash: 'separate_contract_per_arm; see llm-authoring-run-manifest.json for no-embedding prompt hash',
  sourceArtifacts: Object.fromEntries(Object.entries(files).map(([key, filePath]) => [key, { path: path.relative(root, filePath), sha256: fileSha256(filePath) }])),
  counts: { inputRecords: input.records.length, ownerReferenceRows: ownerReference.size, metrics: metrics.length, resultRows: resultRows.length },
};

writeAtomic(path.join(dir, 'llm-factorial-results.jsonl'), `${resultRows.map((row) => JSON.stringify(row)).join('\n')}\n`);
writeAtomic(path.join(dir, 'llm-factorial-metrics.jsonl'), `${metrics.map((row) => JSON.stringify(row)).join('\n')}\n`);
writeAtomic(path.join(dir, 'llm-factorial-comparison.json'), `${JSON.stringify({ schemaVersion: 1, benchmarkId, runId, arms: evaluated, pairs }, null, 2)}\n`);
writeAtomic(path.join(dir, 'llm-factorial-run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const derived = ['llm-factorial-results.jsonl', 'llm-factorial-metrics.jsonl', 'llm-factorial-comparison.json', 'llm-factorial-run-manifest.json'];
const checksumPaths = [...Object.values(files), ...derived.map((name) => path.join(dir, name))];
writeAtomic(path.join(dir, 'llm-factorial-checksums.sha256'), `${checksumPaths.map((filePath) => `${fileSha256(filePath)}  ${path.relative(root, filePath).replaceAll('\\\\', '/')}`).join('\n')}\n`);

console.log(JSON.stringify({ status: 'completed', benchmarkId, runId, environmentId, vectorRunId: vectorRun.runId, arms: evaluated, pairs }, null, 2));
