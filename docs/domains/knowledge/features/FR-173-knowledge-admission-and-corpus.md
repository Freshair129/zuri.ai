---
id: ZAI:FR-173-IMPLEMENTATION
feature: FR-173
module: knowledge
domain: knowledge
source: v2-native
version: "1.0.1b"
status: beta
created_at: "2026-09-08T16:30:00+07:00,RWANG,base dfdbaf11"
last_update: "2026-09-08T19:37:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:ADR-072
  - type: relates_to
    target: ZAI:FR-173
---

# FR-173 — Source admission and corpus serving

Isolated acceptance: Business owner Files browser admission and session HTTP/MCP reached the real native pipeline; four document runs each have 17 successful evidence rows, four native snapshots and five corpus generations. Project-scoped and bearer/API-grant paths have unit/Prisma authorization evidence, not native browser proof. Browser query controls and production activation are not claimed. See the [phase report](../../../../.brain/reports/2026-09-08-knowledge-admission-phase0-4.md) for versions, test counts and limits.

The owner approved phases 0–4 after the surface audit. The knowledge lane owns source-to-corpus association and execution metadata; GKS still owns canonical facts and quality, MSP the relay policy, and the separate native worker physical publication.

See [ADR-072](../../../decisions/ADR-072-KNOWLEDGE-ADMISSION-AND-CORPUS-PUBLICATION.md) for the frozen behavior and [surface inventory](../../../KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md) for existing versus proposed callers. Source adapters do not bypass stages 1–8; a corpus manifest contains verified document snapshot references, not copied canonical facts.

Implementation order: repository/migrations and scope capability → admission/runtime → corpus publication/query/citations → existing Files/Project UI and HTTP/MCP → actual surface/native recovery acceptance. Tests/build/govern remain completion gates, and production is outside this phase.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.1b | 2026-09-08 | beta | Record isolated Business surface/native acceptance and distinguish Project/API-grant test evidence | 03256b74 + integration | RWANG |
| 1.0.0b | 2026-09-08 | beta | Approved implementation boundary and order for admission and corpus serving | base dfdbaf11 | RWANG |
