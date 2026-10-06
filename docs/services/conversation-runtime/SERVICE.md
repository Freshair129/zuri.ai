---
id: ZAI:SERVICE-CONVERSATION-RUNTIME
status: active
superseded_by: null
version: "0.1.0"
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

The exact operation wire source is
[operation.schema.json](../../../services/conversation-runtime/contracts/v1/operation.schema.json).
Core ports revalidate scope, lease/fencing and authority. Uncertain provider
delivery is not treated as safe to replay. Existing legacy and Runtime cohorts
remain governed by ADR-106; a ready container does not select a cohort.

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
