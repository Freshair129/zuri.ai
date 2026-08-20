// The firing rules for the id-stability gate, as one pure function.
//
// @spec docs/decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md
// @spec AGENTS.md §18 — an id is a key, not a label
// @tested tests/unit/id-anchor-stability.test.js
//
// It lives here rather than inline in scripts/doc-preflight.mjs for one reason:
// the incident this guard exists to catch has to be a regression test, and a
// straight-line script that derives its ROOT from its own location cannot be
// pointed at a fixture. Preflight passes the real tree in; the test passes the
// 2026-08-20 SDD-049 repurpose in. Same code decides both.
//
// WHAT HAPPENED. PR #88 hit an id collision and resolved it by renumbering
// SDD-049 — a statement that had already merged to main — to SDD-050, taking
// SDD-049 for its own market-translation seam. AGENTS.md §18 forbids exactly
// that. Nothing caught it: preflight's duplicate-id guard sees two rows sharing
// a key, and a MOVED id is not a duplicate at any single moment, so every check
// stayed green while an e2e test went on citing SDD-049 for a subject it had
// never been written against. It was the second occurrence — on 2026-08-15 a
// stale whole-file copy of the registry merged over main, repurposing FR-051 and
// SDD-026 and deleting fifteen other declared ids outright.
//
// This does not make either move impossible; a deliberate, declared supersede is
// legitimate. It makes the move VISIBLE — the ledger's `history` is append-only
// and its `roster` never loses a name, so overwriting a subject is a line the
// reviewer reads, under a number the author was not supposed to touch, next to a
// written justification.
//
// THE LAUNDERING PATH THIS FILE USED TO HAVE. Adversarial verification found the
// central promise broken: deleting an id's block from the ledger turned the whole
// SDD-049 incident into a routine "unpinned id" CRITICAL whose own printed
// remedy (`docs:ids --write`) re-pinned the NEW subject with reason "declared"
// and exited 0, leaving a PR diff containing no deleted line at all. A1 skipped
// (no pin to compare), A2 skipped (the incumbent it compares against was the
// deleted pin), and nothing anywhere recorded that the id had ever been pinned.
// That is fixed at the cause: the ledger now carries `roster`, an append-only
// list of every id ever pinned, so an entry that leaves is a fact the gate can
// see (A9) and the writer refuses to paper over.

import { sameAnchor, identicalAnchor, REGISTRIES as DEFAULT_REGISTRIES, BURNT_FAMILIES as DEFAULT_BURNT } from './id-anchors.mjs'

/** A reason short enough to be a shrug is not a reason. Shared with the writer. */
export const MIN_REASON = 40

const lastOf = (entry) => (entry && entry.history && entry.history.length ? entry.history[entry.history.length - 1] : null)
/** The subject an id currently stands for: the last thing appended, nothing else. */
export const anchorOf = (entry) => lastOf(entry)?.anchor ?? null

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const headToken = (a) => String(a || '').split(' ')[0]

/**
 * A NEW id holding an EXISTING id's subject, word for word. Exported because the
 * writer must refuse the same thing the gate reports — a rule enforced in one
 * place and read in two cannot drift.
 *
 * Strict equality, not the tolerant comparison: a renumber copies the statement,
 * so the anchors are identical, while splitting a requirement into slices
 * ("…, second slice: …") is a normal edit that the tolerant rule accused of being
 * a renumber and offered no way out of.
 *
 * Only a `current` incumbent counts — re-stating a subject that was deliberately
 * retired, under a fresh number, is the recommended path. Same family only: a
 * FEAT is named after the FR it bundles and an ADR after the decision it records,
 * so cross-family anchor sharing is the norm here (7 of the 8 anchor pairs in the
 * tree the day this shipped), while a renumber is always a move to the next free
 * number WITHIN a family.
 */
export function inheritedFrom(declared, pinned) {
  const out = new Map()
  for (const [id, d] of declared) {
    if (pinned[id]) continue
    for (const [other, e] of Object.entries(pinned)) {
      if (other === id || e.family !== d.family || e.status !== 'current') continue
      if (e.retired_to === id) continue // this branch renumbered ITSELF; that is the good path
      if (identicalAnchor(anchorOf(e), d.anchor)) {
        out.set(id, other)
        break
      }
    }
  }
  return out
}

/**
 * Evaluate every arm against one snapshot.
 *
 * @param {Map} declared      id → { family, source, anchor, status } from collectDeclared(),
 *                            carrying .duplicates and .missing from the same scan
 * @param {object} ledger     parsed docs/.id-ledger.json, or {} — a missing file
 *                            degrades to the STRICTEST state (nothing pinned),
 *                            never the loosest
 * @param {(p:string)=>string|null} readDoc  repo-relative reader, for the burnt-row
 *                            and version-row scans
 * @param {(id:string)=>string[]} citersOf   blast-radius evidence, called only
 *                            once something has already fired
 * @param {{path:string,body:string}[]} namedFiles  files whose basename may carry an id
 * @returns {{severity:string,check:string,title:string,details:string,files:string[],action:string}[]}
 */
export function evaluateIdStability({
  declared,
  ledger = {},
  readDoc = () => null,
  citersOf = () => [],
  namedFiles = [],
  registries = DEFAULT_REGISTRIES,
  ledgerPath = 'docs/.id-ledger.json',
} = {}) {
  const out = []
  const emit = (severity, title, details, files, action) => out.push({ severity, check: 'id-stability', title, details, files, action })
  const pinned = ledger.ids || {}
  const roster = ledger.roster || []
  const bulkById = new Map((ledger.bulk_revisions || []).map((b) => [b.id, b]))
  const burntFamilies = (ledger.burnt_families || []).length ? ledger.burnt_families : DEFAULT_BURNT
  const registryOf = (family) => registries.find((r) => r.families.includes(family))
  const duplicates = declared?.duplicates || []
  const missingRegistries = declared?.missing || []
  const familyIsUnreadable = new Set(missingRegistries.flatMap((m) => m.families))

  const withCiters = (id, source) => {
    const files = citersOf(id).filter((p) => p !== source)
    if (!files.length) return ' · nothing else cites this id yet'
    return ` · ${files.length} file(s) still cite this id: ${files.slice(0, 12).join(', ')}`
  }

  // --- A0: a registry is not where it is recorded and not anywhere under docs/.
  // Reported ONCE about the registry, and it suppresses A4 for those families.
  // The first cut hardcoded the paths and had no such arm, so `git mv` of the
  // risk matrix — which AGENTS.md §18 and this check's own INFO arm both declare
  // FREE — produced fourteen CRITICALs telling the author to restore rows that
  // had never been deleted.
  for (const m of missingRegistries) {
    emit('critical', `the ${m.families.join('/')} registry is not readable`,
      `recorded at ${m.recorded_at}, and no single file of that name is readable under docs/ — ${Object.values(pinned).filter((e) => m.families.includes(e.family)).length} pinned id(s) in these families were not checked this run`,
      [m.recorded_at],
      'Moving or renaming a document is free (AGENTS.md §18) and this check follows a registry by basename, so it is only reported when ' +
        'the file is gone from docs/ entirely. Restore it, or — if the registry genuinely moved out of docs/ or was renamed — update its ' +
        'row in REGISTRIES (scripts/id-anchors.mjs). Never delete pinned ids to make this quiet')
  }

  // --- A0b: a second declaration row for an id already declared. doc-graph keeps
  // the first row in file order and silently drops the rest, so a second
  // `| SDD-049 |` row carrying an unrelated statement was invisible to every
  // check in this repository, and WHICH statement won depended on file order —
  // which carries no meaning. The duplicate-id guard in preflight reads document
  // filenames only; nothing read registry rows.
  if (duplicates.length) {
    emit('critical', `${duplicates.length} id(s) are declared twice in a registry`,
      duplicates.map((d) => `${d.id} in ${d.source}: the row that counts says "${d.first.anchor}", the dropped row says "${d.anchor}"`).sort().join(' · '),
      [...new Set(duplicates.map((d) => d.source))],
      'An id is claimed by exactly one row (AGENTS.md §18). Everything downstream — the doc graph, the traceability matrix, this check — ' +
        'keeps the FIRST row and drops the rest, so the second statement is not merely unenforced, it is unread. Delete it, or give it the ' +
        'next free number')
  }

  // --- A2 runs before A3 so A3 does not also report the same id as merely
  // unpinned. A NEW id holding an EXISTING subject is a renumber, whatever the
  // prose did. It is the arm that names the DESTINATION, which is what makes the
  // finding self-describing: without it a reviewer reads "SDD-049 changed
  // subject" and has to work out where the displaced statement went.
  const inherited = inheritedFrom(declared, pinned)
  for (const [id, from] of [...inherited].sort()) {
    emit('critical', `${id} inherits the subject recorded for ${from}`,
      `"${anchorOf(pinned[from])}" — a new id holding an existing subject is a renumber${withCiters(from, pinned[from].source)}`,
      [ledgerPath, declared.get(id).source],
      `An id is a key (AGENTS.md §18): a statement moves to a new number only when the OLD number is retired and left burnt. ` +
        `If ${from} and ${id} collided, the LATER declaration renumbers itself and the incumbent stays put — main is the published ` +
        `trunk (the af0a6f0d1 and FR-093/SDD-051 precedent): npm run docs:ids -- --abandon ${id} --to <NEW-ID> --reason "…". ` +
        `If ${id} is genuinely a NEW statement that happens to open with the same words as ${from}, say so once and it stops asking: ` +
        `npm run docs:ids -- --distinct ${id} --reason "<sentence>". Plain --write will not pin it, and hand-editing ` +
        `docs/.id-ledger.json to make this green defeats the only record of what happened`)
  }

  // --- A1: a pinned subject moved. Measured over the whole first-parent history
  // of docs/PRD-SDD-v1.0.md: 6 fires, 5 of them the incident set, 1 a genuine
  // rewording inside the anchor window (FR-012 at 4a86409ae) — which is why
  // --reword exists and is named here. A gate whose only remedy calls a copy-edit
  // a forbidden move teaches authors to reach for the override.
  const movedIds = []
  for (const [id, d] of declared) {
    const e = pinned[id]
    if (!e || e.status === 'burnt') continue
    if (!sameAnchor(anchorOf(e), d.anchor)) movedIds.push({ id, was: anchorOf(e), now: d.anchor, source: d.source, draft: d.draft })
  }
  movedIds.sort((a, b) => a.id.localeCompare(b.id))
  for (const m of movedIds) {
    const sameSubject = headToken(m.was) === headToken(m.now)
    emit('critical', `${m.id} changed subject without a declared move`,
      `"${m.was}" → "${m.now}"${withCiters(m.id, m.source)}`,
      [m.source, ledgerPath],
      (m.draft
        ? `${m.source} is a DRAFT registry: a whole-file revision of it is recorded in one block — npm run docs:ids -- --bulk ${m.source} --reason "<sentence>". `
        : '') +
        (sameSubject
          ? `If the statement was reworded and still says what it said — the head of it is unchanged — that is not a move: ` +
            `npm run docs:ids -- --reword ${m.id} --reason "<sentence>" records it in one line and costs nothing else. `
          : '') +
        'An id is a key (AGENTS.md §18). If this is a collision, the LATER declaration renumbers itself — main is the published trunk. ' +
        'If the subject genuinely stopped being true, retire it the SEC-004 way (strike the statement, say why in the status cell, then ' +
        'npm run docs:ids -- --supersede <ID> --reason "…") and take the next free number. Only if the number really must come to mean ' +
        'something else: npm run docs:ids -- --declare <ID> --reason "<sentence>". Never hand-edit an anchor in docs/.id-ledger.json')
  }

  // --- A3: a declared id nobody pinned. The only thing standing between this
  // ledger and silently falling behind reality. Routine to repay: it is a "+"
  // block — but only for an id that was never pinned before, which is what the
  // roster (A9) is there to establish.
  const unpinned = [...declared.keys()].filter((id) => !pinned[id] && !inherited.has(id) && !roster.includes(id)).sort()
  if (unpinned.length) {
    emit('critical', `${unpinned.length} declared id(s) are not pinned`, unpinned.join(', '), [ledgerPath],
      'Run npm run docs:ids -- --write to pin them. This is the routine case — a "+" block in docs/.id-ledger.json, no ceremony')
  }

  // --- A9: an id that was pinned once and whose entry is gone. This is the arm
  // that closes the laundering path: without it, deleting a block turned a
  // repurpose into the routine A3 case above, and --write re-pinned the new
  // subject with reason "declared", producing a PR diff with no deleted line in
  // it at all. `roster` is written by the same pass that writes the entry and is
  // never pruned, so the two disagreeing is a fact, not an opinion.
  const removed = roster.filter((id) => !pinned[id]).sort()
  if (removed.length) {
    emit('critical', `${removed.length} id(s) were pinned and their ledger entry is gone`,
      removed.map((id) => `${id}${declared.has(id) ? ` (still declared in ${declared.get(id).source})` : ' (no longer declared either)'}`).join(', '),
      [ledgerPath],
      'An entry never leaves this ledger — that is the whole mechanism (ADR-039 D9). Restore it: git show HEAD:docs/.id-ledger.json. ' +
        'A merge that resolved a conflict by taking one side does this by accident; --write will NOT re-pin these, because re-pinning a ' +
        'deleted entry is indistinguishable from declaring a new id and that is exactly how a repurpose was launderable. If the number ' +
        'genuinely has to change meaning, restore the entry first and then npm run docs:ids -- --declare <ID> --reason "<sentence>"')
  }

  // --- A4: a pinned id no registry declares any more. Nothing in this repository
  // detected this before: the 2026-08-15 clobber deleted fifteen ids outright and
  // every check stayed green for four days while code cited requirements that no
  // longer existed. Skipped for a family whose registry A0 already reported as
  // unreadable — "the file is missing" and "the rows were deleted" are different
  // accidents with different repairs.
  const vanished = Object.entries(pinned)
    .filter(([id, e]) => (e.status === 'current' || e.status === 'superseded') && !declared.has(id) && !familyIsUnreadable.has(e.family))
    .map(([id]) => id)
    .sort()
  for (const id of vanished) {
    emit('critical', `${id} is pinned but no longer declared anywhere`,
      `last recorded subject: "${anchorOf(pinned[id])}" (was in ${pinned[id].source})${withCiters(id, pinned[id].source)}`,
      [ledgerPath],
      'A declared id does not disappear. If a merge overwrote a registry with a stale whole-file copy — how FR-052…SEC-012 were deleted ' +
        'on 2026-08-15 — restore the rows. If this branch is abandoning an id it declared and never merged, that is the good path: ' +
        'npm run docs:ids -- --abandon <ID> --to <NEW-ID> --reason "<sentence>"')
  }

  // --- A5: a burnt number came back. Read at DECLARATION SITES only, never in
  // prose: a burnt id must stay quotable, because the RCA and the ADR that
  // explain why it is burnt necessarily name it. Re-declaring it is the offence;
  // writing its history down is the remedy.
  const resurrection = []
  for (const [id, d] of declared) {
    if (pinned[id]?.status === 'burnt') {
      resurrection.push(`${id} is burnt${pinned[id].retired_to ? ` (renumbered to ${pinned[id].retired_to})` : ''} but declared again in ${d.source}`)
    }
  }
  if (burntFamilies.length) {
    const burntRow = new RegExp(`^(?:\\|\\s*|\\*\\*)((?:${burntFamilies.map(escapeRe).join('|')})-\\d{3})\\b`, 'm')
    for (const reg of registries) {
      if (!reg.file) continue
      const body = readDoc(reg.file)
      const m = body && burntRow.exec(body)
      if (m) resurrection.push(`${m[1]} belongs to a burnt family but is declared in ${reg.file}`)
    }
  }
  if (resurrection.length) {
    emit('critical', `${resurrection.length} burnt id(s) re-declared`, resurrection.sort().join(' · '), [ledgerPath],
      'A dropped id is never recycled (AGENTS.md §18) — mark it superseded and leave the number burnt. Take the next free number instead')
  }

  // --- A6: a recorded move or retirement must carry its justification where a
  // human reads it. This mechanizes the one time a renumber was handled
  // completely here: PRD version-history row 1.79.0b states it in prose — "…both
  // were taken by the market-translation slice that merged first, and an id is a
  // key (AGENTS.md §18), so the later declaration renumbers". Rows 99 and 100,
  // the FR-074/FR-075 renumber, say nothing of the kind, and seven stale
  // citations from that renumber survive on main today.
  //
  // Scope, and why it is exactly this: any entry whose history has more than one
  // line (something was recorded about it), plus any entry that reads as retired
  // or burnt — including a status flipped by hand, which is the case the first
  // cut let through by skipping every superseded entry with a single history
  // line. The one exemption is a retirement that PREDATES the ledger: the
  // genesis pass marks those `pre_ledger`, because their rationale is in the
  // registry row a human already reads and there is no revision row to point at.
  const unjustified = []
  for (const [id, e] of Object.entries(pinned)) {
    const history = e.history || []
    const last = lastOf(e)
    const recorded = history.length > 1
    const retired = e.status === 'superseded' || e.status === 'burnt'
    if (!recorded && !retired) continue
    if (!recorded && retired && last?.pre_ledger) continue
    const reason = (last?.bulk && bulkById.get(last.bulk)?.reason) || last?.reason || e.reason || ''
    if (reason.trim().length < MIN_REASON) {
      unjustified.push(`${id}: the move is recorded with no explanation ("${reason.trim()}")`)
      continue
    }
    if (!registryOf(e.family)?.has_version_history) continue
    // A rewording keeps the subject's head word; it is not a move and owes no
    // revision row. The claim is verified here rather than trusted: a "reword"
    // whose head word changed is a move, and falls through to the check below.
    const previous = history.length > 1 ? history[history.length - 2].anchor : null
    if (last?.kind === 'reword' && previous && headToken(previous) === headToken(last.anchor)) continue
    const pointer = last?.declared_in || e.declared_in || ''
    const [doc, version] = pointer.split('#')
    if (!doc || !version) {
      unjustified.push(`${id}: no declared_in "<doc>#<version>" pointing at the revision row that states this move`)
      continue
    }
    const body = readDoc(doc)
    const row = (body || '').split('\n').find((l) => new RegExp(`^\\|\\s*${escapeRe(version)}\\s*\\|`).test(l))
    if (!row) {
      unjustified.push(`${id}: declared_in ${pointer} names no revision row in that document`)
      continue
    }
    // The row has to be ABOUT this id. Without this, a move could be declared
    // green against any pre-existing revision row — the arm's whole purpose is
    // that a human reading the registry finds the move written down, and a row
    // about unrelated requirements records nothing.
    if (!new RegExp(`(?<![A-Za-z0-9-])${escapeRe(id)}(?![0-9])`).test(row)) {
      unjustified.push(`${id}: revision row ${version} in ${doc} does not mention ${id}, so it records nothing about this move`)
    }
  }
  if (unjustified.length) {
    emit('critical', `${unjustified.length} recorded id move(s) are not justified`, unjustified.sort().join(' · '), [ledgerPath],
      'A move that only a JSON file knows about is a move nobody reviewed. Give it a reason of at least 40 characters and — for the PRD ' +
        'registry — a version-history row that names the id and says what moved and why, then point declared_in at that row')
  }

  // --- A7: ledger and registry must agree about what is still live, in both
  // directions. A retirement the ledger has not heard about is how a superseded
  // row quietly keeps counting as evidence. The registry side of this reads a
  // struck-through statement or a status cell that OPENS with a retirement word,
  // never the word loose in prose — see tableStatus in scripts/id-anchors.mjs for
  // why that narrowness is the whole rule.
  const mismatch = []
  for (const [id, d] of declared) {
    const e = pinned[id]
    if (!e) continue
    if (d.status === 'superseded' && e.status !== 'superseded' && e.status !== 'burnt') {
      mismatch.push(`${id} reads as retired in ${d.source} but is "${e.status}" in the ledger`)
    }
    if (e.status === 'superseded' && d.status !== 'superseded') {
      mismatch.push(`${id} is superseded in the ledger but its row in ${d.source} still reads as live`)
    }
  }
  if (mismatch.length) {
    emit('critical', `${mismatch.length} id(s) disagree with the ledger about being retired`, mismatch.sort().join(' · '), [ledgerPath],
      'Record the retirement: npm run docs:ids -- --supersede <ID> --reason "<sentence>". The registry a human reads is the source; the ' +
        'ledger follows it, never the other way round')
  }

  // --- A8: a file named for an id that cites its family but never itself. This
  // is the residue a careful renumber leaves behind — af0a6f0d1 rewrote 102
  // references across 37 files and still had to rename 8 test files and 4
  // documents by hand. Needs no ledger and no baseline: verified standing at zero
  // offenders on the day it was written, so it ships with its ground held.
  const NAMED = /(FR|NFR|BR|SEC|SDD|FEAT)-?(\d{3})(?![0-9])/i
  const CITED = /\b(FR|NFR|BR|SEC|SDD|FEAT)-(\d{3})\b/g
  const misnamed = []
  for (const f of namedFiles) {
    const m = NAMED.exec(f.path.slice(f.path.lastIndexOf('/') + 1))
    if (!m) continue
    const own = `${m[1].toUpperCase()}-${m[2]}`
    const cited = new Set((f.body.match(CITED) || []).map((s) => s.toUpperCase()))
    if (cited.has(own)) continue
    const sameFamily = [...cited].filter((c) => c.startsWith(`${m[1].toUpperCase()}-`))
    if (sameFamily.length) misnamed.push({ path: f.path, text: `${f.path} is named for ${own} but cites ${sameFamily.sort().join(', ')}` })
  }
  if (misnamed.length) {
    misnamed.sort((a, b) => a.path.localeCompare(b.path))
    emit('critical', `${misnamed.length} file(s) are named for one id and cite another`, misnamed.map((o) => o.text).join(' · '),
      misnamed.map((o) => o.path),
      'Either an annotation was swept during a renumber and the filename was not, or the reverse. Ids are keys — make the name and the ' +
        'citation agree, and rename the file if the id genuinely moved')
  }

  // Health line, never gating. Proves the check ran over every family rather than
  // degrading to zero, which is the failure mode a guard reading a missing
  // baseline would otherwise have. The roster count is here so a ledger that
  // shrank has a number to disagree with, not only a list.
  const byFamily = {}
  for (const e of Object.values(pinned)) byFamily[e.family] = (byFamily[e.family] || 0) + 1
  emit('info', `${Object.keys(pinned).length} id(s) pinned across ${Object.keys(byFamily).length} families`,
    `${Object.entries(byFamily).sort().map(([f, n]) => `${f} ${n}`).join(' · ') || 'no ids pinned'} · roster ${roster.length}`, [ledgerPath],
    'Each one is a key whose subject cannot move without saying so in the diff (AGENTS.md §18)')

  // A declaration that moved document is FREE — §18 says so in as many words — so
  // this is reported and never gated. Gating it would be the check contradicting
  // the contract it exists to enforce.
  const drifted = [...declared]
    .filter(([id, d]) => pinned[id] && pinned[id].source !== d.source)
    .map(([id, d]) => `${id}: ${pinned[id].source} → ${d.source}`)
  if (drifted.length) {
    emit('info', `${drifted.length} declaration(s) moved document`, drifted.sort().join(' · '), [ledgerPath],
      'Moving a document is free (AGENTS.md §18) — run npm run docs:ids -- --write to refresh the pointer')
  }

  return out
}
