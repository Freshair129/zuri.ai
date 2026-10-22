---
name: zuri-doc-writing
description: "Use when drafting, reviewing, reorganizing or removing zuri.ai repository documentation, or assessing documentation and code against canonical requirements. Covers source-linked SRS views, design notes, ADR proposals, indexes and evidence reports; not product-agent conversations or application implementation."
metadata:
  version: "0.6.0"
  status: active
  superseded_by: null
---

# Zuri documentation authoring

Read the [Doc Writer role](../../roles/doc-writer.md) for inputs, write boundaries
and return contract. Paths below resolve from this skill or the assigned worktree,
never from another checkout. Follow current [AGENTS.md](../../../AGENTS.md) and
the scoped [verification policy](../../../docs/architecture/VERIFICATION-POLICY.md).
The developer-only DDC task preflight and controller were retired by
[ADR-113](../../../docs/decisions/ADR-113-RETIRE-DEVELOPER-DELIVERY-CONTROL.md);
do not create DDC task records or receipts. Use the user's task and repository
sources to establish scope, then follow ordinary Git review, relevant checks,
document governance, and required hosted CI.

## Select the source before writing

1. Start with [the documentation entrypoint](../../../docs/README.md) and
   [directory register](../../../docs/governance/DOCS-DIRECTORY-REGISTER.md).
   Use the [document profiles](../../../docs/governance/DOCUMENTATION-REQUIREMENTS-SPEC.md)
   to select an applicable artifact shape, retaining that document's recorded
   `proposed` lifecycle. Accepted ADRs and the canonical format still control;
   the profile is not approval to add requirements or declare a new owner.
   For a direct child of `docs/`, inspect the
   [root-file register](../../../docs/governance/ROOT-FILE-REGISTER.md) too.
2. Enumerate tracked, untracked and ignored files in the affected scope before
   an absence claim or a replacement. README and registry lists are navigation,
   not a complete filesystem census. Inspect existing documents and inbound
   references before deciding that a new document is needed.
   Resolve exact qualified IDs using the registry; folder names and crosswalks
   alone do not assign feature membership or domain ownership.
3. Read the relevant parent decision and peer contracts, plus the
   [governance profile](../../../docs/migrations/document-reintegration/GOVERNANCE-PROFILE.md)
   and [canonical format](../../../docs/migrations/document-reintegration/CANONICAL-FORMAT.md).
4. Classify the requested change before editing:

| Change | Source and boundary |
|---|---|
| FEAT explanation | Its `docs/features/FEAT-nnn/feature.md` record; preserve the pinned row |
| FR explanation | The exact path in the generated registry index; membership is explicit |
| NFR/BR/SEC/SDD explanation | The exact `docs/requirements/` record; preserve its subject and provenance |
| New/changed/retired behavior or membership | Follow doc-first handling and the sanctioned record migration within the trusted mandate; let Sol resolve in-scope technical choices; do not patch row hashes or the ID ledger |
| Rationale or audience view | Owning domain feature note, citing canonical records and their revision |
| ADR, issued change, risk, task evidence or proposal intake | Its existing authority/path and lifecycle; do not convert it into a requirement |
| Generated export or view | Find and edit its source; return regeneration work to the integrator |

Domain-first reading does not change canonical storage. A domain SRS links the
exact registry-selected FEAT/FR records and their lifecycle; it does not copy
requirement statements or acceptance criteria into a second authority. Use the
[domain SRS template](../../../docs/templates/DOMAIN-SRS.md.template) when that
profile applies. A cross-domain audience view links the same records and
confirmed charters; it does not create another domain, owner, or requirement.

## Make a bounded document change

Use the existing document template/metadata format for its family. Preserve
source-preserved wrappers and the original row lifecycle; a new generic `status`
must not overwrite those meanings. Maintain stable IDs, valid links and typed
relations according to [link metadata](../../../docs/GOVERNANCE-LINK-METADATA.md).
Record assumptions and unresolved decisions separately from approved facts.

Place documents in the existing source-owned family selected by the directory
register and profile. Do not create a new root document, feature folder, PRD or
SRS merely to fill an apparent gap. Reuse or extend the appropriate document
when it already covers the subject. An index entry records discoverability; it
does not approve a new source or justify removing an existing one.

For multiple diagrams/views, identify the common source IDs and revision and
write only audience-specific explanations. Do not duplicate rules or formulas as
independently editable authority. Show a version diff and parent/peer impact.

Proceed with document changes covered by the trusted mandate and keep their
reviewable source, rationale and evidence. Let Sol resolve technical choices
within that scope. If a proposed semantic change would exceed the mandate, record
a typed blocker and continue independent eligible work; do not request a
per-gate human approval.

## Cleanup and gap assessments

- Classify each deletion target by content, lifecycle and consumers. A file in
  `docs/plans/` can be an approved contract or historical evidence; its folder
  does not make it a disposable plan. Apply the user's actual deletion scope.
- Preserve canonical identities, approved contracts and pinned provenance.
  Moving a file requires reader/link reconciliation; changing a pinned source
  row requires the existing reviewed migration, even for a navigation repair.
  Do not leave per-file pointer documents at the root as a cleanup substitute.
- Update affected manual indexes in the same patch, then regenerate owned
  views serially. Commit-pinned Git links may preserve a removed plan's approval
  history. Never rewrite a frozen inventory or receipt to look current.
- Put dated code/requirements assessments in the existing `reports/` family,
  link them from its index and the documentation entrypoint, and bind them to
  the inspected revision. They are evidence snapshots, not plans or new SoT.
- Compare canonical lifecycle, actual code and test behavior separately. Use
  explicit findings such as missing/partial behavior, source conflict,
  unmapped evidence, or proposal-only scope. Code/test annotations and roadmap
  completion labels do not prove behavior, test execution or deployment.
  Record unreviewed clauses and unexecuted checks; do not turn a partial audit
  into a product-wide completion claim or create a development plan unasked.

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

Version diff (2026-10-15): ordinary authoring uses the v4 task-readiness record
and automatic preflight; metadata repair preserves task identity and does not
require packet construction or another human approval.

Version diff (2026-10-22): ADR-113 retires the developer-only DDC procedure.
Current documentation work uses the user's task, repository sources, document
governance, relevant checks, Git review and required hosted CI; the older v4
task-readiness and automatic-preflight procedure is historical.

Version diff (2026-10-23), 0.5.0 → 0.6.0: links current document profiles and
filesystem registers, makes source/profile selection and index maintenance
explicit, distinguishes canonical storage from SRS reading views, and routes
dated gap assessments to reports. The proposed profile keeps its lifecycle;
no product requirement, ownership, approval gate or DDC procedure is added.
