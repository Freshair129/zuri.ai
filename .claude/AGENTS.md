# .claude/AGENTS.md — working on SCM/CRM-style domain-bar grouping

Read this before touching `apps/server/src/config/domains.js`'s `DOMAIN_GROUPS`
export, adding a new one, or doing anything the owner describes as "จัดกลุ่ม
[domains] ตามหลัก ERP" (group these domains by ERP taxonomy). This file exists
outside `docs/` on purpose — see "Why this lives in `.claude/`, not
`docs/domains/`" at the bottom.

## The pattern, in one paragraph

`DOMAINS` (in `domains.js`) is the flat, authoritative list of route keys every
consumer walks — above all `VIEWER_DOMAINS = DOMAINS.map(d => d.key)`, which
filters persisted `Membership.domainKeysJson` grants. `DOMAIN_GROUPS` is a
**separate** array, declared beside it, that says which flat keys present as
one slot in the domain bar. `domainBarSlots()` and `sidebarDomainForPath()`
already read `DOMAIN_GROUPS` generically — adding a second, third or fourth
group needs **zero changes** to either function, to `DomainBar.jsx`,
`Sidebar.jsx` or `CommandPalette.jsx` (the palette walks the flat list
directly and was never touched by either group added so far). If you find
yourself editing any of those four files to add a group, stop — the pattern
was built specifically so you would not have to.

## The precedent chain

- **ADR-069** — SCM groups `inventory`, `warehouse`, `procurement`, `commerce`.
  The original design decision: why `DOMAINS` stays flat, why a group is
  "never a grant," why the group needs no charter (D5), why a colliding leaf
  label gets relabelled rather than the group (D4).
- **ADR-071** — CRM groups `customer`, `market`. Extends ADR-069 to the rest
  of the bar on the owner's follow-up instruction. Its Context table is the
  worked example of the actual judgment call below — read it before making
  the same call again.
- `docs/ERP-MODULE-MAP.md` — the bridge document between the owner's ERP
  vocabulary ("Supply Chain Management: Warehouse, Inventory, Procurement,
  Order Management") and the domain lanes that answer it. Add a row here
  for every ERP module the owner names, grouped or not.

Read both ADRs in full before starting; do not re-derive their reasoning from
the code alone.

## The judgment call: group, or leave standalone?

ADR-071's Context table asked one question per remaining domain: **is this
one ERP-recognised business function shown as more than one peer tab, when it
should be one tab with sub-domains?** Two things followed from a "no":

- A domain that already stands as a single, complete ERP-style module with no
  sibling to consolidate needs no group — Development, Asset Management,
  HR/People, Platform, LINE OA Studio all failed this test and stayed
  standalone, and that check is recorded in the ADR so it is not re-litigated.
- A domain that merely shares a *word* with a candidate group is not
  automatically a fit. Marketing was explicitly **not** folded under CRM even
  though CRM taxonomy in every suite the owner would recognise (Salesforce,
  HubSpot, SAP C/4HANA, Odoo) treats market/customer intelligence as a CRM
  analytics function — because those same suites offer Marketing as its own
  top-level application, not a CRM child. Nesting it would have misrepresented
  the taxonomy, not honoured it. Check the real vendor taxonomy, not just
  whether two labels sound adjacent.

When you do find a genuine grouping, the mechanical shape is fixed by
precedent, not up for re-invention each time:

1. Add one entry to `DOMAIN_GROUPS`: `key`, `label`, `caption` (Thai), `icon`
   (a new lucide-react icon distinct from every child's own), `childKeys` (in
   bar order).
2. If any child's own `label` collides with the new group's `label` (it will,
   if the group is named after what used to be that child's own name), relabel
   the **child**, never the group, and never the route `key` — keys are
   immutable (§18). Document the relabel with an `@req`/ADR-reference comment
   at the child's declaration, the same way `customer`'s was.
3. Write a new `tests/unit/<name>-group-navigation.test.js` mirroring
   `scm-group-navigation.test.js` (or `crm-group-navigation.test.js`, which is
   the shorter two-child example) — same six assertions: children named in
   order and real, container-never-a-grant, route ownership stays on the leaf,
   stands in the bar once, sidebar lists the whole group with children
   relabelled, every domain the ADR rejected stays standalone.
4. If a second group already exists, fix `scm-group-navigation.test.js`'s (or
   whichever existing test's) "stands in the bar once" assertion if it still
   asserts `groups).toHaveLength(1)` — that assertion needs to name the one
   group it is testing, not the total count, once more than one group shares
   the bar.
5. Add a row to `docs/ERP-MODULE-MAP.md` for the new group, in the same format
   as the SCM and CRM sections — one markdown table, one "why these and not
   X" paragraph if a plausible-looking alternative was rejected.

## Governance sequence — declare before you implement

This repository's own rule (§18, and the owner's own "แก้ doc ก่อน!!" — fix the
doc first — mid-task interruption on 2026-09-08): write the ADR and declare
the FR **before** editing `domains.js`. Concretely, in order:

1. Write the ADR (`docs/decisions/ADR-0XX-....md`), matching ADR-069/071's
   structure: Context (the table), Decision (D1..D6), Consequences.
2. Add the FR row to `docs/PRD-SDD-v1.0.md` (table row + a new revision-history
   row) and the readiness-metadata entry in `docs/FEATURES.md`.
3. **Before finalizing the FR/ADR numbers**, check `origin/main` for a
   concurrent, unrelated declaration of the same next number — `git fetch
   origin main && git log --oneline <branch>..origin/main` and skim what
   landed. This is not paranoia: FR-171/ADR-070 were independently declared by
   this exact lane and by an unrelated concurrent PR (agent execution trace)
   on 2026-09-08, and the later-to-merge one (this lane) had to renumber to
   FR-172/ADR-071 across every file that named the old numbers — the ADR file
   itself, PRD-SDD, FEATURES, ROADMAP, ERP-MODULE-MAP, `domains.js` comments
   and every test comment. Checking first is cheaper than renumbering after.
4. `cd apps/server && node scripts/id-ledger.mjs --write` to pin the new ids.
5. Implement in `domains.js` (+ tests, per the mechanical shape above).
6. Add a `TASK-FR-0XX` row to `docs/roadmap/ROADMAP.md` under the domain's
   existing `PHASE-ZAI-<DOMAIN>` phase (CRM's used `PHASE-ZAI-CRM`, already
   populated by the domain's own earlier build).
7. `npm run govern` **from the repository root**, not from `apps/server` —
   root `govern` regenerates both the server graph and
   `docs/.monorepo-graph.json`; running it from `apps/server` leaves the
   monorepo graph untouched and stale, which CI catches as "Monorepo graph is
   stale" even though local `govern` looked clean.
8. Run every generator **after your last source/test edit, not before** — a
   `govern` pass proves the tree as it was when it ran, and a test file edited
   afterward (even just fixing a comment) invalidates `docs/.monorepo-graph.json`
   the same as a source change does. This exact mistake produced three
   avoidable CI failures on 2026-09-10; see the `project-domain-state-regen-
   after-merge` session memory for the fuller account.
9. Before `git push`, run `node apps/server/scripts/monorepo-graph.mjs
   --check` directly — it is the exact gate CI runs, exits 0/1 in about a
   second, and answers "is the committed graph current" without a CI round
   trip.
10. Full test suite (`npm test` from `apps/server`), `docs:check`,
    `docs:preflight` all clean before committing.

## Merge-conflict shape to expect

A branch built this way will very likely conflict with `origin/main` by the
time it merges — this repo lands many concurrent PRs a day. The conflicts are
almost always in the same small set of generated files
(`apps/server/runtime/domain-state.json`, `docs/.doc-graph.json`,
`docs/.domain-state.json`, `docs/.monorepo-graph.json`,
`docs/.preflight-report.json`, `docs/FEATURE-MAP.md`, `docs/TRACE.md`,
`docs/appendices/D-traceability.md`) — resolve those with `git checkout
--theirs <file>` and regenerate, never by hand. A real id collision (as above)
additionally conflicts `docs/.id-ledger.json` — resolve by taking `origin/main`'s
side wholesale (`git checkout --theirs docs/.id-ledger.json`) and re-running
`docs:ids -- --write` afterward to pin your renumbered ids fresh, rather than
hand-splicing the JSON (a hand-spliced edit dropped an unrelated roster entry
once already, caught by `id-anchor-stability.test.js`).

## Why this lives in `.claude/`, not `docs/domains/`

A `DOMAIN_GROUPS` entry owns no model, no route, no module (ADR-069 D5) — so
it gets no `docs/domains/<d>/CHARTER.md`, because the charter contract binds a
domain folder to a `src/modules/<m>` that does not exist for a navigation
group. That leaves this class of work with no natural home in the doc-code
graph, and the reasoning above is Claude-session-facing operational guidance
(how to approach the task) rather than product documentation (what the
product is) — so it sits here, outside `docs/` and outside every preflight
check that graph enforces, the same way `.claude/launch.json` and
`.claude/settings.json` already do.
