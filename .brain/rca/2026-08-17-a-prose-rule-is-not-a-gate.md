---
version: "0.1.0b"
created_at: "2026-08-17T07:30:00+07:00,CLAUDE"
last_update: "2026-08-17T07:30:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "a rule stated in CLAUDE.md and enforced by nothing — 26 hand-copied enum lists, two of which drop the same value"
---

# Incident — a prose rule is not a gate

## Summary

CLAUDE.md states it plainly:

> **Enums are strings in the database**, with `src/lib/validation/enums.js` as the
> single source of truth. Excel dropdowns, the OpenAPI document and validation all
> derive from it — never hand-copy an enum list.

Nothing enforced it. **26 hand-copied enum lists** had accumulated across
`src/`. Twelve are incomplete — they spell out a subset and silently lose the
rest.

The cost is not theoretical:

```
6/7 WORK_STATUSES  views/KanbanBoard.jsx             MISSING: CANCELLED
6/7 WORK_STATUSES  views/execution/mode-bodies.jsx   MISSING: CANCELLED
```

A WorkItem in `CANCELLED` renders in **no column on the board and in no
execution-mode view**. It does not error, it does not warn — it is simply not
there. `KanbanBoard.jsx`'s own comment says it groups "by the seven canonical
statuses"; it groups by six.

## Root cause

Two copies of the same enum, made independently, dropped **the same value**.
That is not two coincidences. It is the signature of a list copied from another
copy, or from the same mental model of "the statuses that matter" — and neither
copy had any mechanism to notice the enum had grown past it.

The underlying cause is duller and more important: the rule lived in a document.
A rule that is only written down is advice. It is followed exactly as long as
the person writing the code happens to remember it, which over 226 source files
means "sometimes".

This repository already learned this on 2026-08-17 with three other rules —
route annotations, viewer fixtures and test-suite honesty were all conventions
until they became checks, and all three had accumulated debt in exactly the same
way. This is the fourth instance of one pattern.

## How it was found

Not by reading. While declaring [FR-063](../../docs/domains/project-manager/features/FR-063-project-board.md)
for the Board — a page that had shipped for months with no requirement — the
statement had to say what the board actually renders. Writing "one column per
status" meant checking which statuses, which meant comparing `COLUMNS` against
`WORK_STATUSES`.

**The doc-before-code rule found a live defect that no test had.** That is worth
recording on its own: the value of writing the requirement first is not
paperwork, it is that a precise sentence cannot be written about vague code.

A repo-wide probe then showed the single instance was 26.

## Fix — preflight check 9, `enum-copy`

A shrink-only ratchet, the same shape as the route-anchor and viewer-fixture
checks:

- Parses every `export const X = [...]` of ≥3 string literals from `enums.js`.
- Flags any file spelling out ≥3 members of one enum. Three is the threshold
  because many enums share `DONE`/`ACTIVE`, so two is coincidence.
- New copies are CRITICAL. The 26 existing ones are recorded in
  `docs/.enum-copy-baseline.json`, which may only shrink.
- The INFO line names which of the remaining copies are **incomplete**, and what
  they are missing — because those are the ones that silently drop a value.

Proven in both directions: a planted copy fails the run; removing it passes.

**What the check deliberately does not do** is judge whether a given copy is
wrong. A subset can be legitimate — terminal statuses only, active-only filters.
A guard that guesses at intent produces false positives, and false positives
teach people to restructure code to escape the guard rather than fix the
problem. That happened in this very session; see
[the companion incident](2026-08-17-a-guard-that-teaches-a-workaround.md).

## Prevention

1. **When you write a rule in CLAUDE.md or AGENTS.md, ask in the same sitting
   what would fail if someone broke it.** If the answer is "nothing", the rule is
   a wish. Either write the check or write down that it is unenforced.
2. **An incomplete copy of a closed vocabulary is a silent-loss bug, not a style
   issue.** The value that gets dropped is invisible by construction: it renders
   nowhere, so nobody sees the thing that is missing.
3. **A ratchet needs its baseline generated from the check's own output**, never
   typed. This one was produced by running the check and recording what it found.
4. Two independent implementations losing the same value means they were not
   independent. Treat a repeated omission as evidence of a shared source, and go
   looking for the third copy.

## Open

The 26 copies are debt, not fixed. The 12 incomplete ones deserve triage in
priority order — `KanbanBoard` and `mode-bodies` first, since those two are the
proven silent-loss case and both belong to shipped, user-facing surfaces
(FR-063, FR-009). Tracked as Lane B in
`.brain/waves/2026-08-17-wave-0-1-ledger.md`.
