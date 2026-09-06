---
id: ZAI:ADR-062
version: "0.3.0b"
status: beta
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T21:40:04+07:00,RWANG"
attributes:
  domain: architecture
  scope: server-edge-repository-topology
relations:
  - type: relates_to
    target: ZAI:ADR-024
  - type: relates_to
    target: ZAI:ADR-025
  - type: relates_to
    target: ZAI:ADR-039
  - type: relates_to
    target: ZAI:ADR-041
  - type: relates_to
    target: ZAI:ADR-051
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:FEAT-019
---

# ADR-062 — Candidate Server/Edge monorepo with independent releases

**Status:** Approved for isolated snapshot relocation on 2026-09-06. Source migration is under verification; independent release and repository retirement remain separate gates.

The original heading remains pinned by ADR-039's subject anchor; the status above
records approval without renaming the canonical subject.

## Context

Server LINE behavior is already implemented in the server repository under ADR-061. Edge [PR #22](https://github.com/Freshair129/zuri-edge-device/pull/22) merged into master as `b089320` on 2026-09-06; hosted verify passed for head `f7e047a`. Stateless Codex is temporarily rejected with `LOCAL_POLICY_UNAVAILABLE` before execution, without provider fallback. Installed-device and production activation require separate evidence. The earlier unmerged ADR-062 proposal said to relocate first and then implement ADR-061; that order is now obsolete. Repository layout must not block the current two-repository rollout.

## Decision

1. Prefer evolving the existing `Freshair129/zuri.ai` into a monorepo after rollout and migration readiness are reviewed. The owner approved snapshot relocation; retain the original Edge repository/history for provenance and rollback. Do not import the discontinued `Freshair129/zuri` product.
2. Target `apps/server`, `apps/edge`, and a transport-neutral `packages/contracts`. Server and Edge remain independently built, installed, versioned, released and rolled back. A shared commit never requires simultaneous device deployment.
3. Begin with the existing npm toolchain if approved. Do not combine relocation with dependency upgrades, framework changes, LINE cutover, database migration or credential changes. Server installation must not require Edge native dependencies.
4. Root docs remain the canonical product/domain/global requirement registry. Preserve original Edge IDs with an explicit repository-qualified mapping and source provenance. No renumbering or silent collision resolution.
5. Studio owns LineConversationJob and account policy; CRM owns Conversation/Message; Integration owns channel secrets and LINE calls; Agent owns answer contracts; Identity owns authentication. The Edge app consumes wire contracts and does not import server source or access server tables.
6. Current metadata linking is not a monorepo graph importer. Before relocation, extend discovery and identity mapping, preserve exact source/ID sets, and prove both original per-repository graphs are represented. Unknown namespaces must not be hidden by dropping nodes.
7. Preserve the original Edge repository/history until per-app releases, graph reconciliation and rollback are proven. Retirement is a reviewed successor/maintenance record, never deletion of local runtime data or secrets.

## Layout

```text
zuri.ai/
  apps/server/          web, API, server worker; own build/release
  apps/edge/            optional device runtime; own native dependencies/release
  packages/contracts/   reserved; extraction deferred until separately verified
  docs/                 canonical product/domain records and qualified lineage
  package.json          root governance/application command orchestration
```

## Alternatives and tradeoffs

Separate repositories with a versioned contracts artifact remain viable and are the current operational state. They preserve source-access and release boundaries at the cost of coordinated reviews. A monorepo simplifies joint contract review but adds path/CI/graph migration and shared Git visibility. One runtime/deployment is rejected: LINE must work without an online device, and Edge installation must not include the server database/application.

## Approved private-source and publication prerequisite

On 2026-09-06 the owner approved private-first preparation. GitHub now reports
`Freshair129/zuri.ai` PRIVATE; authenticated Git access succeeds. Edge remains
separate. The legacy `ghcr.io/freshair129/zuri.ai` package remains PUBLIC, with
Actions access for this repository. Source privacy alone does not establish image
privacy. The current local service uses `zuri-ai-web:local` and was healthy.

The owner approved temporary build-only CI: retain Compose validation and Docker
build for every existing trigger, remove registry login and package write
permission, and set publication to literal false. Existing public image versions
remain available, but receive no new builds. The regression contract is
`tests/unit/docker-publication-containment.test.js`.

Before any Edge import, verify containment is merged and destination source is
still PRIVATE. Before re-enabling publication, review the private destination,
publisher permissions, authenticated consumer pull, per-app Docker contexts and
independent rollback. Replace the containment contract explicitly in that reviewed
change; changing source visibility is not sufficient. No runtime restart, token
provisioning, data migration or package deletion is part of this prerequisite.

Internal Server document-ID collisions were repaired in PR #258. Full source/history
inventory, cross-repository graph reconciliation and independent release evidence
remain open. Keep separate app lockfiles and never make the destination public as
a rollback after importing private Edge material.

## Approved snapshot implementation

The isolated migration uses Server `be9e1440` and synthetic Edge `13422da`.
See [execution evidence](../migrations/monorepo/EXECUTION.md) and
[per-file provenance](../migrations/monorepo/source-manifest.json).
Source moves preserve app working directories and independent lockfiles. Server
governance reads canonical root docs explicitly; its legacy node IDs remain stable,
while node paths identify `apps/server/...`. The combined graph qualifies Edge
IDs and verifies original registry identities/edges against imported content.
Customer-derived fixtures have synthetic replacements; held operator/business
files are accounted for outside the import. No history rewrite or runtime restart.

## Approval and exit gates

Approve the target layout and source-access model, inventory source/history/licensing without secrets or customer data, record exact ID and graph mappings, validate independent installs/builds/tests, verify compatibility against recorded released versions, then import with an independently reversible release plan. Detailed gates: [migration plan](../roadmap/PLAN-ZURI-MONOREPO-MIGRATION.md). Until they pass, ADR-041 repository separation remains operational policy.

No new customer FR/FEAT or design-rule number is invented for moving directories. Existing FEAT-019 and FR-148..150 retain their subjects; phase notes remain documentation children. MSP, GKS and GenesisBlockDB retain their external authority.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
| 0.2.0b | 2026-09-06 | candidate | Approved private source and build-only publication prerequisite; relocation gates remain open | base 4486be20 | RWANG |

Version diff 0.2.0b → 0.3.0b: owner-approved snapshot layout, scoped graph discovery and provenance; release gates remain open.
