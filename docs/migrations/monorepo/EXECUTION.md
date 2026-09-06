---
id: ZAI:MONOREPO-SNAPSHOT
version: "0.1.0b"
created_at: "2026-09-06T21:40:00+07:00,RWANG,be9e1440"
last_update: "2026-09-06T21:40:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: architecture
  scope: isolated-source-relocation
relations:
  - type: relates_to
    target: ZAI:ADR-062
  - type: relates_to
    target: ZAI:PLAN-MONOREPO
---

# Monorepo snapshot execution

[[ZAI:ADR-062]] authorizes this C-3 / HIGH source-topology change.
[[ZAI:PLAN-MONOREPO]] keeps independent deployment, released-device compatibility
and source-repository retirement as separate gates. No production activation,
database migration, provider call or joint release occurs in this source migration.

## Provenance and rollback

[The manifest](source-manifest.json) accounts for every tracked Server file at
`be9e1440` and Edge file at `13422da`. The latter is the approved synthetic-fixture
preparation based on Edge `a470a458`. Original Edge history stays in its private
repository. Original worktrees, device configuration and running containers are
unchanged. Revert this source commit before any release to restore the prior layout;
never make the destination public as a rollback.

Edge imports 599 reviewed snapshot files. Eight original files remain held:
the original environment template values, discovery payload, quotation document,
two direct-send operator scripts and three operator probes. The old CI workflow is
rewritten at root. A new blank-key environment template is generated independently;
no values or actual `.env` are copied. Known credential-token/private-key patterns
were checked in imported text with zero findings; this is bounded pattern evidence,
not a claim that all possible secret formats or historical revisions were scanned.

Customer-derived catalog/chat/query fixtures are replaced by a deterministic
synthetic generator. All referencing query sets and test consumers move together.
Synthetic lexical replay is not evidence of real-model quality or production latency.
The manifest records original blobs even where a relocation adapter changes content.

## Application and documentation roots

| Root | Ownership |
| --- | --- |
| docs/ | Canonical Server product/domain/FR/FEAT subjects and metadata |
| apps/server/ | Web, API, worker, contracts, tests, Prisma, scripts, public CA and own lockfile |
| apps/edge/ | Optional device runtime, GUI assets, scoped governance, tests and own lockfile |
| root package.json | Command delegation; no combined application dependency tree |

Run installs independently. Server uses Node 22; Edge CI uses Node 24. Edge's
existing Docker Node 20 setting is unchanged and remains a separate compatibility
question. No dependency versions change. Application scripts execute from their
app directory, preserving local path behavior. Root npm commands delegate to Server.
The Server production image context is `apps/server`; publication remains literal
`false`, with no registry login or package-write grant.

Governance explicitly resolves shared root docs and app-local sources. Flat
temporary test repositories retain their original behavior. No filesystem symlink
or duplicate canonical documentation tree is required. The generated readiness
projection is copied to `apps/server/runtime/domain-state.json` for the app Docker
context; a test requires exact agreement with the canonical root projection.

## Graph and contract verification

The Server scanner retains original node IDs and publishes actual app file paths.
The combined scanner reads Edge source/registry identities, verifies requirement
declarations, recomputes hashes and reproduces original annotation/Markdown edges.
It also discovers additional imported documents. Every original Edge node/edge must
be reproduced or explicitly accounted for as an external hold; unknown/missing
evidence fails. Only the combined view prefixes Edge IDs with `edge::`; source
documents retain their IDs. Source snapshots and generated projections remain
separate. New crosslinks and qualified references are checked by governance.

The Server lease integration test passes the actual `claimEdgeConversation` output
to Edge's actual `conversationEnvelope` validator. It checks forbidden reply-token
and unsupported-version rejection alongside the existing lease/tenant fencing.
This proves current source compatibility, not all previously released devices.
Conversation and extraction contracts remain distinct; package extraction is deferred.

## Verification gates

Local clean installs completed for both apps. Edge: 913 passed, three existing
environment-gated skips; typecheck/build passed. Server path corrections and current
producer/consumer tests passed focused checks. Full Server tests/build/E2E, final
graph reconciliation and hosted CI must pass before merging. The result receipt
will distinguish these from independent release and production evidence.

## Version diff / CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0b | 2026-09-06 | beta | Implement approved snapshot layout with app-local dependencies, source receipt and graph verification | be9e1440 / 13422da | RWANG |
