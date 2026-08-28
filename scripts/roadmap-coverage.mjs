// The rule behind preflight Check 14 (roadmap-coverage), kept out of
// doc-preflight.mjs for the same reason scripts/roadmap-evidence.mjs and
// scripts/id-stability.mjs are: that script is straight-line and derives ROOT
// from its own location, so it cannot be pointed at a fixture. The claim parsing
// is the part with judgement in it, so it lives here where a test can reach it.
//
// Filesystem-free by construction: the delivered set is injected.

/**
 * Every FR id a roadmap row claims.
 *
 * **Ranges are expanded, and that is the whole difficulty of this check.**
 * Roadmap rows cite ranges as often as single ids — `TASK-ZV2-MVP-CORE` covers
 * `FR-001..016`, `TASK-FR-058-064` covers `FR-058..064`, `TASK-FEAT-013` covers
 * `FR-109..111`. A literal-token scan sees `FR-001` and `FR-016` and misses the
 * fourteen ids between them. Measured on main at 893f842: without expansion this
 * check reports 32 uncovered requirements, of which **22 are covered perfectly
 * well** and only 10 are real. Shipping that version would have produced a check
 * that is three-quarters noise, which is a check nobody reads by the end of the
 * week — the same false-positive trap the two resolution bases in Check 13 exist
 * to avoid.
 *
 * Note that `scripts/doc-graph.mjs` builds FEATURE-MAP's Task column from
 * literal tokens and has the same blind spot, so those 22 requirements show `—`
 * there today: a generated governance view reporting no owner for work that has
 * one. That is a separate change with a separate blast radius (it rewrites a
 * committed view) and is deliberately not made here.
 */
export function claimedRequirements(roadmapText) {
  const claimed = new Set()
  const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim())
  const lines = roadmapText.split('\n')

  const start = lines.findIndex((l) => /^##\s+Backlog Items/i.test(l))
  if (start === -1) return claimed
  const headerAt = lines.findIndex((l, i) => i > start && /^\|/.test(l) && /\bTitle\b/.test(l) && /\bID\b/.test(l))
  if (headerAt === -1) return claimed

  // ONLY the ID and Title columns are read, and the first version of this check
  // read the whole row — which made it useless in a way it took a deliberate
  // break-test to expose. Deleting `TASK-FR-104`'s row changed nothing, because
  // FR-104 also appears in another row's **Dependencies** cell and in a
  // **Phases** goal. Being cited as somebody else's dependency is not being
  // accounted for; it is the opposite, a mention that survives precisely because
  // nobody owns the thing. A row *owns* a requirement through its id
  // (`TASK-FR-104`) or by naming it in its title, and nowhere else.
  //
  // **The limitation, because a check that overstates its guarantee is the very
  // thing this file is about.** A title mention credits a row with owning the id,
  // and a title can name an id for other reasons. On 2026-08-28 `TASK-FR-115` and
  // `TASK-FR-116` both named FR-071 in their titles -- referring to what FR-071
  // owns, not accounting for it -- and FR-071 stopped being reported while still
  // having no row of its own. Telling "this row is about X" from "this row
  // mentions X" is not mechanically decidable in prose, so this check is a LOWER
  // BOUND on missing rows, never an exact set: what it reports is definitely
  // missing, what it stays silent about may still be. Do not read silence as
  // coverage.
  //
  // Worth recording plainly: this check exists because a guard read a set that
  // could not contain the failure, and its own first draft read the wrong
  // columns for the same reason. Being alert to the shape does not prevent
  // producing it — only the break-test caught it.
  const header = cells(lines[headerAt])
  const idCol = header.findIndex((c) => /^ID$/i.test(c))
  const titleCol = header.findIndex((c) => /^Title$/i.test(c))
  if (idCol === -1 || titleCol === -1) return claimed

  for (let i = headerAt + 2; i < lines.length && /^\|/.test(lines[i]); i++) {
    const row = cells(lines[i])
    const text = `${row[idCol] ?? ''} ${row[titleCol] ?? ''}`
    for (const m of text.matchAll(/FR-(\d{3})\.\.(\d{3})/g)) {
      const [from, to] = [Number(m[1]), Number(m[2])]
      // A descending or absurd range is a typo, not a claim over the whole
      // registry — read it as covering nothing rather than silencing everything.
      if (to < from || to - from > 200) continue
      for (let n = from; n <= to; n++) claimed.add(`FR-${String(n).padStart(3, '0')}`)
    }
    for (const m of text.matchAll(/FR-(\d{3})/g)) claimed.add(`FR-${m[1]}`)
  }
  return claimed
}

/**
 * Which delivered requirements no roadmap row accounts for.
 *
 * @param {object} input
 * @param {string} input.roadmapText  ROADMAP.md, newlines already canonical
 * @param {Iterable<string>} input.delivered  FR ids that have shipped
 * @returns {string[]} sorted ids
 *
 * **Delivery is read from code anchors, never from a status cell.** An FR counts
 * as delivered when the doc graph holds an `implements` edge pointing at it —
 * i.e. some source file carries `@req` for it. A status column saying ✅ is a
 * claim someone typed; an `implements` edge is a claim the filesystem can be
 * made to retract. A requirement still marked `🔜 declared` with no code is
 * correctly not a gap: its row arrives with its implementation, and demanding
 * one earlier would make the roadmap a wish list.
 *
 * **A consequence worth knowing before you plan a branch: this check makes a
 * requirement's roadmap row a prerequisite for its own feature PR.** The moment
 * a branch adds `@req FR-xxx` to a source file, the graph gains an `implements`
 * edge and the id counts as delivered here — so with no row claiming it, the
 * branch is CRITICAL. The row has to exist on main *before* the feature PR can
 * go green. Yet the row cites an id whose PRD declaration ships with that very
 * PR, which reads like a row pointing at nothing.
 *
 * It resolves because **ROADMAP.md is not an id registry.** Check 12 and the id
 * ledger read the declaring documents, and the roadmap is not one, so a row may
 * name an id no registry has declared yet. Verified 2026-08-28: PR #154 added
 * the TASK-FR-118 row while FR-118 existed only on an unmerged branch;
 * `docs:ids -- --write` reported 0 added and govern passed clean. So the
 * ordering is: **land the row PR first, then the feature PR.**
 *
 * Two qualifications, because the paragraph above is the kind of thing that
 * hardens into ceremony if its limits are not written next to it.
 *
 * Splitting this across two PRs is **not** something the check requires. Putting
 * the row in the feature PR satisfies it in one step and is simpler. The split
 * happened here only because the roadmap lane and the feature lane were held by
 * different concurrent sessions. Do not read the two-PR dance as sanctioned
 * shape; it is the shape parallel lanes force.
 *
 * And **FR-117 is not a precedent for this, though it looks like one.** Merge
 * order on main, UTC: the FR-117 feature landed 23:42, its roadmap row landed
 * 00:21 via PR #142, and this check itself landed 00:41 via PR #144. The feature
 * preceded its row and was never tested against this check at all — it did not
 * follow row-first, it predated the rule. FR-118 is the first requirement the
 * circularity actually constrained. Recorded because the opposite was asserted
 * in conversation and believed by two sessions until someone read the dates.
 */
export function findUncoveredRequirements({ roadmapText, delivered }) {
  const claimed = claimedRequirements(roadmapText)
  return [...delivered].filter((id) => !claimed.has(id)).sort()
}
