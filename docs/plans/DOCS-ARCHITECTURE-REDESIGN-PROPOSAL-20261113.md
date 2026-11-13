---
id: ZAI:DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113
title: Documentation architecture redesign proposal — one home and one source of truth per kind of knowledge
doc_type: design-proposal
status: candidate
version: "0.1.0"
created_at: "2026-11-13"
last_update: "2026-11-13"
author: Claude Opus 5.5 (independent architect and reviewer, design step only)
source_revision: "d694d0c7ebfc9e015dfb11f424b45deb8c6c4abf"
source_of_truth: false
implementation_authorized: false
superseded_by: null
relations:
  - type: references
    target: ZAI:ADR-025
  - type: references
    target: ZAI:ADR-039
  - type: references
    target: ZAI:ADR-081
  - type: references
    target: ZAI:ADR-113
---

# Documentation architecture redesign proposal

**Status: candidate proposal.** This is a design and review document requested by the
owner on 2026-11-13. It is not an approval record, not an ADR, and not a plan that
any session may execute. It moves, renames, deletes and rewrites nothing. Every
stage below needs the owner's explicit approval, and the owner decisions in §9 are
listed, not decided. Where this document says "recommend" it states the
architect's view for the owner to accept or reject.

Reading order: §1 states the finding, §2 the inventory with its commands, §3 what
the repository already enforces (so nothing here duplicates it), §4–§7 the design,
§8 the staged migration, §9 the open owner decisions, §10 what not to do.

## 1. Finding in one page

The owner's symptom is real: agents cannot tell that a document exists, so they
write a duplicate or overwrite one. The inventory (§2) shows the cause is **not**
that `docs/` is badly shaped. The ADR-025 spine, the canonical record model, the
document graph, the id ledger and the root/directory registers already give the
`docs/` tree a defensible structure, and `docs/` proper has almost no orphan files.
The cause is five narrower gaps:

1. **Several kinds of knowledge have more than one place an agent may legitimately
   write.** Plans: `docs/plans/`, `docs/roadmap/PLAN-*`, `docs/superpowers/specs/`,
   `.brain/plans/`. Evidence and reports: `reports/`, `.brain/reports/`,
   `.brain/rca/`, `.agent/reports/`, `.brain/waves/`, `.brain/audits/`,
   `docs/changes/artifacts/`. Procedures: `docs/runbooks/`, `docs/deployment/`,
   `apps/edge/docs/`. An agent picking one is correct three times in four and still
   creates a second copy.
2. **There is no "does this already exist?" step an agent can run.** The only
   mechanical help is the generated per-category READMEs and the document graph,
   both ignored build output (ADR-081) that does not exist in a fresh checkout, and
   both scoped to `docs/` only. `AGENTS.md` §21 tells agents to enumerate, which
   is correct and manual.
3. **Nothing checks placement or metadata below `docs/` root.** Preflight fails an
   unregistered direct child of `docs/`; it does not fail a new Markdown file in a
   wrong subfolder, outside `docs/`, with no frontmatter, or whose subject duplicates
   another document.
4. **The status vocabulary is open.** Hand-authored documents use about twenty
   different `status` values; only 17 of 1,918 tracked Markdown files declare
   `source_of_truth`. A reader cannot tell a current source from a projection.
5. **Documents live outside `docs/` and outside every check.** Root files,
   `reports/`, `.brain/`, `.agent/`, `agent/`, `reference/`, `apps/edge/docs/`.

The recommendation is therefore **add discoverability and a placement guard first,
move files last, and move very little.** Concretely: a classification of knowledge
kinds with exactly one write home each (§4); a short "where does X go" table in the
two existing entry points plus a `docs:find` command that queries a generated
catalog (§6); three new preflight checks that apply to *added* files, with no
baseline to maintain (§7); and a migration of at most a handful of low-risk files,
each with its breakage list (§8). Mass relocation of requirements, decisions,
change requests, domains or roadmap plans is recommended **against** (§10).

## 2. Inventory (read-only)

All commands were run from the repository root at `d694d0c7`. Counts are **tracked**
files (`git ls-files`) unless stated. `.brain/session-memory/*` notes are untracked by
policy, so on-disk counts for `.brain/` differ and are given separately.

### 2.1 Totals

| Measure | Command | Result |
|---|---|---|
| Tracked files | `git ls-files \| wc -l` | 6,252 |
| Tracked Markdown | `git ls-files '*.md' \| wc -l` | 1,918 |
| Tracked files under `docs/` | `git ls-files docs \| wc -l` | 1,638 (1,377 `.md`, 126 `.jpg`, 80 `.json`, 17 `.template`) |
| Direct files / directories under `docs/` | `git ls-files docs \| awk -F/ 'NF==2'` / `awk -F/ 'NF>2{print $2}' \| sort -u` | 43 / 21 |
| Direct `docs/` directories with their own `README.md` | `git ls-files --error-unmatch docs/<d>/README.md` per directory | 11 of 21 |
| README-named tracked files, whole repository | `git ls-files \| grep -ci readme` | 55 (the owner's figure of 120 was not reproduced; it likely counts untracked or dependency copies, which this inventory excludes) |
| `.brain/` Markdown on disk in the primary checkout / tracked | `find <primary>/.brain -name '*.md' \| wc -l` / `git ls-files .brain \| grep -c '\.md$'` | 747 / 344 (the 403 difference is untracked `session-memory` notes) |
| ADR files / unique ADR numbers | `git ls-files docs/decisions \| wc -l`, `grep -o 'ADR-[0-9]*' \| sort -u \| wc -l` | 116 / 116 (no collision) |
| Canonical registry records | `registry/document-registry/index.json` | 559 (FR 294, SDD 113, BR 44, SEC 37, FEAT 46, NFR 25) |

### 2.2 Markdown by location, with metadata coverage

Method: a Node script (Appendix A) reads each tracked `.md`, parses the leading
`---` block with a line regex, and counts keys. "Frozen/canonical" rows are the
generated-per-record and historical families. `doc_type` and `status` counted at
top level or nested under `attributes:`.

| Location | `.md` | with frontmatter | `doc_type` | `status` | `source_of_truth` | Nature |
|---|---:|---:|---:|---:|---:|---|
| `docs/requirements/` | 353 | 353 | 0 | 353 | 0 | canonical records (generated locator: registry index) |
| `docs/features/` | 298 | 298 | 92 | 298 | 0 | canonical FEAT/FR records |
| `.brain/rca/` | 286 | 209 | 0 | 209 | 0 | RCAs (20 of the `.md` files are frozen evidence under `evidence/`) |
| `docs/domains/` | 241 | 237 | 8 | 188 | 1 | charters, SRS views, domain notes, 84 PM files |
| `docs/decisions/` | 116 | 85 | 0 | 85 | 0 | ADRs (31 have no frontmatter; preflight reads their in-body `**Status:**`) |
| `apps/edge/docs/` | 66 | 53 | 0 | 53 | 0 | Edge's own tree with its own graph and preflight |
| `docs/change-requests/` | 66 | 59 | 36 | 59 | 0 | CR intake (168 further non-Markdown files, mostly under `marketing/`) |
| `docs/architecture/` | 53 | 48 | 3 | 48 | 4 | PM system spec (59 files of all types), blueprint, delivery-control |
| `docs/archive/` | 53 | 8 | 0 | 8 | 0 | cold store |
| `docs/roadmap/` | 50 | 47 | 1 | 47 | 7 | ROADMAP.md plus 32 `PLAN-*` and the 24-week projection |
| `docs/migrations/` | 40 | 38 | 17 | 38 | 0 | reintegration, service extraction, scoped verification |
| `reports/` | 37 | 32 | 32 | 32 | 0 | dated engineering assessments |
| `.brain/reports/` | 30 | 18 | 0 | 18 | 0 | older reports |
| `docs/` top level | 29 | 15 | 0 | 15 | 0 | 43 files in all (29 `.md`) |
| `docs/plans/` | 21 | 21 | 10 | 21 | 0 | plans and retained contracts |
| `docs/changes/` | 20 | 19 | 0 | 19 | 0 | issued ZV2-CR records and artifacts |
| `reference/` | 16 | 6 | 0 | 6 | 4 | GoVibe prior art, legacy prototype |
| `.agent/` and `agent/` | 15 + 9 | 5 + 0 | 0 | 5 + 0 | 0 | 2026-08 phase briefs and reports (eight identical phase titles in both) |
| `.brain/waves`, `reviews`, `sessions`, `plans`, `prompts`, `proposals`, `audits` | 14 + 8 + 2 + 1 + 1 + 1 + 0 | 0, 1, 2, 1, 0, 1 | 0 | partial | 0 | assorted |
| `docs/runbooks/`, `services/`, `appendices/`, `deployment/`, `governance/`, `templates/`, `superpowers/`, `prompts/`, `product/`, `operations/` | 9, 9, 4, 3, 5, 1, 2, 2, 1, 1 | mostly | few | mostly | 0 | small families |
| Repository root `.md` | 6 | 2 | 0 | 2 | 0 | `AGENTS.md`, `CLAUDE.md`, `README.md`, `MASTER-PROMPT.md`, `todo.md`, `hardware-performance-audit.md` |
| `skills/`, `services/*`, `apps/server`, `.agents/`, `.claude/`, `registry/` | 9, 5, 8, 4, 2, 2 | partial | 0 | partial | 0 | tool and service READMEs |
| **Total** | **1,918** | **1,613 (84%)** | **591 (31%)** | **1,557 (81%)** | **17** | |

Excluding canonical records, `docs/archive/` and frozen evidence, the hand-authored
population is **1,183** Markdown files: **927 (78%)** have frontmatter, **475 (40%)**
declare a `doc_type`, **871 (74%)** a `status`.

### 2.3 Status vocabulary

Command: for each non-record `docs/*.md`, read the first `status:` line. Observed
values and counts in the frontmatter of hand-authored `docs/` files: `candidate` 133,
`beta` 131, `approved` 82, `accepted` 56, `active` 52, `building` 17, `proposed` 15,
`implemented` 15, `draft` 6, `partial` 4, `implementation` 4, `generated` 4,
`declared` 4, `current` 3, `task-authorized` 2, `superseded` 2,
`foundation-implemented` 2, `complete` 2, `retired` 1, `registered` 1. ADR statuses
are a separate mix: `accepted` 111, `approved` 26, `beta` 22, `accepted.` 15,
`candidate` 12, `proposed` 7, `superseded` 3, plus free-text variants. One status
field is being asked to carry three different facts (approval, delivery, and
document-currency), which `GOVERNANCE-PROFILE.md` explicitly says must stay
separate. This proposal does not rewrite any of them (§7.3).

### 2.4 Generated, hand-written, frozen

| Class | Where | Evidence |
|---|---|---|
| Generated, ignored (ADR-081) | `docs/.doc-graph.json`, `FEATURE-MAP.md`, `DOMAIN-MAP.md`, `TRACE.md`, `DOCUMENT-LINKS.md`, `docs/.preflight-report.json`, `llms-full.txt`, `docs/architecture/SERVICE-MAP.md` | `git check-ignore -v` |
| Generated, **tracked** | `docs/PRD-SDD-v1.0.md`, `docs/FEATURES.md` (compatibility exports), `docs/{product,architecture,operations,governance}/README.md` (`doc_type: generated-view`; `docs/prompts/README.md` is hand-written), `registry/document-registry/index.json` | file headers; `npm run docs:registry`, `docs:views` |
| Hand-written, tracked, machine-read | `docs/.id-ledger.json` and nine `docs/.*-baseline.json` ratchets | `ROOT-FILE-REGISTER.md` |
| Frozen history | `docs/archive/` (53), `.brain/rca/evidence/` (110), `docs/migrations/document-reintegration/record-migrations/` approval copies, `registry/document-reintegration/*.json`, `docs/migrations/monorepo/source-manifest.json` | pinned blob hashes and paths |
| Local only | `.brain/session-memory/CLAUDE-*`, `CODEX-*` | `.git/info/exclude`, `AGENTS.md` §0 |

### 2.5 Duplicates and near-duplicates

Method (Appendix A): group by normalised H1 title, and separately by basename, across
all tracked Markdown. 32 title groups and 34 basename groups result. After removing
per-record template output, they fall into six classes:

1. **Same subject, intentionally different kind** (not a defect, but invisible by path):
   `office-design-receiver-20261031.md` exists in `docs/change-requests/project-manager/`
   (owner mandate), `docs/plans/` (implementation plan) and `reports/` (evidence);
   `LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md` in `change-requests/integration/` and `plans/`.
2. **Approval snapshots kept byte-identical on purpose**: four pairs under
   `docs/change-requests/` and `docs/migrations/document-reintegration/record-migrations/`
   (`DOCS-DIRECTORY-REGISTER.md` already records them; do not deduplicate by hash).
3. **Repository roles that share names**: `AGENTS.md` ×4 (root, `.claude/`, two in
   `apps/edge/`), `CLAUDE.md` ×2, `ARCHITECTURE.md` ×3 (`docs/`, `docs/architecture/blueprint/`,
   `apps/edge/docs/`), appendices A/B/E/F duplicated between `docs/appendices/` and
   `apps/edge/docs/appendices/`, `SYSTEM-DIAGRAM.md` in `docs/` and `docs/domains/identity/`.
4. **Phase briefs vs reports with identical titles**: eight pairs
   `agent/phases/PHASE-nn.md` and `.agent/reports/PHASE-nn.md`; from the path alone an
   agent cannot tell which is the brief and which the report.
5. **Pinned evidence copies**: the PM spec handoff under
   `.brain/rca/evidence/2026-10-05-pm-spec-handoff/source/` repeats
   `docs/architecture/project-manager-system/`, `docs/PRD-SDD-v1.0.md` and `docs/FEATURES.md`.
   Frozen by design.
6. **True drift candidates**: `docs/.rwang-progress.md` vs `docs/archive/.rwang-progress.md`
   (not byte-identical; `ROOT-FILE-REGISTER.md` already notes it);
   `docs/STD-Multi agent workflow S-01.md` (retired) plus `docs/runbooks/S-01.md`
   pointer; `docs/schema.local.prisma` vs `apps/server/prisma/schema.prisma`.

The inventory therefore does **not** show widespread accidental duplication inside the
canonical record families. It shows a large number of *legitimately related* files whose
relationship is undiscoverable, which is exactly what a catalog and a `subject` key
address (§6, §7).

### 2.6 Orphans, stale indexes, ownerless files

Orphan method (Appendix A): a tracked document is "unreferenced" if its basename occurs
in no other tracked hand-written Markdown, canonical record or `llms.txt` (generated
views, the reintegration migration docs and frozen evidence excluded as sources). Basename
matching over-approximates references, so these are **lower bounds on orphans**.

| Location | Files | Unreferenced |
|---|---:|---:|
| `docs/` top level, `plans`, `roadmap`, `runbooks`, `appendices`, `services`, `governance`, `deployment`, `product`, `operations`, `prompts`, `superpowers`, `templates` | 137 | **0** |
| `docs/decisions/`, `docs/architecture/` | 169 | 2 (one ADR; `docs/architecture/delivery-control/LOCAL-CONTROLLER.md`) |
| `docs/domains/`, `docs/change-requests/` | 307 | 12 |
| `docs/changes/` | 20 | 9 (issued ZV2-CR records and artifacts are reachable only through the generated governance README) |
| `docs/archive/` | 53 | 27 |
| `.brain/rca/` | 286 | 177 (dated RCAs that no other document names by file name) |
| `reference/`, `agent/`, `.brain/waves`, `.brain/reviews`, `.brain/sessions`, `.brain/reports`, `.brain/plans` | 81 | 43 |
| `reports/` | 37 | 0 |

So the `docs/` tree proper is well linked; the findability problem is not orphaned
files, it is that no index answers "what exists about subject X".

Stale or inconsistent indexes found:

- `llms.txt` links `docs/DOCUMENT-LINKS.md`, `docs/FEATURE-MAP.md`, `docs/DOMAIN-MAP.md`,
  `docs/TRACE.md`, `docs/appendices/D-traceability.md` and `llms-full.txt`, all ignored
  build output that does not exist in a fresh clone. The text says "generated" but a
  reader following the link in a clone gets a 404.
- `DOCS-DIRECTORY-REGISTER.md` (v0.3.6) states counts and README coverage "at the
  reviewed base" (20 directories, 11 with README after its own edit); `ROOT-FILE-REGISTER.md`
  (v0.3.2) quotes `docs/README.md` as `version: 0.4.0` while the file is `0.7.20`. The
  preflight check compares **names**, not these counts or versions, so the prose drifts
  silently. They are registers, not catalogs, and say so.
- `docs/README.md` (13 KB) interleaves the entry-point list with dated narrative about
  individual Compact self-host test snapshots; an agent must read ~200 lines to learn the
  few that route work.
- `docs/plans/README.md` (v0.3.12) records its checked revision as `189fb41a` and its file
  counts are dated (the last refresh in the text is 2026-10-29), while 21 files are present now.
- `docs/roadmap/README.md` lists the files present on 2026-10-22; 55 files of all types
  exist now (another session is editing this folder; not touched here).

Statusless: 1,183 hand-authored files minus 871 with `status` = **312 with no status**.
Per-file ownership is not recorded as a field at all; it is carried by the domain
charter and ADR-025, so "who owns this document" is unanswerable from the file.

### 2.7 Every place an agent could plausibly write a document today

Observed in-repo write targets and who points agents there:

| Path | Why an agent writes there |
|---|---|
| `docs/plans/` | `docs/plans/README.md` says new bounded plans go here |
| `docs/roadmap/PLAN-*` | 32 historical plans; `docs/roadmap/README.md` says "do not create new roadmap plans here" but the folder is the intuitive place |
| `docs/superpowers/specs/` | default output path of the installed `superpowers:brainstorming` and `writing-plans` skills; created 2026-11-02 for FR-293 and registered by the directory register |
| `docs/change-requests/<area>/` | CR intake (`README.md` rules) |
| `docs/changes/` | issued ZV2-CR records only |
| `docs/architecture/` | 2026-10-22 Visual Office design and others; the generated `README.md` there lists only what the graph sees |
| `docs/domains/<d>/features/` | optional rationale notes (AGENTS §19) |
| `docs/domains/<d>/` (loose) | e.g. `identity/SYSTEM-DIAGRAM.md`, UI specs |
| `docs/runbooks/`, `docs/deployment/` | operations |
| `docs/` root | forbidden by the DOCUMENTATION-REQUIREMENTS-SPEC and CRITICAL if unregistered |
| `reports/` (repository root) | assessments; outside `docs/`, so outside doc preflight |
| `.brain/rca/`, `.brain/reports/`, `.brain/waves/`, `.brain/audits/`, `.brain/plans/`, `.brain/reviews/`, `.brain/proposals/`, `.brain/prompts/` | agent working memory and RCAs (AGENTS §0, RCA convention) |
| `.agent/`, `agent/`, `.rwang-tasks/` | August 2026 phase machinery; not retired by name |
| repository root | `todo.md`, `MASTER-PROMPT.md`, `hardware-performance-audit.md` exist, so root looks like an acceptable home |
| `apps/edge/docs/`, `apps/*/README.md`, `services/*/README.md` | Edge and service-local docs |
| `.worktrees/`, `.claude/worktrees/` | session copies, ignored; a doc written in one is lost with the worktree |

Fifteen distinct directories for essentially five knowledge kinds. The six loose
root and `docs/` root files named in the task are classified in Appendix B.

## 3. What the repository already enforces (do not duplicate)

This is the baseline the proposal must not fight. Each row names the mechanism and what it
guarantees.

| Mechanism | Guarantee | Gap relevant here |
|---|---|---|
| ADR-025 domain spine; `docs/domains/<d>/CHARTER.md` | one charter per domain; preflight CRITICAL when two charters claim a model or a feature note's `domain:` disagrees with its folder | covers ownership of **models and features**, not documents generally |
| Canonical ZAI records (`docs/features/FEAT-nnn/`, `docs/requirements/`) + `registry/document-registry/index.json` | requirement text, identity and FEAT membership have one source; `PRD-SDD-v1.0.md` and `FEATURES.md` are generated; `docs:registry:check`, `docs:identity:check`, `docs:inventory:check`, `docs:views:check` run in `govern` | index covers 559 records only; says nothing about ADRs, plans, reports, runbooks |
| Id ledger (ADR-039, preflight Check 12) | a pinned id's subject cannot move; burnt numbers are not re-declared | ids only |
| Doc graph (`docs:graph`) | nodes and typed edges from `docs/**/*.md` **excluding `docs/archive/`**, `@req/@spec/@tested` annotations, document-link metadata | scope is `docs/` only: not `reports/`, `.brain/`, root, `apps/edge/docs`; ignored output, absent in a fresh clone |
| Document-link metadata (`GOVERNANCE-LINK-METADATA.md`) | `id`, `relations`, wikilinks resolve or fail graph generation and strict preflight (`doc-link-metadata`, CRITICAL) | optional per document; "existing documents without link metadata remain valid" |
| Preflight `docs-inventory` | CRITICAL when a direct child file or directory of `docs/` is absent from `ROOT-FILE-REGISTER.md` / `DOCS-DIRECTORY-REGISTER.md`, or registered but missing | direct children of `docs/` only (names, not counts) |
| Preflight Check 1 `doc-control` | `Version`/`Status` present; info for inherited spec pack, warning for appendices/features/PRD | warning/info only; docs only |
| Preflight Check 2 `cross-reference` | broken relative links in `docs/**` | warning; docs only |
| Preflight Check 15 `untracked-docs` | warns on untracked files under `docs/`; blind in CI by design | not a CI guard |
| Preflight `domain-srs-profile`, `canonical-record-registry`, `capability-classification` | opt-in SRS profile; registry validity | specific profiles |
| ADR-081 | generated views are built, not committed; CI checks freshness | a catalog must follow this rule |
| `scripts/ci-code-changes.mjs`, `ci-change-scope.mjs` | PR is "documentation only" when every path is under `docs/`, `.brain/`, or is `AGENTS.md`/`CLAUDE.md`/`README.md` | `reports/`, `llms.txt`, `registry/`, `.agents/`, root loose files **count as code** and trigger the full Server path |
| `DOCUMENTATION-REQUIREMENTS-SPEC.md` (proposed v0.1.2) | profiles, single-source boundaries, "do not add new standalone documents at `docs/` root" | status `proposed`; profiles are not machine-checked except domain SRS |
| `AGENTS.md` §19, §21 | domain-first layout; enumerate before claiming existence | manual |

**Consequence for design:** the proposal extends the doc graph's *vocabulary* (a kind
assignment) and preflight's *scope* (added files, outside-`docs/` homes), adds one
discovery command, and adds no second registry for requirements, ADRs or ids.

## 4. Knowledge kinds: one home and one source-of-truth owner each

A *kind* answers "what sort of fact does this document hold?". Each kind has one
**write home** (where new documents of that kind go), one **SOT owner** (the artifact
that wins on conflict), and zero or more **legacy homes** (read-only for new content;
not moved). The matrix is the proposed policy; it re-labels existing paths and removes
no path.

| # | Kind | Write home (new docs) | SOT owner (wins on conflict) | Legacy / secondary homes (no new docs) | Generated or derived views |
|---|---|---|---|---|---|
| K1 | Product identity and scope | `docs/PRODUCT.md` (edit only) | owner + accepted ADRs | `ARCHITECTURE-NOTES.md` history | `llms.txt` summary |
| K2 | Requirements and features | `docs/features/FEAT-nnn/`, `docs/requirements/` via the reviewed record workflow | canonical per-ID records; ids pinned (ADR-039) | PRD/FEATURES exports; `docs/domains/<d>/features/` rationale | `registry/document-registry/index.json`, FEATURE-MAP, TRACE, per-feature views |
| K3 | Decisions | `docs/decisions/ADR-nnn-*` (issued-number key) | the ADR with its recorded lifecycle | `docs/changes/` issued ZV2-CR; `docs/change-requests/` intake | architecture-navigation README |
| K4 | Change intake and issued changes | `docs/change-requests/<area>/` (intake), `docs/changes/` (issued ZV2-CR only) | the CR's recorded state; intake is never an identity | `docs/changes/artifacts/` | governance-navigation README |
| K5 | Domain ownership and domain reading views | `docs/domains/<d>/CHARTER.md`, optional `SRS.md` | the charter (and the SRS only as a view) | domain loose notes | DOMAIN-MAP |
| K6 | Architecture and design | `docs/architecture/` (candidate designs, blueprint, VERIFICATION-POLICY) | accepted ADRs, then `ARCHITECTURE.md`; code for implementation | root `ARCHITECTURE-*.md`, `SYSTEM-DIAGRAM.md`, atlases (derived) | architecture README |
| K7 | Service execution and verification | `docs/services/<svc>/SERVICE.md`, `TESTING.md` | package scripts, wire schemas; service docs explain | `services/*/README.md`, `apps/*/README.md` (pointers only) | SERVICE-MAP (ignored) |
| K8 | Contracts, API, data shape | source-owned schema (`apps/server/contracts/`, `prisma/`, route code) | the schema file | `docs/appendices/` (prose view) | appendix D (generated) |
| K9 | Plans | `docs/plans/` | scope: the plan; **delivery state: ROADMAP.md only** | `docs/roadmap/PLAN-*`, `docs/superpowers/specs/`, `.brain/plans/` (all frozen for new docs) | 24-week projection |
| K10 | Delivery state | `docs/roadmap/ROADMAP.md` (edit only) | the ledger in ROADMAP.md | 24-week `.md`/`.html` (derived, `source_of_truth: false`) | roadmap views |
| K11 | Operations: runbooks, deployment | `docs/runbooks/` (procedures), `docs/deployment/` (environment contracts) | the runbook for the procedure; ADRs for the boundary | `apps/edge/docs/EDGE-*` (Edge's namespace) | operations README |
| K12 | Evidence: dated assessments and test receipts | `reports/` | the report for its dated scope only; never for current state | `.brain/reports/`, `.agent/reports/`, `.brain/waves/`, `.brain/audits/` | reports index |
| K13 | Incident analysis (RCA) | `.brain/rca/` | the RCA for its incident | `.brain/rca/evidence/` frozen | none |
| K14 | Agent and team instructions | `AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/` | `AGENTS.md` (CLAUDE.md is the short guide) | `apps/edge/AGENTS.md` (Edge namespace) | none |
| K15 | Templates and generator scaffolds | `docs/templates/`, `registry/document-registry/*.template.md` | the template | none | none |
| K16 | Archive and frozen history | `docs/archive/`, pinned manifests | frozen by pinned path and hash | `reference/` (external prior art, read-only) | none |
| K17 | Local session memory | `.brain/session-memory/` (untracked) | none; a lead, not an authority (AGENTS §0) | none | none |
| K18 | Generated views | never written by hand | the generator and its sources | — | — |

Notes on the matrix:

- **K9 vs K10.** Plans describe bounded scope; only `ROADMAP.md` states what is done.
  This is already the roadmap README's rule; the matrix makes it a row.
- **K12 vs K13.** `reports/` is the dated-assessment home, which is where recent
  practice puts it (`reports/`: 32 of 37 files carry frontmatter and `doc_type`).
  `.brain/rca/` keeps RCAs because `AGENTS.md`, `CLAUDE.md`, 74 code or config files and
  dozens of documents cite those paths.
- **Edge.** `apps/edge/docs/` is a separate namespace (ADR-062, `edge::` ids) with its
  own graph and preflight. This proposal does not reach into it; its duplicated
  appendix names are explained by the namespace, not merged.
- **`docs/domains/<d>/features/`** stays optional rationale. It is never the SOT for a
  requirement (AGENTS §19).
- **K17** is listed so agents stop treating it as a document home: local, untracked,
  never promoted without copying into a tracked K-home.
- **Root files.** None of K1–K17 has the repository root as a home. The three
  non-instruction root files are handled in Appendix B.

## 5. Placement, naming, metadata and the "search before you write" protocol

### 5.1 Placement rule

> A new tracked document is created only in the write home of its kind (§4). If no kind
> fits, that is a decision to raise, not a reason to pick a nearby folder.

A deterministic decision procedure an agent can follow:

1. **Is it a requirement, feature or id'd record?** Stop: use the reviewed record
   workflow (CANONICAL-FORMAT). Never create `FR-*`/`FEAT-*` files directly.
2. **Is it a decision with alternatives?** ADR, next free number. (Other sessions create
   ADRs concurrently; allocate the number at commit time and let the duplicate-id guard
   catch a collision.)
3. **Does it ask for a change to behavior or authority?** Change-request intake.
4. **Does it describe bounded work to do?** `docs/plans/` with `doc_type: implementation-plan`.
5. **Does it record what was observed or tested on a date?** `reports/`.
6. **Does it explain a failure and its cause?** `.brain/rca/`.
7. **Is it a procedure a human or agent runs?** `docs/runbooks/`.
8. **Does it explain how a service executes or is verified?** `docs/services/<svc>/`.
9. **Does it explain architecture or a design that no ADR yet accepts?**
   `docs/architecture/` with `status: candidate`.
10. **None fit:** add a row to this matrix through an ADR or a profile amendment; do not
    add a folder.

### 5.2 Naming

Do not invent a new scheme; make the dominant per-home conventions explicit:

| Home | Convention (already dominant) |
|---|---|
| `docs/decisions/` | `ADR-nnn-UPPER-KEBAB-TITLE.md` |
| `docs/plans/` | `UPPER-KEBAB-TITLE-YYYYMMDD.md` |
| `docs/change-requests/<area>/` | `lower-kebab-title-YYYYMMDD.md` |
| `reports/` | `lower-kebab-title-YYYYMMDD.md` or `<topic>-YYYY-MM-DD/README.md` |
| `.brain/rca/` | `YYYY-MM-DD-lower-kebab-title.md` |
| `docs/runbooks/` | `UPPER-KEBAB-TITLE.md` (no date; revision history in the file) |
| dated or one-shot documents | a date in the filename; undated only for living documents |

Rules: no spaces, no underscores in new files (existing exceptions:
`STD-Multi agent workflow S-01.md`, `zuri_workspace_system.md`, which also illustrate
why: the first needs `%20` encoding in every link and a special case in the register
parser). Do not rename existing files to meet this.

### 5.3 Required frontmatter (new and substantially changed documents)

Reuse the schema that already exists (`contracts/doc-link-metadata.schema.json` and the
COMPACT plan as the live example) rather than a new one:

| Field | Required | Rule |
|---|---|---|
| `id` | yes | `ZAI:<UPPER-KEBAB>` unique; never reused (checked by the link-metadata parser today) |
| `title` | yes | human title |
| `doc_type` | yes | from a closed list (§7.3), one per kind |
| `status` | yes | from a closed list per `doc_type` (§7.3) |
| `version`, `last_update` | yes | |
| `source_of_truth` | yes | `true` only for a kind's SOT owner; every plan, report, proposal and view says `false` |
| `domain` | when a domain applies | must match a chartered domain, same rule as feature notes |
| `subject` | recommended | the one-line subject key used for duplicate detection (§7.2) |
| `relations` | yes when a prior document exists | `supersedes`, `superseded_by`, `references`, `relates_to`; existing relation vocabulary |
| `prior_art` | yes for a new document | either the paths found by `docs:find` that were read, or the literal `none-found` plus the query string used |

`prior_art` is the only new field. It makes the protocol auditable without claiming the
check can prove a search happened (§7.2 states the limit).

### 5.4 "Search before you write" protocol (what an agent does)

1. **Derive search keys**: the subject in plain words, any `FR-/FEAT-/ADR-` ids involved,
   and the domain.
2. **Run `npm run docs:find -- "<subject>" [--id FR-294] [--kind plan] [--domain agent]`**
   (new, §6.3). It prints, per hit: kind, status, `source_of_truth`, owner/domain, path
   and why it matched. It does not require a prior `govern` run.
3. **Read the top hits and the SOT owner for the kind.** If a document of the same kind
   and subject exists: **extend it** (edit, with a version diff) or **supersede it**
   (new document with `supersedes` and the old one marked `superseded_by`). Never write
   a parallel copy.
4. **Absence claims need enumeration.** `docs:find` hits are evidence of presence only;
   a miss is not proof of absence (AGENTS §21). The agent still enumerates the intended
   home (`git ls-files <home>`) before asserting that nothing exists.
5. **Create in the write home** with the §5.3 frontmatter, including `prior_art`.
6. **Run `npm run govern`**, which reports placement, metadata and duplicate-subject
   findings for the added file (§7).
7. **Register where the rules require.** A new document in a family that has a hand
   index (e.g. `docs/plans/README.md`) is added to that index. Generated indexes update
   themselves.

Cost to the agent: one command and one frontmatter field.

## 6. Index design: one machine-readable catalog, two short entry points

### 6.1 Principle: a projection, not a second registry

Today there are already three locators with different jobs and different scopes:

| Locator | Scope | Committed? |
|---|---|---|
| `registry/document-registry/index.json` | 559 canonical requirement/feature records | yes (generated, tracked) |
| `docs/.doc-graph.json` | `docs/**/*.md` minus archive, plus code annotations | no (ignored) |
| ROOT-FILE / DIRECTORY registers | direct children of `docs/` | yes (hand-written, name-checked) |

The proposal adds **no fourth authority**. The new catalog is a *join* over them plus the
files they do not see, and it is ignored build output like the graph (ADR-081). It is
never edited and never the SOT for any statement.

### 6.2 `docs/.doc-catalog.json` (generated, ignored)

Built by a new `tools/document-catalog.mjs` (same location and style as the other
`tools/document-*.mjs`), by walking `git ls-files` (tracked only, so it matches what a
reviewer sees and avoids ignored worktrees) and joining:

- **kind** and **write-home/legacy** status from a small hand-edited policy file
  `docs/governance/DOCUMENT-KINDS.json` (path-prefix → kind rules plus the closed
  `doc_type`/`status` lists). This policy file is the **only** new hand-edited artifact
  and is the machine form of §4.
- frontmatter fields (§5.3) from the file;
- `registry id` when the path is in `registry/document-registry/index.json`;
- `graph node id` when `docs/.doc-graph.json` exists (optional enrichment);
- `generated`, `frozen` and `local` flags from the file header and the kind rules;
- inbound reference count (basename and relative-link match) for orphan reporting.

Record shape (per document): `path, kind, home (write|legacy|frozen|generated), doc_type,
status, source_of_truth, id, domain, subject, title, supersedes, superseded_by, registryId,
graphNodeId, inbound`. Sorted, deterministic, no timestamps (ADR-081 §determinism).

It is **ignored, not committed**, for the same reason the graph is: a committed catalog of
~1,900 rows would reproduce the conflict pattern ADR-081 measured for committed generated files. Agents get a copy via
`docs:find` building in memory (the Appendix A inventory walk takes about half a second) and CI can upload it as an artifact next to `llms-full`.

### 6.3 `npm run docs:find`

`node tools/document-find.mjs` — pure read, no writes, no dependency on a prior `govern`:

```text
npm run docs:find -- "managed blob recovery"
npm run docs:find -- --id FR-292            # exact id, resolves through the registry
npm run docs:find -- --kind plan --domain knowledge
npm run docs:find -- --path docs/plans      # what the home already holds
```

Output: ranked list with `kind · status · SOT? · domain · path · matched on`, then a
single line stating the write home for the queried kind. Matching is deterministic text
matching over `title`, `subject`, `id`, headings and `relations` (no model call). Existing
`tools/document-query.mjs`, `tests-for.mjs` and `impact.mjs` already follow this pattern;
`docs:find` is the same family, not a rival.

### 6.4 Entry points (hand-written, short)

- **`llms.txt`** (agents) gains one section, "Before you write a document", of about 25
  lines: the §4 matrix reduced to *kind → write home → SOT → command*, the §5.4 protocol
  in six lines, and `npm run docs:find`. Its links to ignored generated files are
  rewritten as "(generated by `npm run docs:graph`, absent in a fresh clone)" or replaced
  by `docs:find` (fixes the stale-link finding in §2.6). Note: `llms.txt` is outside the
  CI "documentation" pattern, so a PR touching it takes the code path; budget for that
  (§8, stage 2).
- **`docs/README.md`** (humans) gains the same table above the long dated narrative, which
  is left in place. A later, separate step may move the dated Compact bullets to
  `reports/README.md` where they already live as a table.
- **Per-home READMEs** exist for 11 of 21 `docs/` directories. Do not add the missing ten;
  the catalog answers "what is in this folder" without another file to drift (the
  directory register already reaches the same conclusion).
- **`AGENTS.md` §19** gets a three-line pointer to the matrix and `docs:find`; no rule
  there is rewritten.

### 6.5 How this relates to what exists

| Existing | Relationship |
|---|---|
| registry index | read by the catalog; still the only locator for canonical records |
| doc graph | optionally joined; scope and semantics unchanged; no new edge types |
| generated category READMEs | unchanged; `docs:find` supersedes them for *search*, not for their navigation role |
| root/directory registers | unchanged; they keep checking the direct children of `docs/` by name |
| `docs:impact`, `docs:tests-for`, `docs:readiness` | unchanged |

## 7. Extending preflight: new checks, cost and baselines

All checks follow the repository's existing pattern: pure rule module under
`apps/server/scripts/` (like `untracked-docs.mjs`, `id-stability.mjs`) so a test can reach
the decisions; severity and baseline behavior stated per check; a limitation sentence in
the finding text when the check cannot fire in some environment.

### 7.1 Two enforcement styles, with a recommendation

- **Baseline ratchet** (the repo's usual style: `docs/.route-anchor-baseline.json`, 46 grandfathered
  routes). Violations present today are recorded; the list may only shrink. Cost for this
  topic: placement and metadata violators number in the hundreds (§2.2, §2.6), and a
  committed sorted list of hundreds of paths is precisely the merge-conflict shape ADR-081
  removed.
- **Added-file rule.** Apply the check only to files **added or renamed into a path in the
  diff** against the merge base (`git diff --name-status --find-renames <base>...HEAD`).
  No baseline, nothing to conflict, existing files never fail. Blind locally unless a base
  is available, so CI is the authoritative run (the opposite blind spot to Check 15,
  which cannot fire in CI) and `govern` falls back to `origin/main` when present. Failure
  of the git call is CRITICAL, not clean (the lesson recorded in Check 15).

**Recommendation:** added-file rule for placement and metadata (D1, D2, D3); a small
baseline only for duplicate subjects (D4), where the existing population is 32 title
groups and 34 basename groups (§2.5), most legitimate and acknowledged by `relations`.

### 7.2 Proposed checks (names continue the existing numbering)

| # | Check id | Rule | Severity | Applies to | Baseline |
|---|---|---|---|---|---|
| D1 | `doc-placement` | a tracked Markdown file added or renamed into a path that no kind assigns a **write** home, or into a **legacy/frozen/generated** home | CRITICAL for added files; info otherwise | all tracked `.md` outside Edge | none (added-file rule) |
| D2 | `doc-metadata` | an added file in a write home lacks the §5.3 required fields or uses a `doc_type`/`status` outside the closed lists | CRITICAL for added files; warning for modified legacy files that already had frontmatter | write homes only | none |
| D3 | `doc-prior-art` | an added file lacks `prior_art`, or its `prior_art` names a path that does not exist | WARNING for one stage, then CRITICAL | added files in K3/K4/K5/K6/K9/K12 | none |
| D4 | `doc-duplicate-subject` | two catalog entries of the same **kind** share a normalised `subject` (else normalised title), and neither lists the other in `supersedes`/`superseded_by`/`relates_to`/`references` | WARNING | all write and legacy homes | shrink-only list of the existing pairs, keyed by path pair |
| D5 | `doc-sot-claim` | `source_of_truth: true` on a document whose kind has a different SOT owner, or `true` on more than one document claiming the same `subject` | CRITICAL | all | none |

What the checks deliberately cannot do, stated in the finding text:

- D3 verifies the **declaration and that the named paths exist**; it cannot prove that a
  search was run or that the agent read the hits. It makes the protocol visible in review.
- D4 is subject-string and title matching; it will miss paraphrased duplicates and will
  flag deliberate pairs unless `relations` is present.
- None of D1–D5 reads inside `apps/edge/`, whose own preflight keeps Edge's namespace.

Not proposed, because the existing mechanisms already cover it or the inventory shows no
need: a new "unregistered direct child of `docs/`" check (exists: `docs-inventory`); an
orphan CRITICAL for `docs/` (the tree has 0 orphan files in the families that route work,
§2.6); a broken-link upgrade from warning to critical (separate decision; Check 2 remains
a warning today for historical reasons); and any new check over frozen evidence.

### 7.3 Closed vocabularies (policy, applied to new and touched files only)

`doc_type` (one per kind, enough to dispatch): `product, requirement-record, decision,
change-request, domain-charter, domain-srs-view, architecture, service, contract,
implementation-plan, design-proposal, roadmap, runbook, assessment, rca, instruction,
template, generated-view, archive-record`. Existing values (`filesystem-inventory`,
`migration-profile`, `documentation-requirements-specification`, …) remain valid until the
file is next materially changed.

`status`: separate the three facts the migration profile says must stay separate, by
*naming*, not by rewriting existing files:

- document lifecycle: `draft, candidate, proposed, accepted, active, superseded, retired, generated`;
- approval stays in the existing `approved_by`/ADR text, never inferred from `status`;
- delivery stays in ROADMAP.md only (AGENTS and the roadmap README already say so).

`beta`, `building`, `implemented`, `partial`, `foundation-implemented`, `complete`,
`task-authorized` appear in current files and mean delivery or approval; they are tolerated
on existing files, rejected on added ones. Open owner decision O5.

Cost of D1–D5: one rule module and test file per check (about 100–150 lines each, the size
of `untracked-docs.mjs` and `id-stability.mjs`), one policy JSON (~60 lines), one
`tools/document-catalog.mjs` and `document-find.mjs` (together ~300 lines) with tests under
`tools/tests/` and `docs:migration:test`. Estimated sizes only; measure in Stage 1. Runtime: the Appendix A inventory script over 1,918 files ran in about 0.5 s on this
machine; the added-file rule adds one `git diff`.

## 8. Staged migration plan

Order follows AGENTS §18: steps that change *meaning or identity* before steps that only
move files, and moves last. Every stage is a separate pull request, reviewable alone,
and reversible by revert. Stages 1–4 move **no** document.

For every stage: required exact-head hosted CI (`changes`, `verify`, `edge-verify`), `npm run
govern`, and independent review. Stages that edit `llms.txt`, `registry/`, `reports/`,
`.agents/` or root files take the code path in `changes` (full Server suite on the PR)
because `scripts/ci-code-changes.mjs` classifies only `docs/`, `.brain/`, `AGENTS.md`,
`CLAUDE.md` and `README.md` as documentation; budget for that or batch such edits.

### Stage 0 — owner decisions and an ADR (no repository change)

Owner decides §9. An ADR then records the kind matrix and the write-home policy ("next
free ADR number at the time"; another session is currently adding an ADR, so the number
must be allocated at commit, not now). Until then this proposal governs nothing.

### Stage 1 — `docs:find` and the catalog (pure addition)

Add `tools/document-catalog.mjs`, `tools/document-find.mjs`, `docs/governance/DOCUMENT-KINDS.json`,
tests in `tools/tests/`, npm scripts `docs:catalog`, `docs:find`, and `.gitignore` for
`docs/.doc-catalog.json`.
- **Moves:** none. **Breaks:** nothing. **Touches:** root `package.json` (CI `changes` sees
  code), `.gitignore`.
- **Risk:** classification rules wrong for some path → wrong kind in output only; no gate yet.
- **Rollback:** revert the PR.
- **Done when:** `docs:find` returns the three plan files named in §2.5 for
  "office design receiver" and the owner confirms the result is useful on five real
  queries.

### Stage 2 — entry points and stale-link repair (hand edits, no moves)

Add the matrix and protocol to `llms.txt`, `docs/README.md` and an `AGENTS.md` §19 pointer;
repair `llms.txt` links to ignored files; bump versions and add version diffs as those files
require. Refresh the two registers' prose counts in the same pass.
- **Moves:** none. **Breaks:** nothing resolvable; `docs:check` and preflight stay green
  because only text changes. **Touches:** `llms.txt` (code path in CI), `AGENTS.md`,
  `docs/README.md`, the two registers.
- **Concurrency:** `docs/roadmap/*` is being edited by another session; this stage does not
  touch it.

### Stage 3 — report-only guards (D1–D5 at WARNING)

Add the preflight rule modules in report-only severity and run for two weeks of normal
traffic to measure false positives. Add `docs/superpowers/specs/` and `.brain/plans/` etc.
to the kinds file as **legacy, no new documents**; add to `AGENTS.md` the instruction that
brainstorming and plan skills write to `docs/plans/` (their default output path is the main
source of K9 duplication; the skill's path can be overridden by project instruction).
- **Moves:** none. **Breaks:** nothing; warnings only.
- **Rollback:** revert.

### Stage 4 — enforce on added files (D1, D2, D5 CRITICAL; D3 CRITICAL after one more stage)

Flip severities. Existing files never fail. Collect the false-positive list from Stage 3
first.
- **Breaks:** a PR adding a document to a legacy home or without metadata now fails CI. That
  is the intended effect; communicate through `docs/README.md` and `AGENTS.md`.

### Stage 5 — a few low-risk relocations (owner approves each file)

Only after Stages 1–4. Candidates and exact breakage, from `git grep` at `d694d0c7`:

| Move | Readers that break | Needed in the same PR |
|---|---|---|
| `todo.md` → `docs/archive/` (or delete after owner decision O6) | only `docs/migrations/monorepo/source-manifest.json` and `registry/document-reintegration/documents.json` (pinned by revision, so they stay valid by commit) | none beyond register/README mentions; add `docs:inventory` expectations if archive is checked |
| `hardware-performance-audit.md` → `reports/` or `docs/archive/` | same two pinned manifests; Thai, machine-specific (`D:\zuri-ai`), 2026-08-21 | add frontmatter if placed in `reports/` (`reports/README.md` table row) |
| `MASTER-PROMPT.md` → `docs/archive/` | 10 files: `.agent/reports/*`, `docs/PRD-SDD-v1.0.md` (generated; regenerates from `docs/requirements/SDD-008.md` which names it), `docs/archive/00-START-HERE.md`, `docs/operations/README.md`, `docs/requirements/SDD-008.md`, the manifest. `SDD-008` is a canonical record: editing it is a reviewed record migration, not a link fix | **do not move without an approved SDD-008 amendment**; recommend leaving in place (§10) |
| `docs/superpowers/specs/*` (2 files) → `docs/plans/` | `docs/change-requests/knowledge/genesisrag17-implementation-20261023.md`, the two pinned manifests, the directory register row and the register's `superpowers` entry (preflight `docs-inventory` fails on a registered-but-missing directory); `apps/edge/docs/superpowers` is Edge's own tree and is unaffected | update the CR link, the register row and the directory in one patch |
| `agent/phases/` + `.agent/reports/` pairing | `.agent/reports/*` cite `MASTER-PROMPT.md` and each other; `docs/archive/00-START-HERE.md`, `docs/changes/ZV2-CR-005`, `docs/domains/agent/features/FR-054…` cite `.agent/evidence`; 26 files name `.agent/reports` | **recommend a pointer README, not a move**; the evidence is cited by issued change records |

Moves that need a **redirect stub** at the old path (a short file stating the new location
and the move date) are those with pinned or external readers; stubs cost a file but keep
every link valid. Stubs are themselves K16 and exempt from D4.

### Stage 6 — optional: normalise vocabularies on touch

No mass edit. When a file is next materially edited it adopts the closed lists. A one-time
rewrite of hundreds of `status` values is explicitly **not** proposed.

### What must never move (hard list)

| Never | Why / enforced by |
|---|---|
| any requirement or feature id, subject or declared number | ADR-039; Check 12; `docs/.id-ledger.json` |
| ADR numbers and `docs/decisions/ADR-nnn-*` paths | cited by number across 80 Markdown files, 29 code/config files; AGENTS §17–19 |
| canonical record paths `docs/features/FEAT-nnn/…`, `docs/requirements/<ID>.md` | the registry index and 559 `recordSha256` values; CANONICAL-FORMAT |
| `registry/document-registry/index.json` shape, `PRD-SDD-v1.0.md` and `FEATURES.md` as generated exports | readers and the pinned subject anchors |
| `docs/.id-ledger.json` and the nine `docs/.*-baseline.json` files | preflight reads these exact paths; `ROOT-FILE-REGISTER.md` |
| `docs/archive/`, `.brain/rca/evidence/`, `docs/migrations/document-reintegration/record-migrations/`, `registry/document-reintegration/*.json`, `docs/migrations/monorepo/source-manifest.json` | pinned blob hashes and paths; frozen evidence |
| `docs/domains/<d>/CHARTER.md` paths | model-ownership checks, SRS validation, `GOVERNANCE-MODEL-SOURCES.md` |
| ZV2-CR issued records in `docs/changes/` | issued identity (GOVERNANCE-PROFILE) |
| `docs/roadmap/ROADMAP.md`, its evidence column | Check 13 resolves evidence paths; 81 lines in ROADMAP.md name `docs/`, `.brain/` or `reports/` paths |
| `@spec`/`@req`/`@tested` target paths | 243 annotation lines in 206 source/test files point into `docs/`, so any moved doc breaks code comments the graph reads |
| `.brain/rca/` and `reports/` paths | cited by AGENTS.md, CLAUDE.md, 74 and 18 code/config files |
| `apps/edge/docs/` | separate namespace and preflight (ADR-062) |

## 9. Open owner decisions (not decided here)

| # | Decision | Options | Architect's view |
|---|---|---|---|
| O1 | Adopt the kind matrix (§4) and write-home policy as an ADR? | yes / amend / no | yes, because every later step depends on it |
| O2 | Enforcement style for D1–D3 | added-file rule (no baseline) / shrink-only baseline | added-file rule |
| O3 | Where do dated assessments live long-term? | keep `reports/` (outside `docs/`) / move under `docs/reports/` / leave both | keep `reports/`; moving costs 18 code/config files and changes CI classification |
| O4 | Should `reports/`, `llms.txt` and `registry/` count as "documentation" in `scripts/ci-code-changes.mjs`? | yes / no | yes for `reports/*.md`; this is a CI policy change needing its own review and tests |
| O5 | One closed `status` vocabulary on added files? | yes (§7.3) / keep open | yes, on added files only |
| O6 | Disposition of `todo.md` (self-declared non-SOT, 2026-08-18) and `hardware-performance-audit.md` | archive / report / delete / leave | archive; deletion needs the removal procedure in AGENTS §19 and owner release |
| O7 | Retire `.agent/`, `agent/`, `.rwang-tasks/` as August 2026 machinery? | mark legacy and freeze / leave | mark legacy, keep files, because issued change records cite `.agent/evidence` |
| O8 | Treat `docs/superpowers/` as a legacy home and redirect the skills' default output to `docs/plans/`? | yes / allow `superpowers` as a K9 sub-home | yes; otherwise K9 has two homes |
| O9 | Is the catalog ignored build output (recommended) or a tracked file? | ignored / tracked | ignored (ADR-081); revisit only if a fresh-clone agent must query without Node |
| O10 | Who owns the kinds policy file `DOCUMENT-KINDS.json`? | the governance integrator role / domain charter owners | the existing integrator role (AGENTS §19), because it changes meaning for all |
| O11 | Does the owner want the long dated Compact narrative moved out of `docs/README.md`? | yes / leave | yes, as a separate later edit; it is navigation noise but not wrong |
| O12 | Does D5 (`source_of_truth` uniqueness) need to cover the 17 existing declarations first? | audit them / grandfather | audit; 17 files is a reviewable set |

## 10. Risks and what not to do

### 10.1 Risks of the proposal

- **Classification drift.** `DOCUMENT-KINDS.json` becomes a second thing to keep in sync.
  Mitigated by deriving kind from path prefix plus `doc_type`, and by D1 failing only for
  added files.
- **False positives in D4.** Same-title documents with different roles will flag until
  linked. Mitigated by WARNING severity and a shrink-only list.
- **Agents ignore `docs:find`.** Mitigated by D3 (`prior_art`) visible in review, and by
  putting the command in the two entry points agents already read first.
- **CI cost for edits outside `docs/`.** Stages 1–2 touch `package.json` and `llms.txt`,
  which classify as code. Budget one full Server run per such PR.
- **Concurrent writers.** `docs/roadmap/*` and the ADR sequence are being changed by another
  session; Stage 0 and Stage 3 must re-enumerate before editing (AGENTS §21).
- **This proposal can age.** Counts are at `d694d0c7`; rerun the Appendix A commands
  before approving any stage.

### 10.2 Recommended NOT to do

1. **Do not mass-relocate** `docs/roadmap/PLAN-*` (32 files), `docs/change-requests/`
   (234 files), `docs/domains/project-manager/` (84), `docs/architecture/project-manager-system/`
   (59) or `docs/decisions/`. Each is cited by number or path from 74–1,085 other files and
   by roadmap evidence; relocation buys tidiness, not findability.
2. **Do not introduce a new top-level folder or a new registry file** for documents. The
   catalog is a generated projection.
3. **Do not move to a flat or date-based layout.** It would detach the ADR-025 domain
   spine and every charter-based check.
4. **Do not rename files to a naming scheme.** Adopt the scheme for new files only.
5. **Do not rewrite statuses or frontmatter en masse.** The frozen and pinned families carry
   hashes; the rest rewrites into the same merge-conflict problem ADR-081 removed.
6. **Do not delete** `todo.md`, `hardware-performance-audit.md`, `MASTER-PROMPT.md`, `.agent/`
   or `agent/` as part of this work. They are cited by pinned manifests and issued change
   records, and deletion needs the AGENTS §19 enumeration and an owner release.
7. **Do not commit `docs/.doc-catalog.json`.** ADR-081's measured conflicts apply.
8. **Do not make `docs:find` a gate.** A search cannot be verified; only its declaration can
   (D3).
9. **Do not claim absence from a `docs:find` miss.** AGENTS §21.
10. **Do not touch `apps/edge/docs/`** in this program; Edge's namespace and graph are a
    separate gate (ADR-062).
11. **Do not use `--admin`, auto-merge, or a stacked series of moves** to speed this up; the
    repository merge gate (`changes`, `verify`, `edge-verify`, strict up-to-date) is the
    safety net for generated-state drift.

## Appendix A — Reproduction commands

Run from the repository root; each is read-only.

```bash
git ls-files | wc -l
git ls-files '*.md' | wc -l
git ls-files docs | wc -l
git ls-files docs | awk -F/ 'NF==2' | wc -l
git ls-files docs | awk -F/ 'NF>2{print $2}' | sort -u | wc -l
git ls-files '*.md' | awk -F/ '{ if (NF==1) k="(root)"; else if ($1=="docs" && NF>2) k="docs/"$2; \
  else if ($1=="docs") k="docs (top)"; else if ($1=="apps"||$1=="services") k=$1"/"$2; else k=$1; c[k]++ } \
  END{for(k in c) print c[k], k}' | sort -rn
git ls-files | grep -ci readme
git ls-files docs/decisions | grep -o 'ADR-[0-9]*' | sort -u | wc -l
node -e "const i=require('./registry/document-registry/index.json'); console.log(i.records.length)"
git grep -lE "docs/plans" -- '*.mjs' '*.js' '*.json' '*.yml' ':!docs' ':!registry' ':!.brain' ':!reports'
git grep -hE '@(spec|req|tested|see)[^\n]*docs/' -- apps services tools scripts | wc -l
```

Frontmatter and duplicate-title scan (Node, read-only):

```js
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const files = execFileSync('git', ['ls-files', '-z'], { maxBuffer: 1e9 })
  .toString('utf8').split('\0').filter(f => /\.md$/i.test(f))
const fm = t => { if (!t.startsWith('---')) return null
  const e = t.indexOf('\n---', 3); return e < 0 ? null : t.slice(3, e) }
const has = (b, k) => b && (new RegExp(`^${k}:`, 'm').test(b) || new RegExp(`\\n *${k}:`).test(b))
let n = 0, withFm = 0, docType = 0, status = 0, sot = 0
const titles = new Map()
for (const f of files) {
  const t = readFileSync(f, 'utf8'), b = fm(t)
  n++; if (b) withFm++; if (has(b, 'doc_type')) docType++
  if (has(b, 'status')) status++; if (has(b, 'source_of_truth')) sot++
  const h = (t.match(/^#\s+(.+)$/m) || [])[1]
  if (h) { const k = h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    titles.set(k, [...(titles.get(k) || []), f]) }
}
console.log({ n, withFm, docType, status, sot })
console.log([...titles].filter(([, v]) => v.length > 1).length, 'same-title groups')
```

Orphan heuristic: for each tracked document in the target locations, test whether its
basename (and `%20`-encoded form) occurs in any other tracked hand-written Markdown, any
canonical record, or `llms.txt`, excluding generated views, the reintegration migration
documents and frozen evidence as sources. Basename matching over-approximates references,
so the counts in §2.6 are lower bounds on orphans.

## Appendix B — Disposition of the loose root and `docs/` root files named in the task

None is moved by this proposal. Dispositions are the architect's recommendation for the
owner (decision O6/O7).

| File | Observed | Recommendation |
|---|---|---|
| `MASTER-PROMPT.md` (root, 178 lines, last change 2026-08-22) | Historical build prompt for the Project Manager; cited by canonical `SDD-008`, `docs/archive/00-START-HERE.md`, `.agent/reports/*` | classify K16 (legacy, no new content); leave in place until `SDD-008` is amended through the record workflow |
| `todo.md` (root, 307 lines, 2026-08-18) | Self-declares "not a source of truth"; project-view contract checklist; only pinned manifests mention it | K16 candidate; archive after owner decision |
| `hardware-performance-audit.md` (root, 347 lines, Thai, 2026-08-21) | Machine-specific read-only audit of `D:\zuri-ai`; only pinned manifests mention it | K12 evidence; `reports/` or archive after owner decision |
| `docs/STD-Multi agent workflow S-01.md` | `status: retired`, `superseded_by: ZAI:ADR-113`; space in the filename | keep (registered, pinned source hash); K16; the file name is the reason for the "no spaces" rule for new files |
| `docs/zuri_workspace_system.md` | active design note, version 1.0.1, 13 readers incl. ADR-027/033 and code | K6; leave |
| `docs/schema.local.prisma` | logical starter schema, not the current Server schema | K8 legacy; leave; `ROOT-FILE-REGISTER.md` already points to `apps/server/prisma/schema.prisma` as current |

## Version diff

0.0 → 0.1.0 (2026-11-13): first candidate proposal. Read-only inventory at `d694d0c7`;
no document was moved, renamed, deleted or rewritten and no generated file was edited.
