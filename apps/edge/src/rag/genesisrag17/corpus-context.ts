import { z } from 'zod';

// @req FR-189 — a bounded Server-authorized catalog corpus pins every product tool in one turn.
// @spec ADR-075, ADR-090, SEC-001
// @tested tests/unit/genesisrag17-products.test.ts
const id = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const zEdgePublishedCorpusContext = z.object({
  schemaVersion: z.literal('edge-published-corpus.v1'),
  scope: z.object({ portfolioId: id, tenantId: id, businessId: id,
    workspaceId: z.string().max(256), agentId: z.string().max(256), visibility: z.literal('private') }).strict(),
  corpusId: id,
  corpusGeneration: z.number().int().nonnegative().safe(),
  manifestHash: hash,
  expiresAt: z.string().datetime({ offset: true }),
  entries: z.array(z.object({ sourceId: id, snapshotId: id, generation: id, receiptHash: hash,
    rawArtifactId: id, parsedArtifactId: id }).strict()).max(2048),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.entries.map((e) => e.sourceId)).size !== value.entries.length || Buffer.byteLength(JSON.stringify(value), 'utf8') > 1024 * 1024) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Corpus identities or size are invalid' });
  }
});
export type EdgePublishedCorpusContext = z.infer<typeof zEdgePublishedCorpusContext>;
