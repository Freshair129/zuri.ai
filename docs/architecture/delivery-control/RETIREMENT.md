# Developer Delivery Control retirement

**Status:** Retired on 2026-10-22 by [ADR-113](../../decisions/ADR-113-RETIRE-DEVELOPER-DELIVERY-CONTROL.md).

The developer-only DDC task preflight, controller, supervisor, worker dispatch
and observation system, local model/gate policy, and Mission Control worker
surfaces are retired. This directory remains as a history-preserving link
target for old records; it is not an active workflow or policy source.

Current repository work follows [AGENTS.md](../../../AGENTS.md), the scoped
[verification policy](../VERIFICATION-POLICY.md), Git review, and the existing
required hosted CI. `npm run govern` and document-registry checks remain active
documentation governance, not DDC.

The business Project Manager, its work tracking and Approval Gateway, business
agent admission, `/control/roadmap`, document governance, regular CI, and
environment-specific deployment controls remain separate active systems.
Historical DDC receipts and local-only data are retained as history; this
retirement does not delete shared or private state or update a running image.
