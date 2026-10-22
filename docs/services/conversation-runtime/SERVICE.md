---
id: ZAI:SERVICE-CONVERSATION-RUNTIME
status: active
superseded_by: null
version: "0.2.0"
relations:
  - type: relates_to
    target: ZAI:ADR-106
---

# Conversation Runtime service boundary

The [independent package](../../../services/conversation-runtime/package.json)
runs the bounded conversation loop: claim work, obtain current scoped context,
invoke model/tool ports, coordinate delivery and report completion. Its authority
is [ADR-106](../../decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md).

Read the [Agent](../../domains/agent/CHARTER.md) and
[LINE OA Studio](../../domains/line-oa-studio/CHARTER.md) charters for business
ownership. Core keeps authoritative identity/consent, admission/jobs, account
binding, channel secrets, protected Work mutations and MSP/GKS adapters. The
Runtime does not import Next.js or Prisma, access Core tables or talk directly to
MSP/GKS. A service credential does not grant end-user business permissions.

The operation wire shape is defined by
[operation.schema.json](../../../services/conversation-runtime/contracts/v1/operation.schema.json).
The [executable validator](../../../services/conversation-runtime/src/contracts.js)
also enforces cross-field receipt ID/hash equality and serialized UTF-8 byte
limits, which portable JSON Schema cannot express. Core validates durable receipt
and source bindings against its scoped state; a schema-valid request alone is
insufficient authority.
Core ports revalidate scope, lease/fencing and authority. Uncertain provider
delivery is not treated as safe to replay. Existing legacy and Runtime cohorts
remain governed by ADR-106; a ready container does not select a cohort.

## Context receipt correction

The [FR-234 source](../../features/FEAT-037/requirements/FR-234.md) and
[SDD-100 receipt contract](../../requirements/SDD-100.md) remain authoritative.
Runtime composes the evidence and authorized memory it will pass to the model;
Core retains the scoped read identity and verifies the canonical receipt and
injection binding. The canonical receipt remains content-free. Provider input
and MSP injection use the same selected packet; separate packet hashes do not
redefine the canonical receipt hash.

The trace RPC carries a bounded `contextBinding` sibling for a
`CONTEXT_RECEIPT`; it is separate from the canonical receipt payload. Core
validates the selected packet against its authorized source references and
persists content-free binding metadata. This also covers API-010 episodic
memory without an API-011 thread packet. A local binding does not assert that
an external MSP injection receipt was recorded.

This correction changes both sides of the private v1 operation boundary.
Deploy matching Core and Runtime revisions together after stopping new claims
and draining/reconciling existing work under ADR-106. An older Runtime that
omits the verified binding must fail closed against the corrected Core. Local
tests do not establish rolling compatibility, production cutover or a live MSP
acknowledgement. See the
[application verification record](../../../reports/gap-analysis-2026-10-23/application-fixes.md)
for executed checks and remaining limits.

The package has independent scripts/lockfile and a boundary build. Its
[README](../../../services/conversation-runtime/README.md) describes startup and
health. Configuration values and credentials are not documentation content.
Production routing/cutover and database authority are outside this documentation
change. This page reports source boundaries, not a fresh live integration result.

Use [TESTING](TESTING.md) and the
[shadow metadata](../../../services/conversation-runtime/verification.json) for
verification. The metadata references the domain charters; it never reassigns their
models. No code-generation mirror is introduced by this pilot.

Version diff 0.0 → 0.1.0: consolidates navigation to existing Runtime authority and
its test boundary without changing runtime behavior.
0.1.0 → 0.2.0: explains the existing ContextReceipt contract at the Runtime/Core
boundary and the coordinated rollout required by its enforcement correction.
