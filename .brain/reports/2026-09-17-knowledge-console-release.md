# TASK-ZAI-047 Console production release

Version: 0.2.0b

Status: PREPARING — user approved fixture repair and public source publication on 2026-09-17

## Current composition

Live baseline advanced during approval to4191a72180ad8d31c25613478ee7ba6b2c0863ae (release-4191a721). Preserve its already-deployed pricing schema/routes, CRM legal hold and PM changes. No new migration is introduced by the Console delta against this baseline. The incoming release already contains the same approved usage clock repair; retain it verbatim. Console cleanup remains fixture-scoped.

Published main/live pricing owns FR-253. AGENTS section18 requires the unpublished Console to move to FR-254; the sanctioned --abandon writer was run against the branch ledger and the incoming authoritative ledger was preserved before --write adds only FR-254. TASK-ZAI-047 scope is unchanged. Auto-review initially rejected a broad rename, then accepted the enumerated Console-only change after the exact AGENTS.md line432 authorization was demonstrated.

Rollback for this composition is release-4191a721. Recheck live mounts/env before promotion. Earlier sections below retain the initial baseline evidence and are superseded where baseline-specific.

## Authorized scope and initial baseline

Deploy the implemented Console from da9aced1, preserving the actual running source11675e598fb601fa09ba9ed33bc080650cd41217. The release branch composes these exact parents. Production image before deployment is zuri-ai-web:release-11675e59 (sha256:570fce9ff561b59f61cdd3805ce6159ac9a0119c168c43e9564cacd05184f4ff).

The live source includes archive legal-hold/key-destruction behavior that main does not contain in full. Deploying main directly would remove it. This release therefore uses a frozen production-base branch for its review/CI comparison. It does not merge unrelated newly landed main features or change the shared primary checkout.

The current live baseline already includes86de7f61, which restores Data Pipeline Map keyboard activation. The earlier Console report's inherited map failure is historical evidence for its older baseline; the composed release must verify the repaired path.

## Runtime and database boundaries

The Console diff against the live baseline has no Prisma/schema, SQL migration, CRM legal-hold or identity-erasure change. A live READ ONLY transaction verified all nine required tables: KnowledgeSource, KnowledgeIngestion, KnowledgeCorpus, KnowledgeCorpusGeneration, KnowledgeRawArtifact, KnowledgeParsedArtifact, PipelineRun, PipelineStep and GenesisRag17PublicationReceipt.

The observed connection remains postgres with rolbypassrls=true, the pre-existing issue documented by the PM release runtime-role carry-forward RCA. No role, grant or credential is changed. Existing service-level current-viewer/source authorization remains mandatory; this image release is not a claim of RLS remediation.

ZURI_KNOWLEDGE_ENABLED is false; LINE server is enabled. This release changes the Console surface, not native runtime activation, bulk imports or live data. Existing admission/query controls remain capability-gated.

Preserve all three Compose overlays (base, line-server and cold-archive), /archive from F:/zuri-cold-archive, and the existing read-only LINE credential mount. Do not print credential values. Only the web/LINE worker image may change; ngrok and database topology remain unchanged.

## Verification and rollback

Composed governance, local tests/browser/build and hosted CI: PENDING. Image build and live browser verification: PENDING. No production mutation has occurred at this status.

Rollback image: zuri-ai-web:release-11675e59. Preserve its image and existing environment/mounts. A rollback switches web and LINE worker to that image without database changes.

## Version reconciliation

- PRD1.235.0b to1.236.0b; FR-253 identity unchanged.
- FEATURES1.57.0b to1.58.0b; FR-253 remains in FEAT-013.
- Interface inventory1.31.0b to1.32.0b;112pages/57navigation entries.
- API appendix1.82.0b to1.83.0b;296paths/395operations.
- Roadmap2.109.0b to2.110.0b; programme0.4.10 to0.4.11.

The sanctioned id-ledger writer preserves the live ledger and adds only FR-253. Generated views are rebuilt from the composed source, never concatenated.

## Composed version diff

PRD1.237 ->1.238, FEATURES1.59 ->1.60, interface1.32 ->1.33, API1.84 ->1.85, roadmap2.110 ->2.111; Console FR-253 ->FR-254 collision reconciliation only. API302paths/402operations; pages113/navigation58. Verification of final composed source remains pending.
