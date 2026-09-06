import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type JsonObject = Record<string, unknown>;

const inputPath = path.resolve(
  process.env.GENESIS_AUTHORING_INPUT_PATH ||
    './data/catalog_vector_benchmark_round1_v1/authoring-input-round1.json'
);
const vectorInputPath = path.resolve(
  process.env.GENESIS_VECTOR_INPUT_PATH ||
    './data/catalog_vector_benchmark_round1_v1/vector-input-round1.json'
);
const vectorRunDir = path.resolve(
  process.env.GENESIS_VECTOR_RUN_DIR ||
    './data/catalog_vector_benchmark_round1_v1/gpu-run-corrected-20260823T025624Z'
);
const outputPath = path.resolve(
  process.env.GENESIS_LLM_EMBED_INPUT_PATH ||
    './data/catalog_vector_benchmark_round1_v1/authoring-input-round1-embedding-e5s.json'
);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as JsonObject;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex').toUpperCase();
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

const authoringInput = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as {
  inputId: string;
  datasetId: string;
  sourceSnapshotId: string;
  records: Array<JsonObject & {
    productId: string;
    displayName: string;
    offers: Array<{ offerId: string; englishName: string | null; description: string | null; category: string | null; branding: string[]; sourceCode: string }>;
  }>;
};
const vectorInput = JSON.parse(fs.readFileSync(vectorInputPath, 'utf8')) as {
  inputId: string;
  datasetRevisionId: string;
  querySetId: string;
  canonicalSnapshotId: string;
  productMasters: Array<{ productId: string; displayName: string; text: string }>;
};
const resultRows = fs.readFileSync(path.join(vectorRunDir, 'benchmark-results.jsonl'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as {
    offerId: string;
    vectorTopK: Array<{ productId: string; rank: number; score: number }>;
  });
const resultByOffer = new Map(resultRows.map((row) => [row.offerId, row]));
const textByProductId = new Map(vectorInput.productMasters.map((row) => [row.productId, row]));

const records = authoringInput.records
  .sort((left, right) => left.productId.localeCompare(right.productId))
  .map((record) => {
    const candidates = new Map<string, { productId: string; score: number; sourceOfferIds: string[]; evidence: string }>();
    for (const offer of record.offers) {
      const result = resultByOffer.get(offer.offerId);
      for (const candidate of result?.vectorTopK || []) {
        const previous = candidates.get(candidate.productId);
        const evidence = textByProductId.get(candidate.productId)?.displayName || '';
        if (!previous || candidate.score > previous.score) {
          candidates.set(candidate.productId, {
            productId: candidate.productId,
            score: candidate.score,
            sourceOfferIds: [...new Set([...(previous?.sourceOfferIds || []), offer.offerId])].sort(),
            evidence,
          });
        } else if (!previous.sourceOfferIds.includes(offer.offerId)) {
          previous.sourceOfferIds.push(offer.offerId);
          previous.sourceOfferIds.sort();
        }
      }
    }
    const vectorCandidates = [...candidates.values()]
      .sort((left, right) => right.score - left.score || left.productId.localeCompare(right.productId))
      .slice(0, 20)
      .map((candidate, index) => ({
        rank: index + 1,
        productId: candidate.productId,
        score: Number(candidate.score.toFixed(8)),
        sourceOfferIds: candidate.sourceOfferIds,
        evidence: candidate.evidence,
      }));
    return {
      ...record,
      vectorCandidates,
    };
  });

const payload = {
  schemaVersion: 1,
  inputId: `AINPUT1_EMB_${hash({ baseInputId: authoringInput.inputId, vectorInputId: vectorInput.inputId, runDir: path.basename(vectorRunDir) }).slice(0, 20)}`,
  baseInputId: authoringInput.inputId,
  datasetId: authoringInput.datasetId,
  datasetRevisionId: vectorInput.datasetRevisionId,
  sourceSnapshotId: authoringInput.sourceSnapshotId,
  canonicalSnapshotId: vectorInput.canonicalSnapshotId,
  vectorRunId: (JSON.parse(fs.readFileSync(path.join(vectorRunDir, 'run-manifest.json'), 'utf8')) as { runId: string }).runId,
  embeddingModelId: (JSON.parse(fs.readFileSync(path.join(vectorRunDir, 'run-manifest.json'), 'utf8')) as { modelId: string }).modelId,
  embeddingSpaceId: (JSON.parse(fs.readFileSync(path.join(vectorRunDir, 'run-manifest.json'), 'utf8')) as { embeddingSpaceId: string }).embeddingSpaceId,
  querySetId: vectorInput.querySetId,
  scope: 'baseline_unclassified_product_masters',
  candidatePolicy: 'vector_top20_max_score_across_offers',
  candidateFields: ['productId', 'score', 'sourceOfferIds', 'displayName'],
  candidateEvidencePolicy: 'compact_display_name_only_v1',
  count: records.length,
  records,
};
writeAtomic(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  inputId: payload.inputId,
  baseInputId: payload.baseInputId,
  vectorRunId: payload.vectorRunId,
  embeddingModelId: payload.embeddingModelId,
  embeddingSpaceId: payload.embeddingSpaceId,
  querySetId: payload.querySetId,
  count: payload.count,
  sha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').toUpperCase(),
}, null, 2));
