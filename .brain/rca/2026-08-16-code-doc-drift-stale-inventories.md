---
version: "0.1.0b"
created_at: "2026-08-16T12:05:00+07:00,CLAUDE"
last_update: "2026-08-16T12:05:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "why code and documentation diverge in this repository"
---

# RCA — "เขียนเอกสารไม่ครบ" was the wrong diagnosis: the inventories lied, not the documents

## Symptom

The owner discovered features and pages by asking questions, not by reading
documentation: two `src/modules/` folders (`business`, `people`) were absent
from the freshly built domain spine, and the File Manager's capabilities were a
surprise. Working hypothesis: *the documentation is incomplete, so nobody knows
what exists.*

## Evidence — the hypothesis is false at the layer everyone blamed

Every "undocumented" thing was documented, thoroughly:

| Artifact | Documentation that already existed |
|---|---|
| `src/modules/business` | FR-041/FR-043 in the PRD registry · feature notes · `@req` annotations in the code · 8 tests linked · a row in FEATURE-MAP whose Module column literally prints `business` |
| `src/modules/people` | FR-042, same completeness — the note even states "reuse Person/Membership", answering the owner's `person.id` question years before it was asked |
| File Manager pages | FR-045 note · ADR-016 · listed in INTERFACE-INVENTORY (the CR-007 registry) · content route annotated |

Requirement-layer coverage was and is 57/57 FRs with code, 57/57 with tests.
**The knowledge existed. The entry points to it lied.** Three exhibits, one
mechanism:

### Exhibit 1 — a hand-written inventory went stale in one day

`CLAUDE.md`'s layout block hand-listed the modules:
`src/modules/{crm,identity,agent,knowledge}`. It was written on **2026-08-12**
(`a7843ab`, the flatten). `business` and `people` were created on
**2026-08-13** (`dea1c04`). The list was wrong within 24 hours of being
written, was loaded into every agent session for three days, and nothing
checked it — prose inventories have no freshness guard.

### Exhibit 2 — a taxonomy was derived from the stale inventory instead of the filesystem

When the domain spine was built (ADR-025), the charter list was taken from
CLAUDE.md's prose — five charters for seven modules. This violated AGENTS.md
§21 (*enumeration before existence claims*) **hours after that very rule was
added to the repo**: building a taxonomy is a bundle of existence claims, and
the builder trusted a summary instead of running `ls src/modules/`.

### Exhibit 3 — a *generated* view went blind and nothing noticed

During the same restructure, an edit to the FEATURE-MAP generator's discovery
was applied via string-replace that silently failed to match; the column edits
applied, the discovery edit did not. The map then regenerated "successfully"
with **zero** of the 26 feature notes found — every doc link and Domain cell
went `—` — and `docs:check` stayed green, because the map was consistent with
its (broken) generator. **"Generated" guarantees consistency with the
generator, not with the world.**

## Root cause

**Inventories drift; nothing asserted them against the source of truth.**

The repository's guards all checked the *requirement* axis (FR → code → tests,
id uniqueness, model ownership). No guard checked the *structural* axis:

- module on disk ↔ domain charter — unchecked (Exhibit 1, 2)
- feature note on disk ↔ row in the generated map — unchecked (Exhibit 3)

Code and docs do not drift because people write too little documentation. They
drift because **anything maintained in parallel to the truth — by hand or by a
broken generator — decays silently unless a check ties it back to the thing it
describes.** This is the fourth occurrence of the class in one day (doc-graph
line-ending hashes; the V1 import writing outside the repo; CLAUDE.md's module
list; the blind FEATURE-MAP), differing only in which mirror decayed.

## Fix (all in this change, all fail-first-verified)

1. **FEATURE-MAP discovery repaired** with a reviewed edit, not a blind string
   replace: notes under `domains/*/features/` are found; Domain and doc-link
   columns are live again (26/26).
2. **Generated-view blindness guard**: preflight CRITICAL when a feature note
   exists on disk that FEATURE-MAP does not cite. Planted proof: before the
   repair this fired listing all 26 notes.
3. **Module ↔ charter guard**: `src/modules/` is *enumerated from the
   filesystem*; every module must be claimed by exactly one charter
   (`modules:` frontmatter list, defaulting to the folder name). Fired on
   `business` and `people` before the charter claimed them.
4. `business` and `people` recorded in the project-manager charter as what the
   code shows they are: **zero-write read slices** — `business` serializes
   PM-owned strategy models (FR-041/043); `people` joins PM's `Membership`
   with crm's `Person` read-only (FR-042), the cross-domain read the
   architecture spec explicitly allows (§5.3).
5. **CLAUDE.md stops hand-listing modules.** The layout now says: enumerate
   `ls src/modules/` and read the charters; preflight enforces the rest. A
   prose inventory that a check cannot protect should not exist.

## Why it escaped detection

Coverage metrics measured what they were built to measure — requirements — and
scored 100%, which read as "documentation is healthy". Structural drift lived
in the gap between metrics. The blind map passed `docs:check` because that
guard compares the committed graph to a fresh scan by the *same* generator: a
generator bug reproduces identically on both sides of the comparison.

## Proposed prevention

1. Any hand-maintained list of things that exist elsewhere (modules, routes,
   domains, files) is a defect unless a check asserts it — prefer deleting the
   list and pointing at the enumeration.
2. Every generated view gets a blindness assertion: some property that is true
   of the world (count, presence of each source item) checked against the
   view's output by an *independent* path, not the generator itself.
3. Taxonomy-building sessions start with enumeration (`git ls-files`,
   `ls src/modules/`), never with a summary document — AGENTS.md §21 applies
   to building indexes, not just to answering questions.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-16 | beta | Root-caused code↔doc drift to unasserted inventories (hand-written and generated); added blindness + module↔charter guards | pending | CLAUDE |
