---
id: ZAI:SERVICE-SCM
status: active
superseded_by: null
version: "0.1.0"
relations:
  - type: relates_to
    target: ZAI:ADR-111
---

# SCM service boundary

The [SCM package](../../../services/scm/package.json) hosts the
[Inventory](../../domains/inventory/CHARTER.md),
[Procurement](../../domains/procurement/CHARTER.md) and
[Commerce](../../domains/commerce/CHARTER.md) module boundaries. Their model and
permission ownership remains with the leaf domains. There is no new blanket SCM
business grant.

[ADR-111](../../decisions/ADR-111-SCM-SERVICE-EXTRACTION.md) describes one process
and unit of work for atomic groups such as goods receipt and POS stock effects.
It still carries a candidate lifecycle alongside later owner-specific amendments;
this service document does not silently promote it to approved production cutover.
The [handoff](../../migrations/service-extraction/SCM-HANDOFF.md) contains dated
verification and transitional-flow evidence. Its older CI status must be read
against the current workflow, which has an SCM job.

During transition the
[kernel generator](../../../services/scm/scripts/sync-kernel.mjs) reads Server's
hand-edited pricing/procurement/inventory rules and produces `src/kernel/**` with
an import rewrite. The generated mirror is not a second authoring source. Core
retains the identity/reference/file authorities specified by the relevant ports;
production routing and a single writer require separate evidence.

Use [TESTING](TESTING.md). Splitting PO and stock writes into remote calls changes
transaction semantics and is not a test-speed optimization approved here.

Version diff 0.0 → 0.1.0: exposes existing logical owners, generation edges and
lifecycle limits without changing them.
