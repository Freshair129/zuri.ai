---
version: "1.0.0b"
status: beta
created_at: "2026-09-08T22:06:00+07:00,RWANG,base d1062fcb"
last_update: "2026-09-08T22:06:00+07:00,RWANG"
---

# Knowledge PR reconciliation with current main

PR #293 incorporates main d36f9a61 into the isolated admission implementation d1062fcb. Knowledge admission is now FR-173 and the isolated execution ADR is ADR-073; CRM retains main's FR-172/ADR-071. This is an identity collision repair under the repository's explicit pre-merge rule, not a runtime/protocol change. Registry version: 1.171.0b → 1.172.0b; isolated ADR: 1.2.0b → 1.3.0b. [Collision RCA](../rca/2026-09-08-knowledge-pr-id-collision.md).

Current companion revisions are MSP 6c34b8b, GKS d6c45b3 and GenesisBlock ce558a7. These companion commits update current ADR links and document metadata only; executable code remains at the previously tested 8e16a54, faa946f and a11bc2a respectively. GenesisBlock documentation validation reports zero violations. The zuri executable merge takes main's CRM/navigation/rendering fixes without application-code conflicts; its knowledge changes since d1062fcb are reference annotations.

| Fresh composed-tree check | Result |
|---|---|
| Server unit/integration regression | 4,357 passed, 14 external-profile skips, zero failed; 535 passed files |
| Next build | Passed |
| Actual Business browser/session HTTP/MCP → native admission | 2/2 passed, zero skips, report export passed |
| Governance | Zero critical, duplicate IDs, dangling edges or link findings; 529 IDs |

[Fresh native evidence](knowledge-admission-pr-main-native.json) records four runs with 17 terminal evidence rows each, four native snapshots, five corpus generations and matching receipts/manifests. The [earlier phase report](2026-09-08-knowledge-admission-phase0-4.md) and its raw evidence remain unchanged. Its 25-case native recovery and five-case Files browser regression are prior-head evidence, not relabelled as new merge runs.

The default Server profile excludes 14 unrelated PostgreSQL/LINE external-system tests. The native admission suite skips nothing. Project scope and bearer/API-grant authorization retain unit/Prisma coverage; browser query controls, production migrations, production deployment and organization-wide/cross-store federation are not part of this review.

Machine logs: `C:/Users/pc/workspace/ki17-runtime/knowledge-pr-main-regression-r2.*`, `knowledge-pr-main-build.log`, `knowledge-pr-main-native.*`, `knowledge-main-merge-govern.log`. Hosted CI belongs to the final pushed PR head and must be assessed independently; this report makes no hosted-CI pass claim.
