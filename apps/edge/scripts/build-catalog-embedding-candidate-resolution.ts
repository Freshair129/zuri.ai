import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type { CatalogIdentityReview } from '../src/rag/catalog-identity.js';
import {
  buildProductMasterCandidatePairs,
  resolveProductMasterCandidates,
  type ProductMasterCandidateResolution,
} from '../src/rag/catalog-embedding-candidate-resolution.js';
import type { OwnerLogicReview } from '../src/rag/catalog-user-logic-review.js';

interface VectorDocument {
  documentKind: 'product_master' | 'catalog_offer';
  nativeId: string;
  embeddingId: string;
  embeddingRow: number;
  dimension: number;
  modelId: string;
  modelRevision: string;
  runId: string;
  datasetRevisionId: string;
}

interface VectorRunManifest {
  runId: string;
  benchmarkId: string;
  datasetId: string;
  datasetRevisionId: string;
  environmentId: string;
  modelId: string;
  modelName: string;
  modelRevision: string;
  embeddingSpaceId: string;
  indexId: string;
  querySetId: string;
  metricSetId: string;
  status: string;
  dimension?: number;
  artifactHashes: Record<string, string>;
}

const identityPath = path.resolve(
  process.env.GENESIS_IDENTITY_REVIEW_PATH ||
    './data/catalog_identity_review_v1/identity-review.json'
);
const ownerLogicPath = path.resolve(
  process.env.GENESIS_USER_LOGIC_REVIEW_PATH ||
    './data/catalog_identity_review_user_logic_v1/identity-review.json'
);
const vectorRunDir = path.resolve(
  process.env.GENESIS_VECTOR_RUN_DIR ||
    './data/catalog_vector_benchmark_round1_v1/gpu-run-corrected-20260823T025624Z'
);
const outputDir = path.resolve(
  process.env.GENESIS_EMBEDDING_RESOLUTION_OUTPUT_DIR ||
    './data/catalog_embedding_candidate_resolution_v1'
);
const reportPath = path.resolve(
  process.env.GENESIS_EMBEDDING_RESOLUTION_REPORT_PATH ||
    './docs/GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-REPORT.md'
);
const topK = Number.parseInt(process.env.GENESIS_RESOLUTION_TOP_K || '10', 10);
const minCosine = Number.parseFloat(process.env.GENESIS_RESOLUTION_MIN_COSINE || '0.75');
const sameProductMinCosine = Number.parseFloat(
  process.env.GENESIS_RESOLUTION_SAME_PRODUCT_MIN_COSINE || '0.90'
);
const sameProductMinScore = Number.parseFloat(
  process.env.GENESIS_RESOLUTION_SAME_PRODUCT_MIN_SCORE || '90'
);

function sha256Buffer(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function sha256File(filePath: string): string {
  return sha256Buffer(fs.readFileSync(filePath));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableId(prefix: string, value: unknown, length = 20): string {
  return `${prefix}_${sha256Buffer(stableStringify(value)).slice(0, length)}`;
}

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) throw new Error(`required input is missing: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function readJsonLines<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) throw new Error(`required input is missing: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function writeJson(filePath: string, value: unknown): void {
  writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  writeAtomic(filePath, `${rows.map((row) => stableStringify(row)).join('\n')}\n`);
}

function assertHash(filePath: string, expected: string | undefined): string {
  if (!expected) throw new Error(`missing expected hash for ${path.basename(filePath)}`);
  const actual = sha256File(filePath);
  if (actual !== expected.toUpperCase()) {
    throw new Error(`hash mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
  return actual;
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number(sorted[index].toFixed(4));
}

function scoreDistribution(resolutions: ProductMasterCandidateResolution[]): Record<string, number | null> {
  const scores = resolutions.map((row) => row.cosineScore);
  return {
    min: percentile(scores, 0),
    p50: percentile(scores, 0.50),
    p95: percentile(scores, 0.95),
    max: percentile(scores, 1),
  };
}

function ictTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid report timestamp: ${isoTimestamp}`);
  return `${new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().replace('Z', '')}+07:00`;
}

function report(input: {
  resolutionRunId: string;
  resolutionBenchmarkId: string;
  vectorRun: VectorRunManifest;
  identityHash: string;
  ownerHash: string;
  outputHashes: Record<string, string>;
  result: ReturnType<typeof resolveProductMasterCandidates>;
  startedAt: string;
  endedAt: string;
}): string {
  const { result, vectorRun } = input;
  const reportTimestamp = ictTimestamp(input.endedAt);
  const topReview = result.reviewQueue.slice(0, 20);
  const groups = result.mergeGroups.slice(0, 20);
  const tableRows = groups.length > 0
    ? groups.map((group) => `| \`${group.mergeGroupId}\` | ${group.productIds.length} | ${group.productIds.map((id) => `\`${id}\``).join('<br>')} | ${group.decisions.join(', ')} |`).join('\n')
    : '| — | 0 | — | — |';
  const reviewRows = topReview.length > 0
    ? topReview.map((row) => `| \`${row.candidatePairId}\` | ${row.evidence.leftDisplayName} | ${row.evidence.rightDisplayName} | ${row.cosineScore.toFixed(4)} | ${row.identityScore.toFixed(2)} | \`${row.decision}\` |`).join('\n')
    : '| — | — | — | — | — | — |';

  return `---
id: "GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-REPORT"
version: "0.1.0b"
created_at: "${reportTimestamp}, ATHER"
last_update: "${reportTimestamp}, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P4 E5 ProductMaster candidate resolution sidecar result"
  spec: "GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-SPEC@0.1.0b"
  risk: "HIGH"
  production_decision: "not_approved"
---

# SmartGift Catalog — Embedding Candidate Resolution P4 Report

## Summary

- authoritative ProductMaster count remains **${result.metrics.authoritativeAtomicProductCount}**
- proposed ProductMaster count after reviewable consolidation is **${result.metrics.proposedAtomicProductCount}**
- proposed reduction is **${result.metrics.proposedCountReduction}** across **${result.metrics.proposedMergeGroupCount}** groups
- review queue contains **${result.metrics.reviewQueueCount}** candidate pairs:
  **${result.metrics.decisionCounts.review_required}** classified semantic candidates and
  **${result.metrics.decisionCounts.unclassified}** pairs blocked by unclassified evidence
- no active store, ProductMaster, offer, price, taxonomy or graph authority was changed
- every merge/variant result has \`autoMergeAllowed=false\`

## Run identity

| Field | Value |
|---|---|
| resolution run | \`${input.resolutionRunId}\` |
| benchmark | \`${input.resolutionBenchmarkId}\` |
| dataset revision | \`${vectorRun.datasetRevisionId}\` |
| vector run | \`${vectorRun.runId}\` |
| model | \`${vectorRun.modelId}\` |
| model revision | \`${vectorRun.modelRevision}\` |
| embedding space | \`${vectorRun.embeddingSpaceId}\` |
| index | \`${vectorRun.indexId}\` |
| started / ended | \`${input.startedAt}\` / \`${input.endedAt}\` |
| baseline identity SHA-256 | \`${input.identityHash}\` |
| owner logic SHA-256 | \`${input.ownerHash}\` |

## Decision counts

| Decision | Count |
|---|---:|
| same_product | ${result.metrics.decisionCounts.same_product} |
| variant_of | ${result.metrics.decisionCounts.variant_of} |
| kept_separate | ${result.metrics.decisionCounts.kept_separate} |
| review_required | ${result.metrics.decisionCounts.review_required} |
| unclassified | ${result.metrics.decisionCounts.unclassified} |
| hard-rule rejection | ${result.metrics.hardRuleRejectionCount} |

## Proposed consolidation groups

| Group | Products | Product IDs | Evidence decision |
|---|---:|---|---|
${tableRows}

These are review proposals, not authoritative merges.

## Highest-priority review candidates

| Pair | Left | Right | Cosine | Identity score | Decision |
|---|---|---|---:|---:|---|
${reviewRows}

## Artifact hashes

${Object.entries(input.outputHashes).map(([name, hash]) => `- \`${name}\`: \`${hash}\``).join('\n')}

## Conclusion

P4 makes embedding operational as a deterministic candidate-resolution and review queue.
The production count remains ${result.metrics.authoritativeAtomicProductCount}. The proposed count
${result.metrics.proposedAtomicProductCount} may be promoted only after owner review or an
independent gold-label acceptance gate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Generated E5 ProductMaster pair resolution, merge proposals, review queue, metrics, and checksums | pending | ATHER |
`;
}

const startedAt = new Date().toISOString();
const documentsPath = path.join(vectorRunDir, 'documents.jsonl');
const embeddingsPath = path.join(vectorRunDir, 'embeddings.f32.bin');
const vectorManifestPath = path.join(vectorRunDir, 'run-manifest.json');
const identity = readJson<CatalogIdentityReview>(identityPath);
const owner = readJson<OwnerLogicReview>(ownerLogicPath);
const vectorRun = readJson<VectorRunManifest>(vectorManifestPath);
if (vectorRun.status !== 'completed') throw new Error(`vector run is not completed: ${vectorRun.status}`);
if (identity.snapshotId !== owner.snapshotId) throw new Error('identity and owner-logic snapshots do not match');
if (identity.productMasters.length !== 425) {
  throw new Error(`expected 425 baseline ProductMasters, got ${identity.productMasters.length}`);
}
const documentsHash = assertHash(documentsPath, vectorRun.artifactHashes['documents.jsonl']);
const embeddingsHash = assertHash(embeddingsPath, vectorRun.artifactHashes['embeddings.f32.bin']);
const identityHashBefore = sha256File(identityPath);
const ownerHashBefore = sha256File(ownerLogicPath);
const documents = readJsonLines<VectorDocument>(documentsPath);
const dimension = vectorRun.dimension || documents[0]?.dimension;
if (!dimension || dimension < 1) throw new Error('vector dimension is unavailable');
const embeddingBuffer = fs.readFileSync(embeddingsPath);
if (embeddingBuffer.byteLength % 4 !== 0) throw new Error('embedding binary is not float32 aligned');
const rawBuffer = embeddingBuffer.buffer.slice(
  embeddingBuffer.byteOffset,
  embeddingBuffer.byteOffset + embeddingBuffer.byteLength
);
const embeddings = new Float32Array(rawBuffer);
if (embeddings.length !== documents.length * dimension) {
  throw new Error(`embedding/document cardinality mismatch: ${embeddings.length} floats for ${documents.length} documents at ${dimension}d`);
}
const productDocuments = documents
  .filter((document) => document.documentKind === 'product_master')
  .sort((left, right) => left.nativeId.localeCompare(right.nativeId));
if (productDocuments.length !== identity.productMasters.length) {
  throw new Error(`ProductMaster vector count mismatch: ${productDocuments.length} vs ${identity.productMasters.length}`);
}
const productVectors = productDocuments.map((document) => {
  if (document.modelId !== vectorRun.modelId || document.runId !== vectorRun.runId) {
    throw new Error(`vector lineage mismatch for ${document.nativeId}`);
  }
  const start = document.embeddingRow * dimension;
  return {
    productId: document.nativeId,
    embeddingId: document.embeddingId,
    embedding: Array.from(embeddings.subarray(start, start + dimension)),
  };
});
const candidatePairs = buildProductMasterCandidatePairs(productVectors, { topK, minCosine });
const result = resolveProductMasterCandidates({
  productMasters: identity.productMasters,
  variants: identity.variants,
  ownerProductMasters: owner.productMasters,
  candidatePairs,
  sameProductMinCosine,
  sameProductMinScore,
  reviewMinCosine: minCosine,
});
const config = {
  protocolVersion: 'catalog-embedding-candidate-resolution-v1',
  topK,
  minCosine,
  sameProductMinCosine,
  sameProductMinScore,
  autoMergeAllowed: false,
};
const resolutionBenchmarkId = stableId('BMR_P4', {
  datasetRevisionId: vectorRun.datasetRevisionId,
  vectorRunId: vectorRun.runId,
  config,
});
const resolutionRunId = stableId('RESRUN_P4', {
  resolutionBenchmarkId,
  identityHash: identityHashBefore,
  ownerHash: ownerHashBefore,
  documentsHash,
  embeddingsHash,
});
const lineage = {
  resolutionRunId,
  resolutionBenchmarkId,
  datasetId: vectorRun.datasetId,
  datasetRevisionId: vectorRun.datasetRevisionId,
  vectorRunId: vectorRun.runId,
  vectorBenchmarkId: vectorRun.benchmarkId,
  vectorEnvironmentId: vectorRun.environmentId,
  modelId: vectorRun.modelId,
  modelRevision: vectorRun.modelRevision,
  embeddingSpaceId: vectorRun.embeddingSpaceId,
  indexId: vectorRun.indexId,
  querySetId: vectorRun.querySetId,
  metricSetId: vectorRun.metricSetId,
};
const candidateRows = result.resolutions.map((row) => ({
  schemaVersion: 1,
  ...lineage,
  candidatePairId: row.candidatePairId,
  leftProductId: row.leftProductId,
  rightProductId: row.rightProductId,
  cosineScore: row.cosineScore,
  leftRank: row.leftRank,
  rightRank: row.rightRank,
}));
const resolutionRows = result.resolutions.map((row) => ({ schemaVersion: 1, ...lineage, ...row }));
const reviewRows = result.reviewQueue.map((row) => ({ schemaVersion: 1, ...lineage, ...row }));
const mergeArtifact = {
  schemaVersion: 1,
  ...lineage,
  authoritativeAtomicProductCount: result.metrics.authoritativeAtomicProductCount,
  proposedAtomicProductCount: result.metrics.proposedAtomicProductCount,
  autoMergeAllowed: false,
  groups: result.mergeGroups,
};
const metricsArtifact = {
  schemaVersion: 1,
  ...lineage,
  config,
  ...result.metrics,
  cosineScoreDistribution: scoreDistribution(result.resolutions),
};
fs.mkdirSync(outputDir, { recursive: true });
writeJsonLines(path.join(outputDir, 'candidate-pairs.jsonl'), candidateRows);
writeJsonLines(path.join(outputDir, 'resolutions.jsonl'), resolutionRows);
writeJson(path.join(outputDir, 'merge-groups.json'), mergeArtifact);
writeJsonLines(path.join(outputDir, 'review-queue.jsonl'), reviewRows);
writeJson(path.join(outputDir, 'metrics.json'), metricsArtifact);
const coreArtifacts = [
  'candidate-pairs.jsonl',
  'resolutions.jsonl',
  'merge-groups.json',
  'review-queue.jsonl',
  'metrics.json',
];
const outputHashes = Object.fromEntries(coreArtifacts.map((name) => [name, sha256File(path.join(outputDir, name))]));
const endedAt = new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  manifestId: stableId('ART_P4', { resolutionRunId, outputHashes }),
  ...lineage,
  startedAt,
  endedAt,
  durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
  status: 'completed',
  config,
  inputs: {
    identityPath: path.relative(process.cwd(), identityPath).replaceAll('\\', '/'),
    identitySha256: identityHashBefore,
    ownerLogicPath: path.relative(process.cwd(), ownerLogicPath).replaceAll('\\', '/'),
    ownerLogicSha256: ownerHashBefore,
    vectorRunDirectory: path.relative(process.cwd(), vectorRunDir).replaceAll('\\', '/'),
    documentsSha256: documentsHash,
    embeddingsSha256: embeddingsHash,
  },
  counts: result.metrics,
  artifactHashes: outputHashes,
  sourceMutation: 'none_observed',
  productionMutation: false,
};
writeJson(path.join(outputDir, 'manifest.json'), manifest);
const checksumArtifacts = [...coreArtifacts, 'manifest.json'];
writeAtomic(
  path.join(outputDir, 'checksums.sha256'),
  `${checksumArtifacts.map((name) => `${sha256File(path.join(outputDir, name))}  ${name}`).join('\n')}\n`
);
if (
  sha256File(identityPath) !== identityHashBefore ||
  sha256File(ownerLogicPath) !== ownerHashBefore ||
  sha256File(documentsPath) !== documentsHash ||
  sha256File(embeddingsPath) !== embeddingsHash
) {
  throw new Error('source identity or vector artifacts changed during resolution');
}
writeAtomic(reportPath, report({
  resolutionRunId,
  resolutionBenchmarkId,
  vectorRun,
  identityHash: identityHashBefore,
  ownerHash: ownerHashBefore,
  outputHashes,
  result,
  startedAt,
  endedAt,
}));

console.log(JSON.stringify({
  decision: 'review_only',
  resolutionRunId,
  resolutionBenchmarkId,
  outputDir,
  reportPath,
  vectorRunId: vectorRun.runId,
  modelId: vectorRun.modelId,
  metrics: result.metrics,
  sourceMutation: false,
  productionMutation: false,
}, null, 2));
