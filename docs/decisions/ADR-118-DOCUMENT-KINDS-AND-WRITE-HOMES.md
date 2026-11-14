---
id: ZAI:ADR-118
title: Document kinds and write homes
version: "1.0.0"
status: accepted
created_at: "2026-11-14"
last_update: "2026-11-14"
author: Claude Sonnet 5.5
superseded_by: null
approval_scope: documentation-policy-only-kind-matrix-and-write-homes-no-file-moved
approved_on: "2026-11-14"
approved_by: "Owner instruction given in chat on 2026-11-14 (the single word approve, after the lead session presented open decisions O1-O12) and relayed by the lead Claude session; no other approval is claimed"
attributes:
  doc_type: architecture-decision
  domain: platform-control
  scope: "Adopt the knowledge-kind matrix, one write home and one source-of-truth owner per kind, and the search-before-write protocol; no file is moved, renamed, deleted or rewritten and no check is enforced by this record"
relations:
  - type: relates_to
    target: ZAI:ADR-025
  - type: relates_to
    target: ZAI:ADR-039
  - type: relates_to
    target: ZAI:ADR-081
  - type: relates_to
    target: ZAI:ADR-113
  - type: references
    target: ZAI:DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113
---

# ADR-118 — Document kinds and write homes

**Status:** Accepted on 2026-11-14 as a documentation-policy decision. It
records an owner instruction given in chat and relayed by the lead Claude
session. It is not an approval by any other person or agent. It has no
production, deployment, data or runtime effect, moves no file, and enforces no
check by itself.

## Context

Agents could not tell that a document already existed, so they wrote a
duplicate or overwrote one. The
[redesign proposal](../plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md)
(merged as a candidate, `source_of_truth: false`) measured why: the `docs/`
tree is well shaped, but several kinds of knowledge have more than one
legitimate write home, no command answers "what already exists about this
subject", and nothing checks placement or metadata for added files. It also
measured the coupling that makes relocation costly: runtime readers of
documentation paths, 243 annotation lines naming `docs/` paths, and pinned
manifests.

The owner's direction, relayed by the lead session: rearrange and index the
existing documents; do not regenerate or rewrite them from code, because
rationale and decisions cannot be recovered from code.

## Decision

### D1 — The kind matrix and write homes are adopted

Section 4 of the proposal (kinds K1 to K18, each with one write home, one
source-of-truth owner, legacy homes that take no new documents, and generated
views) is adopted as repository documentation policy. A new tracked document
goes only in the write home of its kind; if no kind fits, the matrix is
amended through an ADR or a profile amendment, and no folder is added by
choice. Existing paths keep their identities and are re-labelled, not moved.
The matrix is stated in the proposal and will be carried by a policy file
(`docs/governance/DOCUMENT-KINDS.json`) when the catalog work lands; until
then the proposal's table is the text of record, and where this ADR and the
proposal differ, this ADR governs.

### D2 — The search-before-write protocol is adopted

Before creating a document, an agent searches for the subject (the exact id,
the subject words, the intended home), reads the source-of-truth owner for the
kind, and then extends or supersedes an existing document rather than writing
a parallel copy. A search miss is never proof of absence (AGENTS.md section
21); the agent enumerates the intended home. New documents declare `prior_art`
in frontmatter. The command that implements the search is delivered by a
separate change; this decision does not claim it exists yet.

### D3 — Enforcement is staged and applies to added files only

Placement, metadata, prior-art and source-of-truth checks (proposal D1 to D5)
apply to files added or renamed into a path, are introduced report-only first,
and use no baseline. Existing files never fail them. Canonical requirement and
feature records (K2) keep their own format and validators and are excepted.
Nothing in this ADR turns a check on.

### D4 — Owner decisions O1 to O12 are recorded as follows

The owner's single instruction was read, by the lead session, as adopting the
architect's stated view for each open decision, **except** that nothing in the
file-relocation stage is approved. Each line says what is decided and whether
anything is executed by this record.

| # | Decision | Recorded outcome | Executed here |
|---|---|---|---|
| O1 | Adopt the kind matrix and write-home policy as an ADR | adopted (this record) | yes, as policy text only |
| O2 | Enforcement style for placement, metadata and prior-art checks | added-file rule, no baseline | no, later stage |
| O3 | Where dated assessments live | keep `reports/` outside `docs/` | n/a, no change |
| O4 | Count `reports/*.md` and similar as documentation for CI classification | decided in principle | **no**: needs its own reviewed CI change with tests |
| O5 | One closed `status` vocabulary | on added files only; existing files are not rewritten | no, later stage |
| O6 | Disposition of `todo.md` and `hardware-performance-audit.md` | archive, decided in principle | **no**: needs the owner's explicit per-file approval |
| O7 | Retire `.agent/`, `agent/`, `.rwang-tasks/` as August 2026 machinery | mark legacy and freeze, decided in principle | **no**: needs the owner's explicit per-file approval |
| O8 | Redirect the superpowers skills' default output from `docs/superpowers/` to `docs/plans/` | decided in principle | **no**: needs the owner's explicit approval; `docs/superpowers/` stays |
| O9 | Catalog is generated and ignored, not committed | ignored (ADR-081) | no, delivered with the catalog |
| O10 | Owner of the kinds policy file | the existing governance integrator role (AGENTS.md section 19) | no |
| O11 | Move the dated Compact narrative out of `docs/README.md` | yes, as a separate later edit | **no** |
| O12 | Source-of-truth uniqueness check | audit the 17 existing `source_of_truth` declarations first | no, later stage |

### D5 — Not approved by this decision

The following are **not approved** and must not be done on the strength of
this record:

- any relocation, rename, deletion or archiving of an existing file, including
  `todo.md`, `hardware-performance-audit.md`, `MASTER-PROMPT.md`, `.agent/`,
  `agent/`, `.rwang-tasks/` and `docs/superpowers/`;
- any redirect stub that replaces a file;
- changing `scripts/ci-code-changes.mjs` or the workflow path filters;
- turning on any new preflight check;
- rewriting statuses or frontmatter of existing documents;
- touching `apps/edge/docs/`, which keeps its own namespace and preflight.

Each such step needs the owner's explicit, per-file approval at the time, and
must first re-enumerate the affected scope (AGENTS.md section 21) and check
the runtime and verifier readers listed in the proposal (section 3.1).

### D6 — What does not change

Requirement, feature, ADR and change-request identities and subject anchors
(AGENTS.md section 18, ADR-039), canonical record paths, the registry index,
the generated compatibility exports, the id ledger and the baselines, the
document graph and preflight, the ADR-025 domain spine, and every frozen or
pinned family stay exactly as they are. Paths read at runtime by Knowledge
Studio, the roadmap board and the governance source verifier stay where they
are.

## Alternatives and consequences

Alternatives not taken: a mass relocation to a flatter or date-based layout
(rejected, it detaches the domain spine and every charter-based check and
breaks hundreds of readers); regenerating documents from code (rejected by the
owner); a committed document catalog (rejected, ADR-081's conflict pattern);
a baseline ratchet for placement and metadata (rejected in favour of the
added-file rule, which has nothing to conflict).

- Policy is now citable: a reviewer can say a new document is in the wrong
  home by naming its kind.
- The matrix is policy text until a later change implements and enforces it;
  until then compliance is by review.
- The not-approved list in D5 keeps the file-relocation stage closed.

## Verification

Documentation only. `npm run govern` passes locally with no critical finding.
No hosted CI, deployment or production result is claimed by this record.

## CHANGELOG

- 1.0.0 (2026-11-14): initial record.

## Authority

Source: the owner's chat instruction of 2026-11-14, relayed by the lead Claude
session, on the candidate proposal merged earlier. This ADR does not
substitute for any approval that file moves, CI classification changes or
production work require.
