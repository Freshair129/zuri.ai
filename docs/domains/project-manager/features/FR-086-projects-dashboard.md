---
domain: project-manager
feature: FR-086
module: project-manager
source: v2-native
---

# FR-086: Projects Dashboard (UX/UI plan)

| Field | Value |
|---|---|
| **Version** | 1.1.0 |
| **Status** | Proposed — design only, no implementation authorized |
| **Date** | 2026-08-19 |
| **Relates to** | ADR-036 and ADR-037 (the decisions), FEAT-008, FR-087, FR-088, FR-089, SDD-047 · FR-001, FR-003, FR-005, FR-036, FR-060, FR-077, NFR-008, SDD-045 |

The ADRs settle what is true; this note describes what the user sees. Read
ADR-036 D1–D6 and ADR-037 first — four of the requested items did not exist in
the model, and the decisions about them are there, not here.

**Two of those decisions were the reader's and have been taken** (2026-08-19):
the surface is called **Dashboard**, not Overview, so `/overview` keeps meaning
one thing; and **Team becomes a real entity** (FR-089, ADR-037) rather than the
count being dropped or faked from Business memberships.

## The band: what it counts, and what it refuses to

```text
┌ Projects ─────────┬ Work ───────────────┬ Teams ──────┬ People ────────────┐
│ 12 total          │ 248 total           │ 4 teams on  │ 9 people with      │
│  7 active         │  63 in progress     │   projects  │   work assigned    │
│  3 done           │ 140 done            │             │                    │
│  2 other ▸        │  45 other ▸         │             │                    │
└───────────────────┴─────────────────────┴─────────────┴────────────────────┘
```

Two rules govern this band, and both exist so a reader can trust it:

1. **The numbers sum.** `PROJECT_STATUSES` has five values and `WORK_STATUSES`
   has seven; the ask named three of each. The remainder is shown as `other`,
   expandable, rather than dropped — a band whose parts do not add up to the list
   beneath it teaches the reader to distrust every figure on the page.
2. **Teams and people are two figures, not one.** Teams counts `ProjectTeam`
   links (FR-089); People counts distinct `WorkItem.assigneeRef`. A team can be
   attached to a project with nobody assigned yet, and a person can be assigned
   work while belonging to no team — so neither number can be derived from the
   other, and each card says which it is counting. What the band must never do is
   count Business `Membership` rows and label the result "teams": that answers
   "who may work in this Business", which is a third question again.

`Kpi` and `ProgressBar` already exist in `@/components/ui` — the band uses them
rather than introducing a second visual language for a number in a box.

## Top 5 Priority Projects

Ordered by FR-087's `priority`, then by `targetAt` inside a tie.

**Before any priority is set, the panel is empty on purpose.** It says the field
is unset and links to where it is set. The alternative — quietly ordering by
`targetAt` — puts five projects under a heading that says "Priority" when the
list means "soonest deadline", and the reader has no way to detect the
substitution. An empty state that explains itself is recoverable; a plausible
wrong answer is not.

## The list

| Column | Source | Note |
|---|---|---|
| Code | `Project.code` | |
| Project Name | `Project.name` | links to the project |
| Size | derived | count of non-deleted `WorkItem` under the Project (ADR-036 D2) |
| Space | `workspace.code` | unchanged |
| Streams | `workstreams.length` | unchanged |
| Status | `Project.status` | `StatusPill`, unchanged |
| Progress | pure calculators | weighted roll-up, read-only, never writes `progressCache` |
| Target | `Project.targetAt` | unchanged |
| PIC | FR-088 | one accountable Person; `—` when unset, never a guessed name |
| Priority | FR-087 | `—` when unset |

Ten columns is wide. Three things keep it usable rather than requiring a
horizontal scrollbar on a laptop:

- **Progress is a bar with its number beside it**, not a bar alone — a bar
  without a value cannot be read by anyone using a screen reader, and cannot be
  compared precisely by anyone else.
- **Size and Streams are numeric and tabular-aligned** (`number-tabular`), so the
  eye can scan a column instead of re-reading each cell.
- **On narrow viewports the table degrades to a card per project** rather than
  scrolling sideways; `horizontal-scroll` is the rule the current page already
  honours and the e2e suite already asserts at mobile width.

## `New project` moves here

The action exists **twice** today: on this page (`/projects/new`) and in the
Topbar. FR-086 removes the Topbar copy.

The reasoning is not tidiness. A global control that creates a Project from
anywhere implies Project creation is context-free, when it is not — it is scoped
to the Business or Space the shell has selected. Putting the single copy on the
surface that shows that scope makes the scope visible at the moment it applies.

## Accessibility

NFR-008 binds WCAG 2.2 AA, and a page of numbers has specific obligations:

- Each KPI is a labelled figure, not a large number next to small text that only
  looks like a label. The accessible name carries both.
- Progress uses a real progress semantic with its value, not a coloured `div`.
- `other ▸` is a disclosure with `aria-expanded`, matching the pattern the
  Project tab bar now uses, rather than a third way of hiding things.
- Priority must not be colour alone (`color-not-only`) — the level is a word, and
  colour reinforces it.
- Sortable columns announce their sort state with `aria-sort`.

## Open questions

1. **Scope of the band.** Business-scoped like the list, or does a Space
   selection narrow it too? The list already honours both (`workspaceId` wins
   over `businessId`); the band must use the identical filter or the two halves
   of one page will disagree, which is worse than either choice.
2. **Who may set PIC and priority?** FR-072-style Business ownership is the
   obvious answer, but it is a decision, and the editing path is what FR-087 and
   FR-088 have to specify before FR-086 can render an editable cell.
3. **Does "done" mean `DONE` only, or `DONE` + `ARCHIVED`?** The band's honesty
   rule forces an explicit answer rather than an implicit one.
