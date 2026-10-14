---
name: zuri-doc-writing
description: "Draft, refine or reconcile zuri.ai repository documentation against canonical requirements, parent/peer decisions and delivery evidence. Use for requirement/design notes, ADR proposals, source-linked diagrams and documentation handoffs; not for product-agent conversations or application implementation."
metadata:
  version: "0.2.0"
  status: active
  superseded_by: null
---

# Zuri documentation authoring

Read the [Doc Writer role](../../roles/doc-writer.md) for inputs, write boundaries
and return contract. Paths below resolve from this skill or the assigned worktree,
never from another checkout. Follow current [AGENTS.md](../../../AGENTS.md) and the active
[coding-delivery procedure](../../../docs/architecture/delivery-control/WORKFLOW-POLICY.md).
The direct current user task or standing delegation evidenced in trusted
conversation/harness context is sufficient mandate provenance. Root records the
source message/reference, repository, objective, effects and prohibitions once;
agent-derived packets reference that record. No user-authored packet, signature
or extra approval is required. Separately supplied trust context must come from
trusted conversation or harness evidence, not copied packet fields. Structural
validation alone is not authorization. Route in-scope process decisions and
failures to Sol; there is no per-gate human approval.

## Select the source before writing

1. Enumerate the document inventory or `git ls-files` before an absence claim.
   Resolve exact qualified IDs using the registry; folder names and crosswalks
   alone do not assign feature membership or domain ownership.
2. Read the relevant parent decision and peer contracts, plus the
   [governance profile](../../../docs/migrations/document-reintegration/GOVERNANCE-PROFILE.md)
   and [canonical format](../../../docs/migrations/document-reintegration/CANONICAL-FORMAT.md).
3. Classify the requested change before editing:

| Change | Source and boundary |
|---|---|
| FEAT explanation | Its `docs/features/FEAT-nnn/feature.md` record; preserve the pinned row |
| FR explanation | The exact path in the generated registry index; membership is explicit |
| NFR/BR/SEC/SDD explanation | The exact `docs/requirements/` record; preserve its subject and provenance |
| New/changed/retired behavior or membership | Follow doc-first handling and the sanctioned record migration within the trusted mandate; let Sol resolve in-scope technical choices; do not patch row hashes or the ID ledger |
| Rationale or audience view | Owning domain feature note, citing canonical records and their revision |
| ADR, issued change, risk, task evidence or proposal intake | Its existing authority/path and lifecycle; do not convert it into a requirement |
| Generated export or view | Find and edit its source; return regeneration work to the integrator |

## Make a bounded document change

Use the existing document template/metadata format for its family. Preserve
source-preserved wrappers and the original row lifecycle; a new generic `status`
must not overwrite those meanings. Maintain stable IDs, valid links and typed
relations according to [link metadata](../../../docs/GOVERNANCE-LINK-METADATA.md).
Record assumptions and unresolved decisions separately from approved facts.

For multiple diagrams/views, identify the common source IDs and revision and
write only audience-specific explanations. Do not duplicate rules or formulas as
independently editable authority. Show a version diff and parent/peer impact.

Proceed with document changes covered by the trusted mandate and keep their
reviewable source, rationale and evidence. Let Sol resolve technical choices
within that scope. If a proposed semantic change would exceed the mandate, record
a typed blocker and continue independent eligible work; do not request a
per-gate human approval.

## Verify and hand off

Inspect links, metadata, identity preservation and source/view consistency. Use
executed receipts for delivery claims; references to tests are not test results.
Request the verifier/integrator to execute the checks this role cannot run.

- After explanatory canonical edits, the integrator runs `npm run docs:registry`,
  then `npm run docs:graph` and `npm run docs:views` from the composed worktree.
- Run `npm run govern` on that composed tree. It checks registry/view freshness
  rather than repairing canonical exports. Do not run concurrent generators in
  the same tree.
- Entrypoint/corpus-source edits also need `npm run docs:llms` and its check.
  Follow [ADR-081](../../../docs/decisions/ADR-081-GENERATED-VIEWS-ARE-BUILT-NOT-COMMITTED.md)
  and current tracking rules; generated does not mean every output is committed.

If a generator dependency is missing, report the failing command and the
unexecuted checks. Do not hand-create graph JSON or report a missing run as PASS.
Return the role's full handoff contract with actual evidence and remaining work.

Version diff (2026-10-14): routes in-scope authoring decisions and gate-failure
triage to Sol, grounds the trusted mandate in direct task or standing-delegation
context, and replaces routine per-gate human approval with autonomous handling
and typed blockers for work outside the mandate.
