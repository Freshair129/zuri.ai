// @req FR-189 — the shape an edge answer carries when it was read from a published GenesisRAG17
//   generation: which generation, and the citation ids each passage resolves through in Tier 1.
// @spec ADR-075 D7; MSP `msp_pipeline_query` result (`GENESISRAG17-CONTRACT.md` item 7)
// @tested tests/unit/genesisrag17-edge.test.ts

/** The five citation ids a Tier 1 lineage resolver needs (source → raw → parsed → chunk, plus hash). */
export interface PublishedCitation {
  sourceId: string;
  rawArtifactId: string;
  parsedArtifactId: string;
  chunkId: string;
  contentHash: string;
}

export interface PublishedPassage {
  id: string;
  score: number;
  text: string;
  citation: PublishedCitation;
}

/**
 * The one published generation an answer was read from. `snapshotId` is the identity the Stage 17
 * publication receipt binds; the query response itself carries no `receiptHash`.
 */
export interface PublishedGenerationRef {
  schemaVersion: 'genesisrag17.v1';
  snapshotId: string;
  generation: string;
}
