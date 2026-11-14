---
id: ZAI:ADR-118
title: Document kinds and write homes
version: "1.3.0"
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

Section 4 of the proposal (kinds K1 to K18, each with one write home, a
source-of-truth owner (K17 session memory has none, and K18 generated views are
owned by their generator and sources), and legacy homes that take no new
documents) is adopted as repository documentation policy. A new tracked document
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
kind (where the kind has none, the generator or the absence is stated), and then extends or supersedes an existing document rather than writing
a parallel copy. A search miss is never proof of absence (AGENTS.md section
21); the agent enumerates the intended home. New documents declare `prior_art`
in frontmatter. The command that implements the search is delivered by a
separate change; this decision does not claim it exists yet.

### D3 — Enforcement is staged and applies to added files only

The placement, metadata and prior-art checks (proposal D1 to D3) apply to
files added or renamed into a path, are introduced report-only first, and use
no baseline; existing files never fail them. The duplicate-subject check
(proposal D4) keeps a shrink-only list of the existing pairs, as the proposal
states. The source-of-truth uniqueness check (proposal D5) waits for the audit
of the 17 existing `source_of_truth` declarations (O12) before it applies to
anything but added files. Canonical requirement and feature records (K2) keep
their own format and validators and are excepted. Apart from the report-only
warnings of amendment 1, nothing in this ADR turns a check on.

### D4 — Owner decisions O1 to O12 are recorded as follows

The owner's single instruction was read, by the lead session, as adopting the
architect's stated view for each open decision, **except** that nothing in the
file-relocation stage is approved. Each line says what is decided and whether
anything is executed by this record.

| # | Decision | Recorded outcome | Executed here |
|---|---|---|---|
| O1 | Adopt the kind matrix and write-home policy as an ADR | adopted (this record) | yes, as policy text only |
| O2 | Enforcement style for placement, metadata and prior-art checks (proposal D1 to D3) | added-file rule, no baseline; D4 keeps its shrink-only list and D5 follows O12 | D1 to D3 report-only only, per amendment 1; the rest later |
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
- turning on any new preflight check, except the report-only guards of amendment 1 (warnings only, never CRITICAL);
- rewriting statuses or frontmatter of existing documents;
- touching `apps/edge/docs/`, which keeps its own namespace and preflight.

Each such step needs the owner's explicit, per-file approval at the time, and
must first re-enumerate the affected scope (AGENTS.md section 21) and check
the runtime and verifier readers listed in the proposal (section 3.1).

### D6 — What does not change

Requirement, feature, ADR and change-request identities and subject anchors
(AGENTS.md section 18, ADR-039), canonical record paths, the registry index,
the generated compatibility exports, the id ledger and the baselines, the
rules and generators of the document graph and preflight (their regenerated
output naturally includes this ADR), the ADR-025 domain spine, and every frozen or
pinned family stay exactly as they are. Paths read at runtime by Knowledge
Studio, the roadmap board and the governance source verifier stay where they
are.

## Amendment 1 — report-only added-document guards (2026-11-14)

**Source:** an owner instruction given in chat on 2026-11-14 ("approve", in answer
to the lead session's question whether to start Stage 3), relayed by the lead
Claude session. No other approval is claimed. It narrowly reverses D5's bullet
about turning on a new preflight check, and only as follows.

- Three **report-only** checks may run in `npm run docs:preflight` (and therefore
  `govern`): `doc-placement`, `doc-metadata` and `doc-prior-art` (proposal D1 to
  D3). Their severity is **WARNING**, or INFO when the guard cannot run. No
  CRITICAL is enabled, so neither `--strict`, `govern` nor CI can fail because of
  them; `--strict` still fails only on CRITICAL.
- Deliberate scope choices: generated homes are not reported (a new feature's generated design page is expected), metadata is asked only of the decision, change, domain, architecture, service, plan, roadmap, runbook, evidence and RCA kinds (instructions, templates, archive, records and generated views keep their own formats), and sealed `*.approval.md` copies under `record-migrations/` may be added.
- They examine **only files added or renamed** against the merge base (plus
  untracked, non-ignored files). There is no baseline file, and existing files
  are never reported.
- `docs/superpowers/specs/`, `docs/superpowers/plans/` and `.brain/plans/` are
  recorded as legacy homes that take no new documents (`DOCUMENT-KINDS.json`).
  Brainstorming and plan skills write to `docs/plans/` instead (AGENTS.md
  section 19). Nothing existing in those folders is moved or removed.
- Still **not** approved: any CRITICAL severity or a baseline (Stage 4), the
  duplicate-subject check (D4), the source-of-truth uniqueness check (D5, which
  waits for the O12 audit), and everything in D5 above (file moves, retirements,
  stubs, CI-classification changes, rewriting existing frontmatter, `apps/edge/docs/`).

## Amendment 2 — rules tuned to the shapes that exist (2026-11-14)

**Source:** an owner instruction given in chat on 2026-11-14 ("fix it all"; asked
to choose the scope, the owner picked "tune the rules to match reality, not
rewrite existing documents"), relayed by the lead Claude session. No other
approval is claimed. It changes **rules and the kinds file only**: no existing
document is edited, moved, renamed or deleted, and D5 still applies in full.
Severity stays WARNING/INFO, there is still no CRITICAL and no baseline, and only
added or renamed files are examined.

- Required frontmatter is per kind, set from what recent documents really carry
  (`requiredFields` in `DOCUMENT-KINDS.json`: `status` and `version` almost
  everywhere; decisions also `doc_type` and `last_update`; plans also `id` and
  `doc_type`; and so on) instead of one list for all kinds. `source_of_truth`,
  `title` and `id` are no longer demanded of every kind.
- The `status` and `doc_type` values each kind actually uses are accepted per kind
  (`vocabulary`), on top of the global lifecycle lists; values used by no kind
  (one-off words) are still reported.
- `prior_art` is asked only of the kinds that start a new subject (decision,
  change request, architecture, plan, evidence). It is not asked of domain
  documents (notes, charters and SRS views are governed by the charter and SRS
  profile and cite canonical ids), numbered `NN-` chapters of the Project Manager
  specification, documents inside a dated assessment folder (`reports/<name>-YYYY-MM-DD/`)
  or the marketing and inference-pool change bundles, and typed `relations` to
  existing documents count as the declaration.
- A new home value, `tolerated`, marks active practice that has no write home in the
  matrix yet (`.brain/reports/`, `.brain/reviews/`, `docs/migrations/`,
  `docs/governance/`, READMEs and notes beside code under `apps/` and `services/`,
  `skills/`). Documents added there are not flagged by any of the three checks
  until the owner adopts or retires the home (the apps/services/skills homes cover
  only documents beside code). This records a gap in the matrix; it does
  not make those homes write homes.
- Evidence copies may be added under `.brain/rca/evidence/` (the check does not
  verify the pairing with an RCA), and a `README.md` or `index.md` file is exempt
  from the metadata and prior-art checks, though not from placement. A required
  field with an empty or null value counts as missing.
- Still reported: new documents in archive, reference, `.agent/`, `agent/`,
  `docs/roadmap/PLAN-*`, `docs/superpowers/` and other legacy or frozen homes;
  new documents without the required frontmatter or with an unused status or
  doc_type; and new decision, change, architecture, plan and evidence documents
  with no prior-art declaration.
- Still **not** approved: any CRITICAL severity or a baseline (Stage 4), the
  duplicate-subject and source-of-truth checks (D4, D5), and everything in D5.

## Amendment 3 — delegated decisions: CRITICAL for named legacy homes, home mapping (2026-11-14)

**Source:** delegated product-owner decisions (Astra, gpt-6-astra) under owner
instruction 2026-11-08, decided 2026-11-14 on a read-only review of
`main@7b391cad`, relayed by the lead Claude session. These are **not** human
approval and not production acceptance; each approval is limited to the actions
and conditions below. Nothing in this amendment edits, moves, renames or deletes
an existing document.

| Decision | Verdict | Effect here |
|---|---|---|
| D-A1 | approved | `doc-placement` is **CRITICAL** for a file **added or renamed into** the legacy homes below, and only there |
| D-A2 | deferred | metadata, prior-art and the remaining placement findings stay WARNING; re-evaluate on **2026-11-28** (criteria below) |
| D-B4, D-B5, D-B6, D-B8 | approved | `.agent/`, `agent/`, `.rwang-tasks/`, `.brain/plans/` are legacy homes (no new documents); every existing file and path stays |
| D-B1, D-B2 | approved | archive `todo.md` and `hardware-performance-audit.md` with a stub, as a separate change |
| D-B3, D-B7 | deferred | `MASTER-PROMPT.md` and the two `docs/superpowers/` FR-293 files stay; new specs and plans go in `docs/plans/` |
| D-B9 to D-B12 | rejected | both `.rwang-progress.md`, the retired S-01 document, `zuri_workspace_system.md` and `schema.local.prisma` are not moved, merged or replaced |
| D-D1 | approved | `docs/governance/` is a K14 write home and `docs/migrations/` procedures are K11, with the more specific frozen rules winning; new reports and reviews go in `reports/` (existing `.brain/reports/` and `.brain/reviews/` files stay; those folders are legacy, WARNING only); documents beside code under `apps/`, `services/` and `skills/` stay `tolerated` for local module explanations only |
| D-D2, D-D3, D-D4 | approved, separate changes | `reports/**/*.md` as documentation in CI classification; fold the Compact narrative of `docs/README.md` into the report index; audit the `source_of_truth` declarations (no duplicate-subject or source-of-truth check is enabled) |

**Supersession.** Where amendments 1 and 2 and decision D5 say that no CRITICAL severity is
enabled, that archiving or moving any file is unapproved, or that nothing is moved, those
statements are superseded by this amendment **only** for (a) CRITICAL on the legacy homes named
below and (b) the separate archiving of the two root files in D-B1/D-B2 (a different change,
with its own checks). Everything else in D5 still applies. Nothing in the amendment-3
change itself moves or edits an existing file.

**CRITICAL homes (per-finding severity, no shared flag).** Added or renamed-into
files under: K9 `docs/superpowers/**`, `.brain/plans/**`, `docs/roadmap/PLAN-*.md`;
K12 `.agent/**`, `agent/**`, `.rwang-tasks/**`. A rename within the same policy
rule (the same home) is not a new document; a rename between different homes
(for example `.agent/` to `agent/`, or `docs/plans/` into `docs/superpowers/specs/`)
is examined. Exempt, unchanged: canonical K2 records, generated views, Edge,
frozen evidence under `.brain/rca/evidence/`, sealed `*.approval.md` copies, and
every other frozen or legacy home (still WARNING).

**Not evaluated is not a pass.** If the diff cannot be evaluated (no merge base,
a failed git call, an unexpected error) the guard reports "NOT EVALUATED" as a
WARNING under CI and INFO locally; it never reports the check as passed.

**Re-evaluation on 2026-11-28 (D-A2).** The integrator and a reviewer reconsider
promoting any further rule when all 120 recently warned documents are classified,
at least two weeks of real use with at least 30 added or renamed documents exist,
and no unresolved false positive remains for the rule being promoted; no further
owner decision is needed once those criteria are met. The 120/1,109 figure is a
warned rate, not a false-positive rate.

**Still not approved:** CRITICAL for anything else, a baseline, the duplicate-subject
and source-of-truth checks, any other relocation (including `docs/roadmap/PLAN-*`,
change requests, PM folders and ADRs), mass moves, and irreversible deletion.

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
- 1.3.0 (2026-11-14): amendment 3, delegated product-owner decisions (Astra, gpt-6-astra, under owner instruction 2026-11-08, relayed by the lead session): CRITICAL for named legacy homes, legacy declarations, home mapping.
- 1.2.0 (2026-11-14): amendment 2, rules tuned to the shapes that exist (owner instruction in chat, relayed by the lead session); rules and kinds file only.
- 1.1.0 (2026-11-14): amendment 1, report-only added-document guards (owner instruction in chat, relayed by the lead session); D5 bullet on new checks narrowed accordingly.

## Authority

Source: the owner's chat instruction of 2026-11-14, relayed by the lead Claude
session, on the candidate proposal merged earlier. This ADR does not
substitute for any approval that file moves, CI classification changes or
production work require.
