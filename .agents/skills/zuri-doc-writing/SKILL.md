---
name: zuri-doc-writing
description: "Draft, refine or reconcile zuri.ai repository documentation against canonical requirements, parent/peer decisions and delivery evidence. Use for requirement/design notes, ADR proposals, source-linked diagrams and documentation handoffs; not for product-agent conversations or application implementation."
metadata:
  version: "0.1.0"
  status: active
  superseded_by: null
---

# Zuri documentation authoring

Read the [Doc Writer role](../../roles/doc-writer.md) for inputs, write boundaries
and return contract. Paths below resolve from this skill or the assigned worktree,
never from another checkout. Follow current [AGENTS.md](../../../AGENTS.md).

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
| New/changed/retired behavior or membership | Draft for review and the sanctioned record migration; do not patch row hashes or the ID ledger |
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

If approval already covers this document change, proceed within it. Otherwise
deliver the reviewable proposal at the repository's doc-first boundary. This
skill neither grants approval nor asks for it again when already supplied.

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
