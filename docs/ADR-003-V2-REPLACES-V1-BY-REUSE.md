# ADR-003 — V2 Replaces V1 by Reusing It (Everything Except Auth)

**Status:** Accepted
**Date:** 2026-08-12
**Decided by:** Owen (owner)
**Supersedes:** [ADR-002](ADR-002-INTEGRATION-DIRECTION.md) (A→B) — in full
**Amends:** [ADR-001](ADR-001-STANDALONE-ZURI-V2.md) and AGENTS.md §1 — the no-copy rule
**Independent review:** Fable 5 (verdict quoted in §5)

## 1. Context — what changed since ADR-002 (one day earlier)

ADR-002 recorded "A→B": mount the Project Manager into Zuri V1 as a module now,
promote V2's scope model later on a trigger. The owner then changed the
destination, which invalidates ADR-002's premise:

1. **V2 replaces V1 entirely.** Not two products operated side by side. V1 retires.
2. **V2 is AI-native with LINE as the primary surface** for intake and interaction.
   The web app is demoted to a back-office console — detailed viewing, complex
   edits, audit.
3. V1 genuinely lacks workspace, business group, project and B2B. V2 adds them;
   they are new capability, not a rewrite of something existing.

Under that destination, ADR-002's option A becomes 100% throwaway work: anything
mounted into V1 retires with V1.

### Measured basis (read-only inspection of `G:\zuri`, 2026-08-12)

| Fact | Value | Why it matters |
|---|---|---|
| Files touching `useTenant`/`TenantProvider` | **21** (19 call `useTenant()`) | UI is *not* deeply coupled to tenant context — a shim is viable |
| `'use client'` dashboard files | **71 / 74** | The UI talks to REST; it does not reach into server internals |
| `fetch('/api…')` call sites | **192** | **This** is the real coupling: the endpoint contract |
| PK convention | uuid in both repos (35 V1 models `@default(uuid())`) | Ids do not need to change at all |
| Design tokens / stack | Zuri Heritage; Next 14.2.35 · React 18.3.1 · Prisma 5.22 · Zod 3.23.8 in both | No conversion cost |
| V1 size | 94 models · 209 routes · 68 pages · 66 repositories · ~300 test files | The thing being replaced |
| V1 velocity | **213 commits / 90 days** | A copy source that keeps moving |
| Language | plain JavaScript, `jsconfig.json`, no TypeScript in either repo | No compiler will enforce any contract |

## 2. Decision

**V2 replaces V1 by reusing V1 — the web UI is lifted rather than rebuilt,
everything except authentication and identity.**

Rationale in the owner's words: rewriting V2 from scratch means V1 is discarded and
its UI never gets used again; reuse is the cheaper path in both time and money.

Execution rules, all binding:

| # | Rule | Reason |
|---|---|---|
| D1 | **V2 replaces V1.** No permanent two-product operation. The unit of "done" is a **per-tenant cutover**, and the last one has a date. | Without a forcing function, "replace" degrades into "run both forever" |
| D2 | **Lift V1's web UI; do not rebuild it.** Exceptions: auth/identity pages, and any overview/report whose mental model is "one shop" | The demotion of the web to back-office is exactly when utilitarian completeness beats new design |
| D3 | **Lift per module, at that module's cutover — not one bulk copy up front** | The source moves 213 commits/90 days; a bulk copy is stale before it ships |
| D4 | **Preserve UUIDs.** Migrate rows keeping V1 ids; add human `code` fields additively; use `ExternalRef` (FR-019) for anything needing relabelling | LINE bindings, printed documents and external systems keep resolving on cutover day |
| D5 | **Freeze V1's endpoint contracts for lifted pages**; reimplement the internals on V2's model; migrate endpoints per module afterwards | 192 call sites; and changing UI + API at once makes failures unattributable |
| D6 | **Write contract tests (recorded request/response fixtures) against V1's endpoints before reimplementing any internals** | Untyped JS: nothing else enforces D5 |
| D7 | **The LINE/AI surface is built on V2-native intent APIs from day one** — never on V1's CRUD contracts | The primary surface must not be shaped by 2024 CRUD routes; V2's intake pipeline is the model |
| D8 | **Single-writer rule per tenant:** a tenant's LINE OA, background workers and data writes belong to exactly one system at any instant; cutover flips all three atomically | Double-processing means double marketing blasts, double charges, dropped chats |
| D9 | **Shim `useTenant()` → active Business, time-boxed**, and ship one genuinely cross-business screen early | Proves V2 is not V1 with new plumbing |
| D10 | Auth/identity is rebuilt: `Employee`(tenant-scoped, own passwordHash) → `Person`/`Membership` across businesses, LINE-based login | The old model cannot express an owner with several businesses |

D3, D6, D7 and D8 came from the independent review and modify the owner's original
framing of "lift wholesale, now". The economics of reuse are unchanged; the timing
and granularity are.

## 3. What this reverses

- **ADR-002 is superseded in full.** Option A (PM as a V1 module) is cancelled,
  along with `TASK-MERGE-*` / `M-*` work items created for it. The three §6
  conditions survive only in the reshaped form above (D4, D9).
- **AGENTS.md §1 / ADR-001 "do not copy `G:\zuri` into this repo" is lifted**, in one
  direction only: **V1 → V2 copying is now permitted and expected.**
  `G:\zuri` remains **never modified** — no edits, no schema changes, no auth changes,
  no production database mutation. `D:\workspace\zuri-command-agent` stays out of
  scope and its `.env` is never read.

## 4. Consequences

Accepted:

- V2 inherits ~60 battle-tested back-office pages at a fraction of rebuild cost, in
  the same design language, with no framework conversion.
- V2 also inherits V1's one-shop mental model in those pages. Cross-business value
  lives in *new* screens (overview, roll-ups, group CRM), not in lifted ones.
- Two systems exist in the codebase during the transition. They must never both own
  the same tenant (D8), and the transition must be time-boxed (D1).
- Production auth, LINE and external AI — all on the MVP's do-not-implement list —
  are now in scope for V2 and need their own decisions (provider, cost, PDPA for
  customer messages).
- POS cashier and kitchen screens are load-bearing operational UI. They cannot
  become chat threads and must be present on day one of any cutover.

## 5. Independent review — Fable 5

Verdict: **RIGHT WITH CONDITIONS.**

> "Lifting V1's UI into V2 is correct economics. 'Wholesale' and 'now' are the
> errors. A solo owner cannot rebuild 68 dashboard pages while also rebuilding 209
> route handlers on a new scope model; and the pages that matter most — POS cashier,
> kitchen, inbox, CRM detail — are shop-scoped operational surfaces that remain
> shop-scoped even under Portfolio→Business. For those pages the `useTenant()` shim
> is honest, not a hack: the active Business in V2 *is* what V1 called a tenant."

On the crux — does demoting the web to back-office argue for or against lifting?
Reviewer argued both sides and committed **FOR**:

> "The demotion is the single best argument for lifting rather than rebuilding. But
> it converts 'wholesale' into 'on demand': the demotion means you no longer know
> which pages earn their keep, so copy nothing until its module cuts over."

Strongest argument against, recorded so it is not forgotten:

> "You inherit the mental model you are escaping. The lifted UI answers 'how is my
> shop doing' 68 different ways. V2's entire reason to exist — cross-business CRM,
> roll-ups, one identity over many shops — has no page in the lifted set. Once the
> console *works*, portfolio-level UI becomes permanently 'later.'"

Failure modes, ranked (likelihood × damage):

1. **The half-migration** — V1 stays live, V2 gestates, 209 routes drag, and the
   owner operates two products indefinitely: the exact outcome "replace entirely"
   was meant to avoid. Mitigation: D1.
2. **Silent contract drift** — untyped JS plus reimplemented internals produces
   response-shape mismatches that surface as broken pages in production.
   Mitigation: D6.
3. **LINE side-effect double-ownership** — `api/webhooks/{line,line-bot,line-monitor}`
   plus workers `campaign-broadcast` / `send-message` / `automation-engine`: if both
   systems own a tenant's OA or queue, real customers get double blasts or dropped
   chats. Mitigation: D8.
4. **Stale bulk copy** — pages copied in month 1, cut over in month 5, missing four
   months of fixes. Mitigation: D3.
5. **Lifting pages the new surface obsoletes** — wasted motion, not fatal.

The reviewer also flagged a meta-signal worth recording: ADR-002 was accepted
yesterday and reversed today with no trigger fired. Direction changes are legitimate
when the destination genuinely changed — as it did here — but a third reversal
without new evidence should be treated as a warning that the destination is not
settled.

The six-month regret to avoid:

> "That 'replace V1 entirely' was declared but never forced: two live systems, a
> drifting copied UI, 209 half-reimplemented routes — paying double maintenance on
> the strategy that was chosen specifically to avoid running two products. Define
> per-tenant cutover as the unit of done, and set a date for the last one."

## 6. Review triggers

Revisit this ADR if any of these happen:

- the first per-tenant cutover slips more than twice, or
- six months pass with no tenant fully cut over, or
- a lifted module is found to need a rewrite anyway (evidence that reuse economics
  were wrong for that class of page), or
- D8 is breached even once in production.
