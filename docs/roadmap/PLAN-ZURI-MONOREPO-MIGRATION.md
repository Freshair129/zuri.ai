---
id: ZAI:PLAN-MONOREPO
version: "0.1.1b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T19:38:00+07:00,RWANG"
attributes:
  domain: architecture
relations:
  - type: relates_to
    target: ZAI:ADR-062
  - type: relates_to
    target: ZAI:PLAN-FEAT-019-PHASES
---

# Candidate monorepo migration gates

No code relocation is authorized by this plan. Complete the current two-repository behavior review independently; do not delay safe LINE rollout for a filesystem move.

2026-09-06 prerequisite update: Server source is PRIVATE; the legacy GHCR package
remains PUBLIC. The owner approved build-only publication containment in ADR-062.
Merge and verify that containment before any Edge import. Internal Server graph
identity repair is merged (PR #258); full M3 reconciliation remains open. Private
image destination and authenticated consumer verification are required before
publication resumes. The observed local service uses `zuri-ai-web:local`; no
deployment transition is bundled with these prerequisites.

| Gate | Owner | Required evidence | Exit / rollback |
|---|---|---|---|
| M1 Decision | Architecture owner | Approved ADR-062 layout, source visibility and maintenance ownership | Keep separate repos if not approved |
| M2 Inventory | Server + Edge maintainers | Exact commits, source manifests, licenses, native dependencies, history and per-app scripts; no secrets or runtime data | Freeze inventory; originals remain untouched |
| M3 Graph contract | Governance | Bijection for old document/code IDs and paths; qualified Edge IDs; source hashes; no lost/extra nodes, edges or global subjects; generated outputs excluded | Fail on any unaccounted difference |
| M4 Portable contracts | Integration + Agent + Studio | Existing conversation/extraction contracts and fixtures remain distinct; released-version compatibility matrix and unsupported-version behavior | Revert package extraction independently |
| M5 Isolated relocation | Maintainers | Per-app clean install, type/build/unit/E2E on moved paths, independent native dependency tree; scoped CI triggers and artifacts | Restore original paths before any release |
| M6 Independent release | Release owners | Separate Server/Edge artifact IDs, provenance, release notes and rollback targets; no automatic joint deployment | Roll back only the affected app |
| M7 Successor record | Architecture owner | Verified graph/ID reconciliation, supported released-version matrix, documented successor and maintenance policy | Keep Edge repo available; no data deletion |

Graph reconciliation must include file moves and renamed paths while retaining original source identity. Current doc-links resolves explicitly discovered IDs; it does not recursively import another repository or provide this exact-set proof. No `SDD-086` or `NFR-023` from the old unmerged draft is treated as registered authority.

A rejected/failed gate leaves both current repositories and deployments in place. Secret provisioning, production schema changes and provider webhook switching are separate rollout operations, not relocation tests.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
