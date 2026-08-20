#!/usr/bin/env node
// The only writer of docs/.id-ledger.json. Preflight only ever reads it.
//
// @spec docs/decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md
// @spec AGENTS.md §18 — ids are keys, not labels
// @tested tests/unit/id-anchor-stability.test.js
//
// This is NOT part of `npm run govern` and must never be. A writer inside the
// gate is a gate that silences itself: the run that detects the drift would also
// erase the evidence of it. `govern` reads the ledger; a human runs this.
//
// Usage:
//   node scripts/id-ledger.mjs --write
//       Pin every newly declared id. Add-only: it REFUSES to rewrite an anchor
//       that is already pinned, to re-pin an id whose entry was deleted, and to
//       pin a new id that inherits a subject already recorded in its family.
//       This is the 97% case — one '+' block in the diff.
//
//   node scripts/id-ledger.mjs --reword <ID> --reason "<sentence>"
//       The statement was edited and still says what it said — the head of the
//       subject is unchanged. Recorded in one line, no revision row required,
//       and refused outright if the head word moved (that is a different id's
//       worth of change, and it goes through --declare). This exists because the
//       anchor is a 60-character window over a registry whose rows are edited on
//       most doc-touching PRs: without it, a hyphenation fix inside the window
//       had no honest remedy at all, and the only working path recorded the edit
//       as a forbidden move.
//
//   node scripts/id-ledger.mjs --supersede <ID> --reason "<sentence>" [--declared-in <doc>#<version>]
//       Record a retirement. The anchor does not move — a retirement stops a
//       statement, it never hands its key to another one (the SEC-004 shape).
//
//   node scripts/id-ledger.mjs --abandon <ID> --to <NEW-ID> --reason "<sentence>"
//       This branch declared <ID>, main took the number first, and the branch is
//       renumbering ITSELF to <NEW-ID>. Main is the published trunk, so the later
//       declaration is the one that moves (the af0a6f0d1 and FR-093/SDD-051
//       precedent). The abandoned number stays burnt. Cheapest of the non-trivial
//       paths on purpose: this is the behaviour the repository wants.
//
//   node scripts/id-ledger.mjs --distinct <ID> --reason "<sentence>"
//       <ID> is genuinely NEW and its statement happens to open with the same
//       words as a sibling already pinned in its family — the normal shape when a
//       requirement is split into slices. Pins it with the sentence recorded in
//       the entry, so the one thing that could have been a renumber is not waved
//       through by a command that records nothing.
//
//   node scripts/id-ledger.mjs --declare <ID> --reason "<sentence>" [--declared-in <doc>#<version>]
//       The move AGENTS.md §18 forbids, done anyway. Requires the id on the
//       command line and a reason of at least 40 characters; prints the old and
//       new anchor before writing. There is deliberately no bulk --force, so a
//       subject replacement cannot be swept into a batch regeneration by someone
//       who was only fixing a typo elsewhere.
//
//   node scripts/id-ledger.mjs --bulk <draft registry path> --reason "<sentence>"
//       Whole-file revision of a DRAFT registry (the Market Intelligence SRS
//       renumber will happen again). One conspicuous block naming every id whose
//       anchor moved, with one shared reason — visibility survives, the paperwork
//       does not swamp it. Refused for any registry not marked draft.

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCanonical as read } from './canonical-text.mjs'
import { collectDeclared, sameAnchor, REGISTRIES, BURNT_FAMILIES, NOT_IDS } from './id-anchors.mjs'
import { inheritedFrom } from './id-stability.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(ROOT, 'docs', '.id-ledger.json')
const TODAY = new Date().toISOString().slice(0, 10)

/** A reason short enough to be a shrug is not a reason. */
export const MIN_REASON = 40

const PURPOSE = [
  'Per-id subject anchors — the leading subject of each declared id\'s statement — and their history.',
  'An id is a key, not a label (AGENTS.md §18): documents may be moved, renamed, split or merged; ids may not be',
  'renumbered, reused for a different statement, or recycled after a requirement is dropped.',
  'Preflight raises a CRITICAL when a recorded anchor moves, when a new id inherits an anchor already recorded for',
  'another id in its family, when a recorded id disappears from its registry, when an entry that was once pinned is',
  'no longer here, or when a burnt id is re-declared.',
  'This file records anchors, never statements: rewording past the anchor window is free and leaves no diff here.',
  'Adding an id is routine — a "+" block. A "-" line on an id that already existed is the alarm, and so is a new',
  'history line under an id that already had one; neither may be committed without a sentence saying what changed and why.',
  '`roster` lists every id ever pinned and is never pruned: an id in `roster` with no entry in `ids` means an entry was',
  'deleted, which is the one way a repurpose could otherwise be re-landed as a routine "+" block.',
  'Never hand-edit an anchor to make the build green: the legitimate way to change what a number means is to NOT',
  'change it — retire it, leave it burnt, and take the next free number.',
  'Recorded after SDD-049 was repurposed by PR #88 on 2026-08-20 and FR-051/SDD-026 by PR #9 on 2026-08-15, both',
  'invisible to every check because a MOVED id is never a duplicate. See ADR-039.',
].join(' ')

// A first pin needs no justification — declaring an id is the routine act this
// ledger exists to make cheap. Only a MOVE has to explain itself (A6).
const DECLARED_REASON = 'declared'
// …with one exception: an id that already reads as retired when it is first
// pinned. Its retirement predates the ledger, so there is no revision row to
// point at and no author to ask — but A6 asks every retired entry for a reason,
// and "declared" is not one. Recorded explicitly, and marked, so that a status
// flipped to superseded BY HAND later cannot inherit the same exemption.
const preLedgerReason = (source) =>
  `Already retired in ${source} when this ledger was created; the retirement predates the ledger and its rationale lives in that row.`

const GENESIS_NOTE =
  'Every entry whose only history line is "declared" was pinned in one pass when this ledger was created ' +
  '(recorded_at). It records what the id stands for today, not when it was first written — anything earlier ' +
  'than that line predates the ledger and lives only in git history.'

function scaffold() {
  return {
    version: '1.1.0',
    purpose: PURPOSE,
    recorded_at: TODAY,
    genesis_note: GENESIS_NOTE,
    generated_by: 'scripts/id-ledger.mjs',
    registries: REGISTRIES.map((r) => ({
      families: r.families,
      ...(r.file ? { file: r.file } : { dir: r.dir }),
      form: r.form,
      has_version_history: r.has_version_history,
      ...(r.draft ? { draft: true } : {}),
    })),
    not_ids: NOT_IDS,
    burnt_families: BURNT_FAMILIES,
    bulk_revisions: [],
    roster: [],
    ids: {},
  }
}

export function loadLedger() {
  return existsSync(LEDGER) ? JSON.parse(read(LEDGER)) : scaffold()
}

/** The anchor an id currently stands for: the last thing appended, nothing else. */
export function currentAnchor(entry) {
  return entry && entry.history && entry.history.length ? entry.history[entry.history.length - 1].anchor : null
}

const familyRank = (family) => {
  const i = REGISTRIES.findIndex((r) => r.families.includes(family))
  return i < 0 ? REGISTRIES.length : i
}
const idNumber = (id) => Number(id.slice(id.lastIndexOf('-') + 1))
const familyOf = (id) => id.slice(0, id.lastIndexOf('-'))

/** Deterministic order: registry order, then numeric — so a diff is readable. */
function sortIds(ids) {
  const out = {}
  for (const key of Object.keys(ids).sort((a, b) => {
    const fa = ids[a].family
    const fb = ids[b].family
    return familyRank(fa) - familyRank(fb) || fa.localeCompare(fb) || idNumber(a) - idNumber(b)
  })) out[key] = ids[key]
  return out
}

const sortRoster = (roster) =>
  [...new Set(roster)].sort((a, b) => {
    const [fa, fb] = [familyOf(a), familyOf(b)]
    return familyRank(fa) - familyRank(fb) || fa.localeCompare(fb) || idNumber(a) - idNumber(b)
  })

function save(led) {
  led.purpose = PURPOSE
  led.genesis_note = GENESIS_NOTE
  led.registries = scaffold().registries
  led.not_ids = NOT_IDS
  led.burnt_families = BURNT_FAMILIES
  led.roster = sortRoster(led.roster || [])
  led.ids = sortIds(led.ids)
  writeFileSync(LEDGER, JSON.stringify(led, null, 2) + '\n')
}

function fail(message) {
  console.error(`id-ledger: ${message}`)
  process.exit(1)
}

function requireReason(reason) {
  if (!reason) fail('--reason is required. Say what moved and why; this sentence is read for the life of the project.')
  if (reason.trim().length < MIN_REASON) fail(`--reason must be at least ${MIN_REASON} characters. "${reason}" is not an explanation.`)
  return reason.trim()
}

const headToken = (a) => String(a || '').split(' ')[0]

/**
 * Add-only pass. Pins new ids and refreshes the metadata AGENTS.md §18 declares
 * free to change (which document a declaration lives in). It never touches an
 * anchor: an anchor moves only through a flag that names the id out loud.
 *
 * Three refusals, each closing a path by which this command could have made an
 * incident look routine:
 *   · an anchor that already stands for something else  (--reword / --declare)
 *   · an id in `roster` whose entry is gone             (restore it from git)
 *   · a new id inheriting a sibling's subject           (--abandon / --distinct)
 */
function writeNew(led, declared, { allowMoved = new Set(), allowDistinct = new Set() } = {}) {
  const added = []
  const moved = []
  const resurrected = []
  const inheriting = []
  const roster = new Set(led.roster || [])
  const inherited = inheritedFrom(declared, led.ids)
  for (const [id, d] of declared) {
    const entry = led.ids[id]
    if (!entry) {
      if (roster.has(id)) {
        resurrected.push(id)
        continue
      }
      if (inherited.has(id) && !allowDistinct.has(id)) {
        inheriting.push([id, inherited.get(id)])
        continue
      }
      const retiredAlready = d.status !== 'current'
      led.ids[id] = {
        family: d.family,
        source: d.source,
        status: d.status,
        ...(retiredAlready ? { retired_at: TODAY } : {}),
        history: [
          {
            anchor: d.anchor,
            since: TODAY,
            reason: retiredAlready ? preLedgerReason(d.source) : DECLARED_REASON,
            ...(retiredAlready ? { pre_ledger: true } : {}),
          },
        ],
      }
      roster.add(id)
      added.push(id)
      continue
    }
    roster.add(id)
    // A document move is free (AGENTS.md §18), so `source` is refreshed silently.
    entry.source = d.source
    entry.family = d.family
    // sameAnchor, not equality: the pinned anchor stays put when the statement
    // only grew a clause past the cap, so the ledger does not churn on rewording.
    if (!sameAnchor(currentAnchor(entry), d.anchor) && !allowMoved.has(id)) moved.push(id)
  }
  led.roster = [...roster]
  return { added, moved, resurrected, inheriting }
}

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const led = loadLedger()
const declared = collectDeclared(ROOT)

// ---- --declare / --reword / --supersede / --abandon / --distinct / --bulk ---
const declareId = flag('--declare')
const rewordId = flag('--reword')
const supersedeId = flag('--supersede')
const abandonId = flag('--abandon')
const distinctId = flag('--distinct')
const bulkFile = flag('--bulk')
const declaredIn = flag('--declared-in')
const allowMoved = new Set()
const allowDistinct = new Set()

function needVersionPointer(entry) {
  const reg = REGISTRIES.find((r) => r.families.includes(entry.family))
  return Boolean(reg && reg.has_version_history)
}

if (declareId) {
  const d = declared.get(declareId)
  if (!d) fail(`${declareId} is not declared anywhere in the tree — nothing to move.`)
  const entry = led.ids[declareId]
  if (!entry) fail(`${declareId} is not pinned yet. Run --write; a first declaration is not a move.`)
  const reason = requireReason(flag('--reason'))
  const before = currentAnchor(entry)
  if (before === d.anchor) fail(`${declareId} still stands for "${before}". Nothing moved; do not record a move that did not happen.`)
  console.log(`id-ledger: ${declareId}`)
  console.log(`  was: "${before}"`)
  console.log(`  now: "${d.anchor}"`)
  console.log('  This is the move AGENTS.md §18 forbids. It is being recorded, not endorsed.')
  entry.history.push({ anchor: d.anchor, since: TODAY, reason, ...(declaredIn ? { declared_in: declaredIn } : {}) })
  if (declaredIn) entry.declared_in = declaredIn
  else if (needVersionPointer(entry)) fail(`${declareId} lives in a registry with a version history — pass --declared-in <doc>#<version> naming the revision row that states this move.`)
  entry.status = d.status
  allowMoved.add(declareId)
}

if (rewordId) {
  const d = declared.get(rewordId)
  if (!d) fail(`${rewordId} is not declared anywhere in the tree — there is no statement to reword.`)
  const entry = led.ids[rewordId]
  if (!entry) fail(`${rewordId} is not pinned yet. Run --write; a first declaration is not a reword.`)
  const before = currentAnchor(entry)
  if (sameAnchor(before, d.anchor)) fail(`${rewordId} still stands for "${before}". Nothing to record — rewording past the anchor window is free.`)
  const reason = requireReason(flag('--reason'))
  // The head word is the load-bearing test, and it is the reason this path can
  // be cheap: "soft delete" → "soft-delete" keeps it, "market translation" →
  // "outbound reply delivery receipts" does not. A reword that moves the head is
  // a repurpose wearing a smaller word, and it goes through --declare.
  if (headToken(before) !== headToken(d.anchor)) {
    fail(
      `${rewordId} does not read as a rewording: the subject now starts with a different word ("${headToken(before)}" → "${headToken(d.anchor)}").\n` +
        `  was: "${before}"\n  now: "${d.anchor}"\n` +
        '  If the statement genuinely still says what it said, edit it so its opening survives. If the number now means something else, ' +
        'that is --declare, and it costs a revision row a human can read.',
    )
  }
  console.log(`id-ledger: ${rewordId} reworded`)
  console.log(`  was: "${before}"`)
  console.log(`  now: "${d.anchor}"`)
  entry.history.push({ anchor: d.anchor, since: TODAY, reason, kind: 'reword', ...(declaredIn ? { declared_in: declaredIn } : {}) })
  entry.status = d.status
  allowMoved.add(rewordId)
}

if (supersedeId) {
  const entry = led.ids[supersedeId]
  if (!entry) fail(`${supersedeId} is not pinned. Run --write first.`)
  const reason = requireReason(flag('--reason'))
  const d = declared.get(supersedeId)
  // The anchor is repeated, not changed. That is what supersede MEANS here: the
  // statement stops being true, the number stays burnt, and nothing inherits it.
  entry.history.push({ anchor: currentAnchor(entry), since: TODAY, reason, ...(declaredIn ? { declared_in: declaredIn } : {}) })
  entry.status = 'superseded'
  entry.retired_at = TODAY
  if (declaredIn) entry.declared_in = declaredIn
  else if (needVersionPointer(entry)) fail(`${supersedeId} lives in a registry with a version history — pass --declared-in <doc>#<version>.`)
  if (d && d.status !== 'superseded') {
    fail(`${supersedeId} is not marked retired in ${d.source}. Strike the statement through or say "superseded" in its status cell first — the registry a human reads is the source, not this file.`)
  }
  allowMoved.add(supersedeId)
}

if (abandonId) {
  const to = flag('--to')
  if (!to) fail('--abandon needs --to <NEW-ID>: say which number this branch renumbered itself to.')
  const entry = led.ids[abandonId]
  if (!entry) fail(`${abandonId} is not pinned; there is nothing to abandon.`)
  if (declared.has(abandonId)) fail(`${abandonId} is still declared in ${declared.get(abandonId).source}. Remove the declaration first — an abandoned id is one no registry claims.`)
  const reason = requireReason(flag('--reason'))
  entry.status = 'burnt'
  entry.retired_to = to
  entry.retired_at = TODAY
  entry.reason = reason
  entry.history.push({ anchor: currentAnchor(entry), since: TODAY, reason: `Abandoned before merge; this branch renumbered itself to ${to}. ${reason}` })
}

if (distinctId) {
  const d = declared.get(distinctId)
  if (!d) fail(`${distinctId} is not declared anywhere in the tree — there is nothing to pin.`)
  if (led.ids[distinctId]) fail(`${distinctId} is already pinned. --distinct only ever pins a NEW id.`)
  const inherited = inheritedFrom(declared, led.ids)
  const from = inherited.get(distinctId)
  if (!from) fail(`${distinctId} does not share its subject with any pinned id in its family. Plain --write pins it; no sentence is owed.`)
  const reason = requireReason(flag('--reason'))
  console.log(`id-ledger: ${distinctId} shares the subject recorded for ${from} — "${d.anchor}"`)
  console.log('  Pinned as a genuinely new statement, with your sentence recorded against it.')
  led.ids[distinctId] = {
    family: d.family,
    source: d.source,
    status: d.status,
    distinct_from: from,
    history: [{ anchor: d.anchor, since: TODAY, reason, kind: 'distinct' }],
  }
  ;(led.roster ||= []).push(distinctId)
  allowDistinct.add(distinctId)
}

if (bulkFile) {
  const normalized = bulkFile.split(path.sep).join('/').replace(/^\.\//, '')
  const reg = REGISTRIES.find((r) => r.file === normalized)
  if (!reg) fail(`${normalized} is not a registry this ledger knows.`)
  if (!reg.draft) fail(`${normalized} is not a draft registry. A settled registry's ids move one at a time, named out loud, via --declare.`)
  const reason = requireReason(flag('--reason'))
  const bulkKey = `BULK-${String((led.bulk_revisions || []).length + 1).padStart(3, '0')}`
  const movedIds = []
  for (const [id, d] of declared) {
    if (d.source !== normalized) continue
    const entry = led.ids[id]
    if (!entry || currentAnchor(entry) === d.anchor) continue
    entry.history.push({ anchor: d.anchor, since: TODAY, bulk: bulkKey })
    movedIds.push(id)
    allowMoved.add(id)
  }
  if (!movedIds.length) fail(`No anchor in ${normalized} moved. Nothing to record.`)
  ;(led.bulk_revisions ||= []).push({ id: bulkKey, file: normalized, at: TODAY, reason, ids: movedIds })
  console.log(`id-ledger: ${bulkKey} records ${movedIds.length} moved anchor(s) in ${normalized}`)
}

// A registry this run could not read means the declared set is incomplete, and
// every arm below reasons about what is missing. Refuse rather than record a
// half-scan: --write would otherwise be the command that deletes nothing and
// still leaves the ledger describing a tree that does not exist.
if (declared.missing.length) {
  fail(
    `these registries could not be read: ${declared.missing.map((m) => m.recorded_at).join(', ')}. ` +
      'Restore them, or update REGISTRIES in scripts/id-anchors.mjs if a registry genuinely moved out of docs/. ' +
      'Nothing is written while part of the tree is unreadable.',
  )
}

// ---- the add-only pass always runs, so the ledger cannot fall behind -------
const { added, moved, resurrected, inheriting } = writeNew(led, declared, { allowMoved, allowDistinct })
if (moved.length) {
  console.error('id-ledger: these ids already stand for a different subject than the tree now declares:')
  for (const id of moved) {
    console.error(`  ${id}`)
    console.error(`    pinned:   "${currentAnchor(led.ids[id])}"`)
    console.error(`    declared: "${declared.get(id).anchor}"`)
  }
  fail(
    'An anchor is never rewritten by --write. If the statement was edited and still says what it said, that is ' +
      '--reword <ID> --reason "<sentence>" — one line, no revision row. If this is a collision, the LATER declaration ' +
      'renumbers itself — main is the published trunk. If the subject stopped being true, retire it with --supersede and ' +
      'take the next free number. Only if the number must come to mean something else: --declare <ID> --reason "<sentence>".',
  )
}
if (resurrected.length) {
  console.error('id-ledger: these ids are in `roster` — they were pinned once — but their entries are gone:')
  for (const id of resurrected) console.error(`  ${id}${declared.has(id) ? ` (declared in ${declared.get(id).source} as "${declared.get(id).anchor}")` : ''}`)
  fail(
    'An entry never leaves this ledger (ADR-039 D9). Restore it — git show HEAD:docs/.id-ledger.json — and commit that restoration ' +
      'as its own change. Re-pinning a deleted entry is indistinguishable from declaring a new id, which is exactly how the SDD-049 ' +
      'repurpose could be re-landed as a routine "+" block with no deleted line anywhere in the diff.',
  )
}
if (inheriting.length) {
  console.error('id-ledger: these new ids hold a subject already recorded for another id in their family:')
  for (const [id, from] of inheriting) console.error(`  ${id} ← ${from} — "${currentAnchor(led.ids[from])}"`)
  fail(
    'A new id holding an existing subject is a renumber (AGENTS.md §18). If they collided, the LATER declaration renumbers itself: ' +
      '--abandon <ID> --to <NEW-ID> --reason "<sentence>". If the new id is genuinely a different statement that opens with the same ' +
      'words — a requirement split into slices — say so once: --distinct <ID> --reason "<sentence>".',
  )
}

save(led)
console.log(`id-ledger: ${Object.keys(led.ids).length} id(s) pinned · ${added.length} added · roster ${led.roster.length}`)
if (added.length) console.log(`  + ${added.join(', ')}`)
