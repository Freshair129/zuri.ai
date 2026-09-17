import prisma from '@/lib/db'
import { readAuthorizedKnowledgeManifest } from './knowledge-corpus-service'
import { createKnowledgeRepository } from './knowledge-repository'
import { GENESIS_RAG17_PARSER_VERSION_2 } from './genesisrag17-structured-record'

// @req FR-189 — Edge product tools receive only a Server-authorized published catalog manifest.
// @spec ADR-075, ADR-090, SEC-001, SEC-008
// @tested tests/unit/edge-published-corpus-context.test.js

const fail = () => { throw Object.assign(new Error('EDGE_CORPUS_CONTEXT_INVALID'), { code: 'EDGE_CORPUS_CONTEXT_INVALID' }) }

export async function createEdgePublishedCorpusContext(
  { tenantId, businessId, expiresAt },
  { db = prisma, repository = createKnowledgeRepository(db), readManifest = readAuthorizedKnowledgeManifest, now = () => Date.now(), env = process.env } = {},
) {
  if (!tenantId || !businessId || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now() || Date.parse(expiresAt) > now() + 60_000) fail()
  // Same internal read capability as FR-235. It grants no writes, project ACLs or another Business.
  const viewer = Object.freeze({ visibleBusinessIds: Object.freeze([businessId]) })
  let manifest
  try { manifest = await readManifest({ businessId }, { db, repository, viewer, env }) } catch (error) {
    if (error?.code === 'KNOWLEDGE_CORPUS_NOT_FOUND') return null
    throw error
  }
  if (manifest.scope?.tenantId !== tenantId || manifest.scope?.businessId !== businessId || manifest.entries.length > 2048) fail()
  const ingestions = new Map((await repository.getIngestions(manifest.entries.map((e) => e.ingestionId))).map((row) => [row.id, row]))
  const parsedArtifacts = new Map((await repository.getParsedArtifacts(manifest.entries.map((e) => e.parsedArtifactId))).map((row) => [row.id, row]))
  const entries = []
  for (const entry of manifest.entries) {
    const ingestion = ingestions.get(entry.ingestionId)
    if (!ingestion || ingestion.sourceId !== entry.sourceId || ingestion.corpusId !== manifest.corpusId || ingestion.parsedArtifactId !== entry.parsedArtifactId) fail()
    let metadata
    try { metadata = JSON.parse(ingestion.sourceMetaJson) } catch { fail() }
    // A Business corpus may also hold internal documents and chat candidates.
    // Only the approved Zero-PII catalog profile is a customer-facing product source.
    if (metadata?.structured?.format !== 'SMARTGIFT_CATALOG_V1' || metadata.structured.provider !== 'SMARTGIFT_CATALOG') continue
    const parsed = parsedArtifacts.get(entry.parsedArtifactId)
    if (!parsed || parsed.rawArtifactId !== entry.rawArtifactId || parsed.parserVersion !== GENESIS_RAG17_PARSER_VERSION_2) fail()
    entries.push(Object.fromEntries(['sourceId', 'snapshotId', 'generation', 'receiptHash', 'rawArtifactId', 'parsedArtifactId'].map((key) => [key, entry[key]])))
  }
  const context = { schemaVersion: 'edge-published-corpus.v1', scope: manifest.scope, corpusId: manifest.corpusId,
    corpusGeneration: manifest.corpusGeneration, manifestHash: manifest.manifestHash, expiresAt, entries }
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > 1024 * 1024) fail()
  return context
}

/** Caller must load the expected refs from its persisted claim event, never Edge completion. */
export async function assertEdgePublishedCorpusContextCurrent(
  { tenantId, businessId, corpusId, corpusGeneration, manifestHash }, options = {},
) {
  const now = options.now?.() ?? Date.now()
  const current = await createEdgePublishedCorpusContext({ tenantId, businessId, expiresAt: new Date(now + 30_000).toISOString() }, options)
  if (!current || current.corpusId !== corpusId || current.corpusGeneration !== corpusGeneration || current.manifestHash !== manifestHash) fail()
  return true
}
