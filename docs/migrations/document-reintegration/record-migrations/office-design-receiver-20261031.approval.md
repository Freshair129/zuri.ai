---
status: approved
version: "0.1.0"
approval_scope: owner-requested implementation scope only
---

# Visual Office design handoff receiver

Related: [ADR-025](../../decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md)
and [FR-294](../../requirements/FR-294.md).

## Approval

The owner requested on 31 October 2026: “ลุยต่อฝั่ง zuri.ai ตรวจ contract แล้วทำตัวรับ handoff เพื่อลงทะเบียน floor, agent design และ asset IDs เก็บลง DB พร้อมทดสอบ end-to-end โดยไม่สร้างสถานะหรือ approval ปลอม”. This authorizes implementing and testing this bounded receiver. It does not record approval of unreviewed technical details, a successful test, production migration, Agent execution, or a new Business permission. The document status records that actual implementation mandate only. Independent patch review and measured verification remain separate.

## Contract and ownership

Project Manager already owns Business/Workspace presentation configuration through the business module. Its new Office design registry holds external design identities, immutable revisions, content-addressed GLB bytes and import receipts. Asset Management's physical Asset register and Agent's BusinessAgentConfig remain untouched. Floor domain keys, team roles, capabilities and workflows remain design data; they do not grant access, create domains, or become runtime Agents.

Pin the producer schema and full semantic verifier from Freshair129/zuri-visual-office commit `b4e2d8edec9d8dbad32573d860cff3a6a27efbbd`. Accept the existing `zuri-office-design-handoff/v1` ZIP with null bindingContext and null initial crosswalk. Never run JavaScript or fetch URIs supplied by a package. Verify bounded ZIP inventory/CRC, exact pinned schema, UUID derivation, graph/snapshot consistency, SHA-256, GLB container compatibility, and measured custom bounds before writing.

Only a persisted-session principal who currently owns the selected active Business may import or read. Resolve Business/Tenant from a selected active BUSINESS Workspace; the package cannot supply scope. Revalidate ownership inside the commit transaction. Missing and unauthorized targets return the same refusal. A platform grant alone is insufficient. This initial same-origin Server API does not enroll the separately hosted Office client or grant CORS/client credentials.

## Receiver behavior

`POST /api/businesses/[businessId]/office-designs` accepts ZIP bytes, `workspaceId` query, `If-Match` equal to a quoted integer (0 for a first import), and `Idempotency-Key`. `?dryRun=1` verifies and previews without registration. `GET` on the same route reads committed revision/mappings with `workspaceId` and optional positive `version`; a scoped `/assets/[sha256]` GET returns stored GLB bytes. Responses are private/no-store. Mutations require matching request Origin when supplied; cross-site Fetch Metadata is refused. Body streaming stops at 100 MB, expanded ZIP at 100 MB, each entry at 20 MB; the pinned producer imposes its tighter custom-model bounds. Verification runs in a resource/time-bounded worker.

A scoped source/package crosswalk issues internal UUIDs and stable codes; external UUIDs never become primary keys. Expected-version compare-and-swap, immutable revisions and idempotency receipts commit with all identity/blob rows and a scoped actor-attributed AuditEvent. Identical retries return the original mapping; key reuse with a different command or stale new writes returns 409. Stored design registration is reported only after transaction commit, with `runtimeAgentsCreated: 0` and `permissionsGranted: 0`. No approval row is synthesized.

## Verification boundary

Test the actual producer ZIP through authenticated HTTP handlers into an isolated real SQLite DB, disconnect/reopen and read back mappings and exact GLB bytes. Cover replay, changed content/stale version, cross-Business/Tenant denial, revoked membership/session, corrupt schema/hash/graph/binary/custom descriptor, bounded input, atomic rollback and concurrent writes. Qualify generated schema and additive migration separately on disposable local PostgreSQL. Build, governance and independent review are required; local evidence does not prove hosted integration or deployment. Historical Visual Office performance acceptance and roadmap tasks remain unchanged.

## Version diff

0.1.0 adds the owner-requested receiver scope and a new standalone FR; no existing requirement is repurposed. Technical implementation decisions above are the integrator's in-scope choices and remain subject to patch review.
