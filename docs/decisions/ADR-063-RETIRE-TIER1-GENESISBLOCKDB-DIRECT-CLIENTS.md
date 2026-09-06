---
id: ZAI:ADR-063
version: "1.0.0"
status: accepted
created_at: "2026-09-06T00:00:00+07:00,Claude Fable 5.1"
last_update: "2026-09-06T00:00:00+07:00,Claude Fable 5.1"
attributes:
  domain: knowledge
  doc_type: architecture-decision
  scope: "retire the two Tier 1 files that bind a GenesisBlockDB client directly, and name the canonical repositories of MSP, GKS and GenesisBlockDB"
relations:
  - type: relates_to
    target: ZAI:ADR-024
  - type: relates_to
    target: ZAI:ADR-042
  - type: relates_to
    target: ZAI:ADR-043
  - type: relates_to
    target: ZAI:ADR-046
  - type: relates_to
    target: ZAI:ADR-050
  - type: relates_to
    target: ZAI:ADR-062
---

# ADR-063 — Retire Tier 1 GenesisBlockDB direct clients: MSP, GKS and GenesisBlockDB are external systems, never zuri-ai domains

**Status:** Accepted by owner instruction, 2026-09-06 ("ทำ ADR retire สองไฟล์นั้นเลย").
**Date:** 2026-09-06
**Decided by:** Boss, Lead Architect
**Relates to:** [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md), [ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md), [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md), [ADR-046](ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md), [ADR-050](ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md), [ADR-062](ADR-062-ZURI-SERVER-EDGE-MONOREPO-BOUNDARY.md).
**Touches:** the FR-024 code surface, `docs/domains/knowledge/CHARTER.md`, `docs/domains/agent/CHARTER.md`.

## Context

The owner asked whether the Genesis RAG service, MSP and GKS should each become a domain inside zuri-ai. Three approved decisions already answer that, and they answer it the same way:

- [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md) D2.1 places zuri-ai at Tier 1 only. MSP is Tier 2, GKS is Tier 3, GenesisBlockDB is Tier 4, and "Zuri-AI … never talks directly to GenesisBlockDB or bypasses MSP governance."
- [ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md) D4 makes GKS and GenesisBlockDB a client-neutral backend shared by zuri-ai, GoVibe, NotiKeeper and external agents. A domain inside one product cannot be shared by the others, and [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md) keeps zuri-ai a standalone product rather than a host for them.
- [ADR-050](ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) D3 says the repository may hold no GKS client, no GenesisBlockDB client, no embedding call and no index mutation, and rejects a "thin adapter" explicitly: "Writing any of the six lanes is writing the substrate; the lane count is not a permission gradient."

The repository nevertheless carried two files that predate all three decisions. Both are annotated to ADR-007 §P5 and FR-024, both take the NAPI `GenesisDatabase` client from the GenesisBlock repository as a direct dependency, and neither has a production caller:

| File | What it did | Who called it |
|---|---|---|
| `src/modules/knowledge/gbdb-rag-service.js` | `ingestKnowledgeItem` (embed + `addNode` + `flushIndex`), `ingestRelation` (`addEdge`), `queryHybridContext` (`hybridSearch`), `executeAgentTurnWithRag` (retrieve → prompt → LLM) — a complete Tier 3 + Tier 4 RAG loop executed from Tier 1 | only `tests/unit/gbdb-rag-service.test.js` |
| `src/modules/knowledge/genesisblockdb-sink.js` | a `GraphSink` that forwards `projectKnowledgeGraph` output to the client's `addNode` / `addEdge` — a Tier 4 write path | exported from `src/modules/knowledge/index.js`; used only by `tests/integration/knowledge-genesis-sink.test.js` |

ADR-050's consequences made this kind of file "falsifiable: if a future PR adds a Tier 4 write credential, an embedding call or an index mutation to this repository, it violates D3." These two were not future; they were already here, so the rule had a standing exception that nothing named. This ADR removes the exception rather than leaving it to be discovered by the next reviewer.

ADR-043 also names the three external systems by local drive path (`D:\msp`, `D:\gks`, `G:\GenesisBlock_Dev\...`). Those paths exist on one machine; the repositories exist everywhere, and the owner supplied them with this decision.

## Decision

### D1 — The two direct-client files are retired and deleted

`src/modules/knowledge/gbdb-rag-service.js` and `src/modules/knowledge/genesisblockdb-sink.js` are removed, together with their only consumers, `tests/unit/gbdb-rag-service.test.js` and `tests/integration/knowledge-genesis-sink.test.js`. `createGenesisBlockDBSink` leaves the knowledge module's public surface.

Deletion, not deprecation: a deprecated export is still an import path, and the thing ADR-050 D3 forbids is the path, not its popularity. The logic they held belongs to the tiers that own it — the RAG loop to GKS (Tier 3), the node/edge write to GenesisBlockDB (Tier 4) — and git history keeps the text for whoever ports it there.

### D2 — What FR-024 keeps in this repository

FR-024's statement is unchanged; its meaning was never "write to GenesisBlockDB". What stays is the Tier 1 half it always described:

- `projectKnowledgeGraph` — the deterministic, tenant-scoped projection of Zuri relations, with `assertNoLiveFacts` refusing price, credit, invoice, payment, stock and schedule.
- `writeGraph` and the `GraphSink` contract in `sink.js`, with `createJsonSink` as the only sink built here. The seam stays; the adapter that satisfies it lives in the GKS repository (D3), not in this tree.
- `queryKnowledge` (Prisma) and `createGraphKnowledgeReader` (`graph-query.js`), which reads through an injected `traverse`.

That last item is recorded, not resolved. `createGraphKnowledgeReader` binds nothing itself, so it does not violate D3 as written — but the comment that documented it invited the owner to bind `traverse` to "the NAPI GenesisDatabase query/traverse", and ADR-050 D3 is explicit that "a direct substrate read is not a lighter form of consumption." The only compliant binding is one that goes through MSP into GKS ([ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md) D2) or the ADR-046 interim `:8888` surface. The file stays; its comment is rewritten in this change to say that, so the invitation is withdrawn without touching the code.

### D2a — One direct client remains, named so it cannot pass as compliant

`src/modules/knowledge/smartgift-rag-pipeline.js` (`seedSmartGiftKnowledge`, `searchSmartGiftKnowledge`, both annotated FR-024 / SDD-027) has the same shape as the two retired files — it requires a `GenesisDatabase` instance, creates a collection, calls `addNode`, `addEdge`, `flushIndex` and `hybridSearch`, and embeds through an injected provider. It differs in one respect that keeps it out of D1: it has a consumer beyond its own unit test, `tests/integration/smartgift-webhook-e2e.test.js`, which seeds the SmartGift catalog through it to exercise the LINE webhook end to end.

The owner named two files, and this ADR retires two. It does not silently widen to a third; it records the third as **the last standing exception to ADR-050 D3 in this repository**, so that the sentence "Tier 1 holds no substrate client" is known to be one deletion short rather than believed to be true. Retiring it means giving the SmartGift end-to-end test a seeded knowledge fixture that does not go through the substrate — a small, separate change that should cite this section when it lands.

### D3 — The canonical repositories of the three external systems

| Tier | System | Canonical repository | Lives in zuri-ai as |
|---|---|---|---|
| 2 | MSP — Memory and Soul Passport | <https://github.com/Freshair129/Memory-and-Soul-Passport> ("Standalone Mission State Protocol memory and context runtime extracted from GoVibe") | the **agent** domain's ports only: `msp-memory-port.js` (API-009) and `msp-vault-resolver.js` (API-010) over an injected transport |
| 3 | GKS — Genesis Knowledge System | <https://github.com/Freshair129/Genesis-Knowledge-System> | the **knowledge** domain's consumer contracts only: the business-knowledge reader, the published-snapshot identity (FR-110), the ingestion declaration and the eight Tier 1 stages (ADR-050 D2) |
| 4 | GenesisBlockDB | <https://github.com/Freshair129/GenesisBlock> | **nothing** — reached only through Tier 2 → Tier 3, or the ADR-046 interim `:8888` surface |

The local paths in ADR-043 D1 are where those repositories happened to be checked out on 2026-08-22; the URLs above are the identity. ADR-043 is not rewritten — its text is a dated record — and this table is the current pointer.

### D4 — None of the three is a zuri-ai domain, and the candidate monorepo does not change that

A `src/modules/<d>` folder with a `docs/domains/<d>/CHARTER.md` is a lane *of this product*. MSP, GKS and GenesisBlockDB serve several products, so a lane here would either duplicate their authority (two systems deciding what an entity is — the thing ADR-050 D3 rejected) or fork them. The `knowledge` charter's opening line, "Canonical business knowledge (GKS)", names the *authority this domain consumes*, not a claim that the domain is GKS; the charter is amended in this change to say so in one sentence.

[ADR-062](ADR-062-ZURI-SERVER-EDGE-MONOREPO-BOUNDARY.md)'s candidate layout — `apps/server`, `apps/edge`, `packages/contracts` — has no slot for the three systems either. Should that monorepo be adopted, they remain separate repositories, and `packages/contracts` may carry the wire contracts zuri-ai consumes from them, never their runtimes.

### D5 — What this ADR does not do

No requirement id is declared, retired or reworded. FR-024 stays `🟠 library-complete` with the same statement; its PRD row already says the write path has no production caller, and that is still true with one fewer unreachable adapter. No route, model, migration or contract file changes. The `docs/.id-ledger.json` gains only the routine `+` block for ADR-063.

## Consequences

- ADR-050 D3 now describes the repository with exactly one named exception (D2a). A reviewer can `grep` for `GenesisDatabase`, `hybridSearch` or `flushIndex` in `src/` and expect hits in `smartgift-rag-pipeline.js` only; any other hit is a finding, not a legacy, and when that file goes the expectation becomes zero.
- Two test suites disappear. Both exercised a mocked client against code no caller reached, so the test count falls and the covered behaviour does not.
- The `sink.js` seam comment stops describing `createGenesisBlockDBSink` as a future adapter of this module and names the GKS repository as where it belongs.
- The roadmap task `TC-TASK-ZAI-016` (cross-business analytics read model) had `symbol_links.code` pointing at the deleted sink — a placeholder that never described that task. It is set to `unavailable`, matching its `test:` field, so the roadmap reader does not link to a file that no longer exists.
- Anyone porting the RAG loop to GKS or the sink to GenesisBlockDB starts from the deleted files' last revision in git history (`git log --all -- src/modules/knowledge/gbdb-rag-service.js`).

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 1.0.0 | 2026-09-06 | accepted | Retired and deleted `gbdb-rag-service.js` and `genesisblockdb-sink.js` with their tests; recorded MSP, GKS and GenesisBlockDB as external repositories that are never zuri-ai domains; constrained how `createGraphKnowledgeReader` may ever be bound; named `smartgift-rag-pipeline.js` as the one remaining direct client | Claude Fable 5.1 |
