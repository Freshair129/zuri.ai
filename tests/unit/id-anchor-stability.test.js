import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchor, sameAnchor, identicalAnchor, collectDeclared, REGISTRIES } from '../../scripts/id-anchors.mjs'
import { evaluateIdStability, inheritedFrom } from '../../scripts/id-stability.mjs'
import { readCanonical } from '../../scripts/canonical-text.mjs'

// @spec docs/decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md
// @spec AGENTS.md §18 — an id is a key: never renumbered, never reused for a
//   different statement, never recycled after a requirement is dropped.
// @spec .brain/rca/2026-08-20-an-id-moved-and-nothing-noticed.md
//
// The centrepiece is `the real SDD 049 incident` below. On 2026-08-20 PR #88
// resolved its own id collision by renumbering that id — already merged to main
// — to the next number and taking its slot for itself. Every check stayed green,
// because preflight's duplicate-id guard catches two rows sharing a key and a
// MOVED id is never a duplicate at any single moment. If that test ever passes
// without firing, the guard has been defeated and the incident can happen again.
//
// WHY EVERY ID IN THIS FILE IS BUILT AND NEVER SPELLED. scripts/doc-graph.mjs
// turns any requirement-id-shaped token appearing anywhere inside a test file
// into a `verifies` edge (ID_LIST at doc-graph.mjs:117, applied at :311). This
// file uses real ids as FIXTURE DATA — it exercises none of those requirements —
// so spelling them literally credited it, in docs/appendices/D-traceability.md
// and docs/TRACE.md, as the test for eighteen requirements it does not touch,
// including one planned FR that had no test at all. A governance view that
// reports coverage nobody wrote is the exact failure this whole change exists to
// stop, so ids here are assembled at runtime and named in prose without their
// dash: "SDD 049", never the token.
const rid = (family, n) => `${family}-${n}`
const SDD = (n) => rid('SDD', n)
const FR = (n) => rid('FR', n)
const SEC = (n) => rid('SEC', n)
const FEAT = (n) => rid('FEAT', n)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LEDGER_PATH = path.join(ROOT, 'docs', '.id-ledger.json')
const PRD = 'docs/PRD-SDD-v1.0.md'

/** Build a `declared` map the way collectDeclared() does, from id → statement. */
const declare = (rows) => {
  const map = new Map(
    Object.entries(rows).map(([id, spec]) => {
      const { statement, family = id.slice(0, id.lastIndexOf('-')), source = PRD, status = 'current' } = typeof spec === 'string' ? { statement: spec } : spec
      return [id, { id, family, source, statement, anchor: anchor(statement), status }]
    }),
  )
  map.duplicates = []
  map.missing = []
  return map
}

/** Build a ledger the way scripts/id-ledger.mjs writes one. */
const pin = (rows) => ({
  roster: Object.keys(rows),
  ids: Object.fromEntries(
    Object.entries(rows).map(([id, spec]) => {
      const { statement, family = id.slice(0, id.lastIndexOf('-')), source = PRD, status = 'current', history, ...rest } = typeof spec === 'string' ? { statement: spec } : spec
      return [id, { family, source, status, ...rest, history: history || [{ anchor: anchor(statement), since: '2026-08-20', reason: 'declared' }] }]
    }),
  ),
})

const criticals = (findings) => findings.filter((f) => f.severity === 'critical')
const titles = (findings) => criticals(findings).map((f) => f.title)

// The two statements at the heart of the incident, quoted from the registry as
// each stood on the day it moved.
const CONVERSATION_READER =
  'The conversation reader is one composed read model (`src/modules/crm/conversation-read-model.js`) behind two routes, and it holds no write path at all'
const MARKET_TRANSLATION =
  'Market translation is a ports-and-adapters seam: a Market-specific explicit Business scope constructs the Integration raw read port; the translator produces a strict MarketObservation domain draft'

describe('the real SDD 049 incident (regression)', () => {
  // fdffad7a9 declared that id = the conversation reader and merged.
  const beforePR88 = pin({ [SDD('049')]: CONVERSATION_READER })

  it('fires when an already-merged id is repurposed', () => {
    // 1136863cb replaced that row's subject with the market-translation seam.
    const findings = evaluateIdStability({
      declared: declare({ [SDD('049')]: MARKET_TRANSLATION }),
      ledger: beforePR88,
    })
    const moved = criticals(findings).filter((f) => f.title.startsWith(`${SDD('049')} changed subject`))
    expect(moved).toHaveLength(1)
    expect(moved[0].details).toContain('the conversation reader')
    expect(moved[0].details).toContain('market translation')
    expect(moved[0].action).toContain('AGENTS.md §18')
  })

  it('names the destination the displaced statement moved to', () => {
    // The same commit created the next number holding the verbatim displaced
    // statement. Without this arm a reviewer reads "changed subject" and has to
    // work out for themselves where the conversation reader went.
    const findings = evaluateIdStability({
      declared: declare({ [SDD('049')]: MARKET_TRANSLATION, [SDD('050')]: CONVERSATION_READER }),
      ledger: beforePR88,
    })
    expect(titles(findings)).toContain(`${SDD('050')} inherits the subject recorded for ${SDD('049')}`)
    expect(titles(findings)).toContain(`${SDD('049')} changed subject without a declared move`)
  })

  it('reports the files still citing the moved id, which is where the damage is', () => {
    // The e2e inbox spec read that `@spec` for the whole window between 1136863cb
    // and 0f10f1707. The registry row was never the damage; the annotation
    // pointing at a different subject was.
    const findings = evaluateIdStability({
      declared: declare({ [SDD('049')]: MARKET_TRANSLATION }),
      ledger: beforePR88,
      citersOf: (id) => (id === SDD('049') ? ['tests/e2e/fr091-conversation-inbox.spec.js'] : []),
    })
    expect(criticals(findings)[0].details).toContain('tests/e2e/fr091-conversation-inbox.spec.js')
  })

  it('stays silent on the correct resolution: the later declaration renumbers itself', () => {
    // 0f10f1707 is the good path — the numbers were taken by the slice that
    // merged first, so the branch renumbered ITSELF and main never saw a number
    // mean two things.
    const findings = evaluateIdStability({
      declared: declare({ [SDD('049')]: MARKET_TRANSLATION, [SDD('050')]: CONVERSATION_READER }),
      ledger: pin({ [SDD('049')]: MARKET_TRANSLATION, [SDD('050')]: CONVERSATION_READER }),
    })
    expect(criticals(findings)).toHaveLength(0)
  })

  it('cannot be laundered by deleting the ledger entry — the path that defeated the first cut', () => {
    // Adversarial verification found the design's central promise broken here:
    // one `delete j.ids[…]` turned the whole incident into a routine "unpinned
    // id" CRITICAL, and the remedy that CRITICAL printed re-pinned the NEW
    // subject with reason "declared" and exited 0, leaving a PR diff with no
    // deleted line in it at all. `roster` is what makes the deletion a fact.
    const ledger = pin({ [SDD('049')]: CONVERSATION_READER })
    delete ledger.ids[SDD('049')]
    const findings = evaluateIdStability({ declared: declare({ [SDD('049')]: MARKET_TRANSLATION }), ledger })
    expect(titles(findings)).toContain('1 id(s) were pinned and their ledger entry is gone')
    // and it must NOT be reported as the routine "just run --write" case
    expect(titles(findings).join(' ')).not.toContain('declared id(s) are not pinned')
  })
})

describe('the 2026-08-15 registry clobber (regression)', () => {
  // PR #9 merged a stale whole-file copy of the PRD over main: two ids
  // repurposed, fifteen deleted outright. A guard that only watches for
  // renumbering misses the deletion half, and the deletion half was the larger
  // event — for four days code annotated with those ids cited requirements that
  // no longer existed in the registry and every check stayed green.
  const ISOLATION = 'Production Supabase tenant isolation: SmartGift knowledge lives in private zuri_core'

  it('fires when a pinned id disappears from its registry', () => {
    const findings = evaluateIdStability({
      declared: declare({ [FR('051')]: ISOLATION }),
      ledger: pin({
        [FR('051')]: ISOLATION,
        [FR('052')]: 'Server-owned LINE scope binding: the webhook rejects client-selected Tenant/Business IDs',
      }),
    })
    const gone = criticals(findings).filter((f) => f.title.startsWith(`${FR('052')} is pinned`))
    expect(gone).toHaveLength(1)
    expect(gone[0].action).toContain('restore the rows')
  })

  it('fires on the repurpose half of the same commit', () => {
    const findings = evaluateIdStability({
      declared: declare({ [FR('051')]: 'Zuri-branded entry landing: `/` presents a full-viewport, responsive Zuri Heritage composition' }),
      ledger: pin({ [FR('051')]: ISOLATION }),
    })
    expect(titles(findings)).toContain(`${FR('051')} changed subject without a declared move`)
  })
})

describe('what must NOT fire — the edits this registry does constantly', () => {
  // Exact statement hashing was measured over the first-parent history of the
  // PRD: 23 fires, 6 true, 17 false. Every case below is one of the seventeen,
  // or one that adversarial verification added afterwards. A gate that cries
  // wolf three times in four is learned as a chore, and the chore has a
  // one-command bypass indistinguishable from its legitimate use.
  const unchanged = (before, after) =>
    evaluateIdStability({ declared: declare({ [FR('005')]: after }), ledger: pin({ [FR('005')]: before }) })

  it('an appended surface clause is free (125248d16)', () => {
    const before = 'Neutral work model: WorkContainer (ลำดับชั้น) + WorkItem (weight/value/probability/metrics)'
    const after = `${before}, browsed and status-edited at Development → All Work, both **global and project-scoped** (same view, different filter)`
    expect(criticals(unchanged(before, after))).toHaveLength(0)
  })

  it('a paragraph-scale expansion of an unchanged opening sentence is free (2c5533964)', () => {
    const opening =
      'Import authorization is decided **once, on the resolved target Workspace**, in the pipeline that resolves it — not in each of the three route handlers, which is how three copies of a predicate drift.'
    const findings = evaluateIdStability({
      declared: declare({ [SDD('037')]: `${opening} The rationale runs three paragraphs, none of which change the subject.` }),
      ledger: pin({ [SDD('037')]: opening }),
    })
    expect(criticals(findings)).toHaveLength(0)
  })

  it('a short bilingual row that grows past the anchor cap is free — this is what the prefix rule buys', () => {
    // 125248d16: the whole statement was shorter than the anchor cap, so
    // appending a clause moved what the cap truncated. Exact anchor equality
    // fired on this; the prefix clause is why it does not.
    const before = 'Dependencies + Gates (FS/SS/FF/SF, lag)'
    const after = `${before}, edited from the universal Dependencies view`
    expect(anchor(before)).not.toEqual(anchor(after))
    expect(sameAnchor(anchor(before), anchor(after))).toBe(true)
    expect(criticals(unchanged(before, after))).toHaveLength(0)
  })

  it('a hyphenation fix is free — punctuation is presentation, not subject', () => {
    // The first cut fired a CRITICAL on this one-character edit and offered three
    // remedies, every one of which recorded it as the move AGENTS.md §18 forbids.
    const before = 'Project CRUD + archive (soft delete) + mixed execution modes'
    const after = 'Project CRUD + archive (soft-delete) + mixed execution modes'
    expect(anchor(before)).toEqual(anchor(after))
    expect(criticals(unchanged(before, after))).toHaveLength(0)
  })

  it('widening a SHORT leading phrase is free — 100 of 340 anchors used to be excluded from any tolerance', () => {
    // The character-count threshold required BOTH anchors to be 24 characters,
    // so growing a two-word subject fired. The word-boundary prefix rule has no
    // such floor.
    expect(sameAnchor(anchor('Snapshot backup'), anchor('Snapshot backup and restore'))).toBe(true)
    expect(criticals(unchanged('Snapshot backup: export + import', 'Snapshot backup and restore: export + import'))).toHaveLength(0)
  })

  it('a retirement done the SEC 004 way costs nothing beyond what the contract already asks', () => {
    // The anchor does NOT move. That is what supersede means here: a retirement
    // stops a statement, it never hands its key to another one.
    const statement = '~~MVP ไม่มี Customer PII ในระบบ~~'
    const findings = evaluateIdStability({
      declared: declare({ [SEC('004')]: { statement, status: 'superseded' } }),
      ledger: pin({
        [SEC('004')]: {
          statement,
          status: 'superseded',
          declared_in: `${PRD}#1.72.0`,
          history: [
            { anchor: anchor(statement), since: '2026-08-20', reason: 'declared' },
            {
              anchor: anchor(statement),
              since: '2026-08-21',
              reason: 'Retired: the schema now carries Customer/Conversation/Message, so the rule became false. Number burnt per AGENTS.md §18.',
            },
          ],
        },
      }),
      readDoc: (p) => (p === PRD ? `| Version | Date |\n| 1.72.0 | 2026-08-18 | ${SEC('004')} retired |\n` : null),
    })
    expect(criticals(findings)).toHaveLength(0)
  })

  it('a branch that renumbers ITSELF is not charged for it', () => {
    // af0a6f0d1 and the FR 093 precedent: main is the published trunk, so the
    // later declaration moves. This is the behaviour the repository wants and the
    // guard must not tax it.
    const statement = 'Phase 1 LINE runtime connection cut-over: the runtime resolves one active primary connection'
    const findings = evaluateIdStability({
      declared: declare({ [FR('079')]: statement }),
      ledger: {
        roster: [FR('074')],
        ids: {
          [FR('074')]: {
            family: 'FR',
            source: PRD,
            status: 'burnt',
            retired_to: FR('079'),
            reason: 'Abandoned before merge; main took the number for scope-creation authorization first, so this branch renumbered itself.',
            history: [{ anchor: anchor(statement), since: '2026-08-18', reason: 'declared' }],
          },
        },
      },
    })
    // The new number is new and unpinned — that is the routine "+" block, not an
    // alarm about inheritance, and never a claim that the burnt id vanished.
    expect(titles(findings)).not.toContain(`${FR('079')} inherits the subject recorded for ${FR('074')}`)
    expect(titles(findings).join(' ')).not.toContain(`${FR('074')} is pinned but no longer declared`)
    expect(titles(findings)).toContain('1 declared id(s) are not pinned')
  })

  it('cross-family reuse of a subject is normal here and never fires', () => {
    // A FEAT is named after the FR it bundles and an ADR after the decision it
    // records: 7 of the 8 anchor pairs in the tree on the day this shipped were
    // exactly that. A renumber is always a move within one family.
    const statement = 'Business Home — shell-level cross-domain aggregation'
    const findings = evaluateIdStability({
      declared: declare({
        [FR('060')]: { statement, family: 'FR' },
        [FEAT('002')]: { statement, family: 'FEAT', source: 'docs/FEATURES.md' },
      }),
      ledger: pin({ [FR('060')]: { statement, family: 'FR' } }),
    })
    expect(titles(findings).join(' ')).not.toContain('inherits the subject')
  })

  it('a new sibling slice is not a renumber — the arm that names a destination uses STRICT equality', () => {
    // Splitting a requirement into slices is a normal edit here, and the tolerant
    // comparison called it a renumber, printed advice that could not clear it
    // ("the later declaration renumbers itself" — the collision is on subject,
    // not number), and was silenced instead by the no-ceremony writer command.
    const base = 'Schema declaration for the live production-auth tables'
    const findings = evaluateIdStability({
      declared: declare({ [FR('090')]: base, [FR('094')]: `${base} and their indexes, second slice` }),
      ledger: pin({ [FR('090')]: base }),
    })
    expect(titles(findings).join(' ')).not.toContain('inherits the subject')
  })
})

describe('a renumber destination is still named, and the way out of it is recorded', () => {
  it('fires when a new id holds an existing subject word for word', () => {
    const inherited = inheritedFrom(
      declare({ [SDD('049')]: MARKET_TRANSLATION, [SDD('050')]: CONVERSATION_READER }),
      pin({ [SDD('049')]: CONVERSATION_READER }).ids,
    )
    expect(inherited.get(SDD('050'))).toBe(SDD('049'))
  })

  it('names both ways out: renumber this branch, or say the subjects are genuinely different', () => {
    const findings = evaluateIdStability({
      declared: declare({ [SDD('049')]: MARKET_TRANSLATION, [SDD('050')]: CONVERSATION_READER }),
      ledger: pin({ [SDD('049')]: CONVERSATION_READER }),
    })
    const f = criticals(findings).find((x) => x.title.includes('inherits the subject'))
    expect(f.action).toContain('--abandon')
    expect(f.action).toContain('--distinct')
  })

  it('an id already pinned never fires again — --distinct is what pins it, and it records a sentence', () => {
    const findings = evaluateIdStability({
      declared: declare({ [SDD('049')]: MARKET_TRANSLATION, [SDD('050')]: CONVERSATION_READER }),
      ledger: pin({ [SDD('049')]: CONVERSATION_READER, [SDD('050')]: CONVERSATION_READER }),
    })
    expect(titles(findings).join(' ')).not.toContain('inherits the subject')
  })
})

describe('a second row for an id that already has one', () => {
  // doc-graph keeps the first row in file order and silently drops the rest, so a
  // second row carrying an unrelated statement was invisible to every check —
  // and WHICH statement survived depended on file order, which carries no
  // meaning. Preflight's duplicate-id guard reads document filenames only.
  it('fires, and says which statement the tree is actually using', () => {
    const declared = declare({ [SDD('049')]: MARKET_TRANSLATION })
    declared.duplicates = [
      { id: SDD('049'), source: PRD, statement: CONVERSATION_READER, anchor: anchor(CONVERSATION_READER), first: declared.get(SDD('049')) },
    ]
    const findings = evaluateIdStability({ declared, ledger: pin({ [SDD('049')]: MARKET_TRANSLATION }) })
    const f = criticals(findings).find((x) => x.title.includes('declared twice'))
    expect(f).toBeTruthy()
    expect(f.details).toContain('the row that counts says "market translation')
    expect(f.details).toContain('the dropped row says "the conversation reader')
  })
})

describe('a registry that is not where it is recorded', () => {
  // AGENTS.md §18 says moving a document is free, and this check's own INFO arm
  // says so too. The first cut hardcoded the paths, so `git mv` of the risk
  // matrix produced one CRITICAL per id claiming they had vanished, with an
  // action that could not apply.
  it('is one finding about the registry, not one per id, and it suppresses the vanished arm', () => {
    const declared = declare({})
    declared.missing = [{ families: ['RSK'], recorded_at: 'docs/appendices/E-risk-matrix.md' }]
    const findings = evaluateIdStability({
      declared,
      ledger: pin({ [rid('RSK', '001')]: { statement: 'Tenant placed wrongly at onboarding', family: 'RSK', source: 'docs/appendices/E-risk-matrix.md' } }),
    })
    expect(titles(findings)).toEqual(['the RSK registry is not readable'])
    expect(criticals(findings)[0].action).toContain('scripts/id-anchors.mjs')
  })
})

describe('burnt numbers stay burnt, and stay quotable', () => {
  it('fires when a burnt id is declared again', () => {
    const findings = evaluateIdStability({
      declared: declare({ [FR('074')]: 'Something else entirely' }),
      ledger: {
        roster: [FR('074')],
        ids: {
          [FR('074')]: {
            family: 'FR',
            source: PRD,
            status: 'burnt',
            retired_to: FR('079'),
            reason: 'Abandoned before merge; main took the number first, so this branch renumbered itself per AGENTS.md §18.',
            history: [{ anchor: 'phase 1 line runtime connection cut-over', since: '2026-08-18', reason: 'declared' }],
          },
        },
      },
    })
    expect(titles(findings)).toContain('1 burnt id(s) re-declared')
  })

  it('fires when a retired family reappears at a declaration site', () => {
    // FR-MI-xxx / DQ-MI-xxx were renamed wholesale to MI-RQ-xxx without
    // preserving slot meanings. The numbers stay burnt.
    const findings = evaluateIdStability({
      declared: declare({}),
      ledger: { ids: {}, burnt_families: ['FR-MI', 'DQ-MI'] },
      registries: [{ families: ['MI-RQ'], file: 'docs/domains/market-intelligence/SRS.md', form: 'bold-heading', has_version_history: false }],
      readDoc: () => '**FR-MI-010 — Source registry**\nThe system SHALL maintain a registry of configured Market Sources.\n',
    })
    expect(titles(findings)).toContain('1 burnt id(s) re-declared')
  })

  it('does NOT fire when a burnt id is merely named in prose', () => {
    // The RCA and the ADR that explain why a number is burnt necessarily name it.
    // Re-declaring it is the offence; writing its history down is the remedy — so
    // this arm reads declaration sites, never prose.
    const findings = evaluateIdStability({
      declared: declare({}),
      ledger: { ids: {}, burnt_families: ['FR-MI', 'DQ-MI'] },
      registries: [{ families: ['MI-RQ'], file: 'docs/domains/market-intelligence/SRS.md', form: 'bold-heading', has_version_history: false }],
      readDoc: () => 'The family shipped as FR-MI-010 "Source registry" and was renamed to MI-RQ-010, which is a different statement.\n',
    })
    expect(criticals(findings)).toHaveLength(0)
  })
})

describe('a declared move has to say what moved and why', () => {
  const movedEntry = (extra) => ({
    roster: [SDD('049')],
    ids: {
      [SDD('049')]: {
        family: 'SDD',
        source: PRD,
        status: 'current',
        history: [
          { anchor: anchor(CONVERSATION_READER), since: '2026-08-20', reason: 'declared' },
          { anchor: anchor(MARKET_TRANSLATION), since: '2026-08-21', ...extra },
        ],
      },
    },
  })
  const declaredNow = declare({ [SDD('049')]: MARKET_TRANSLATION })
  const REASON = 'PR #88 needed the number and took it from a statement that had already merged to main.'
  const prd =
    `| Version | Date | Author | Changes |\n` +
    `| 1.79.0b | 2026-08-20 | ATHER | ${SDD('049')} moved, and here is why |\n` +
    `| 1.70.0b | 2026-08-18 | ATHER | Something else entirely, about other requirements |\n`

  it('rejects a shrug', () => {
    const findings = evaluateIdStability({ declared: declaredNow, ledger: movedEntry({ reason: 'fixed' }), readDoc: () => prd })
    expect(titles(findings)).toContain('1 recorded id move(s) are not justified')
  })

  it('rejects a reason with no revision row a human would ever read', () => {
    const findings = evaluateIdStability({ declared: declaredNow, ledger: movedEntry({ reason: REASON }), readDoc: () => prd })
    expect(criticals(findings)[0].details).toContain('no declared_in')
  })

  it('rejects a declared_in pointing at a revision row that does not exist', () => {
    const findings = evaluateIdStability({
      declared: declaredNow,
      ledger: movedEntry({ reason: REASON, declared_in: `${PRD}#9.9.9` }),
      readDoc: () => prd,
    })
    expect(criticals(findings)[0].details).toContain('names no revision row')
  })

  it('rejects a declared_in pointing at a real row that says nothing about this id', () => {
    // The arm's stated purpose is that a human reading the registry finds the
    // move written down. Checking only that SOME row carried that version string
    // let a repurpose be declared green against a two-day-old row about entirely
    // different requirements, leaving the PRD with no record of the move at all.
    const findings = evaluateIdStability({
      declared: declaredNow,
      ledger: movedEntry({ reason: REASON, declared_in: `${PRD}#1.70.0b` }),
      readDoc: () => prd,
    })
    expect(criticals(findings)[0].details).toContain('does not mention')
  })

  it('accepts a move that carries both, and stops firing about the anchor', () => {
    const findings = evaluateIdStability({
      declared: declaredNow,
      ledger: movedEntry({ reason: `${REASON} Recorded, not endorsed.`, declared_in: `${PRD}#1.79.0b` }),
      readDoc: () => prd,
    })
    expect(criticals(findings)).toHaveLength(0)
  })

  it('asks a rewording for a sentence, and for nothing else', () => {
    // A reword keeps the head of the subject, so there is no move to write into
    // the version history — and demanding a revision row for a copy-edit is what
    // made the only working remedy libel the edit.
    const findings = evaluateIdStability({
      declared: declare({ [FR('005')]: 'Neutral universal work model: WorkContainer + WorkItem' }),
      ledger: {
        roster: [FR('005')],
        ids: {
          [FR('005')]: {
            family: 'FR',
            source: PRD,
            status: 'current',
            history: [
              { anchor: 'neutral work model', since: '2026-08-20', reason: 'declared' },
              { anchor: 'neutral universal work model', since: '2026-08-21', reason: 'Widened the label; the requirement itself is unchanged.', kind: 'reword' },
            ],
          },
        },
      },
      readDoc: () => prd,
    })
    expect(criticals(findings)).toHaveLength(0)
  })

  it('does not believe a "reword" whose subject starts with a different word', () => {
    const findings = evaluateIdStability({
      declared: declaredNow,
      ledger: movedEntry({ reason: `${REASON} Called a reword.`, kind: 'reword' }),
      readDoc: () => prd,
    })
    expect(titles(findings)).toContain('1 recorded id move(s) are not justified')
  })

  it('asks every retired entry for a reason, including a status flipped by hand', () => {
    // The first cut skipped any superseded entry whose history had one line, so
    // six retirements shipped with an eight-character reason and a hand-edited
    // status flip escaped justification entirely.
    const statement = 'Schema declaration for the live production-auth tables'
    const flipped = pin({ [FR('090')]: statement })
    flipped.ids[FR('090')].status = 'superseded'
    const findings = evaluateIdStability({
      declared: declare({ [FR('090')]: { statement, status: 'superseded' } }),
      ledger: flipped,
      readDoc: () => prd,
    })
    expect(titles(findings)).toContain('1 recorded id move(s) are not justified')
  })

  it('exempts a retirement that predates the ledger, because it is marked as one', () => {
    // The genesis pass records these explicitly (`pre_ledger`), so the exemption
    // is a fact in the file rather than a shape a hand edit can imitate.
    const statement = '~~MVP ไม่มี Customer PII ในระบบ~~'
    const genesis = pin({ [SEC('004')]: { statement, status: 'superseded' } })
    genesis.ids[SEC('004')].history = [
      { anchor: anchor(statement), since: '2026-08-20', reason: `Already retired in ${PRD} when this ledger was created; its rationale lives in that row.`, pre_ledger: true },
    ]
    const findings = evaluateIdStability({
      declared: declare({ [SEC('004')]: { statement, status: 'superseded' } }),
      ledger: genesis,
      readDoc: () => prd,
    })
    expect(criticals(findings)).toHaveLength(0)
  })
})

describe('the ledger and the registry must agree about what is live', () => {
  const PII = 'MVP ไม่มี Customer PII ในระบบ'

  it('fires when a row reads as retired but the ledger still calls it current', () => {
    const findings = evaluateIdStability({
      declared: declare({ [SEC('004')]: { statement: `~~${PII}~~`, status: 'superseded' } }),
      ledger: pin({ [SEC('004')]: `~~${PII}~~` }),
    })
    expect(titles(findings)).toContain('1 id(s) disagree with the ledger about being retired')
  })

  it('fires in the other direction too — a superseded pin over a live row', () => {
    const findings = evaluateIdStability({
      declared: declare({ [SEC('004')]: PII }),
      ledger: pin({ [SEC('004')]: { statement: PII, status: 'superseded' } }),
    })
    expect(titles(findings)).toContain('1 id(s) disagree with the ledger about being retired')
  })
})

describe('a file named for one id that cites another', () => {
  // The residue a careful renumber leaves behind: af0a6f0d1 rewrote 102
  // references across 37 files and still had to rename 8 test files by hand.
  it('fires', () => {
    const findings = evaluateIdStability({
      declared: declare({}),
      namedFiles: [{ path: 'tests/unit/fr074-runtime-cutover.test.js', body: `// @req ${FR('079')} — the Phase 1 runtime\n` }],
    })
    expect(titles(findings)).toContain('1 file(s) are named for one id and cite another')
  })

  it('stays silent when the name and the citation agree', () => {
    const findings = evaluateIdStability({
      declared: declare({}),
      namedFiles: [{ path: 'tests/unit/fr079-runtime-cutover.test.js', body: `// @req ${FR('079')} — the Phase 1 runtime\n` }],
    })
    expect(criticals(findings)).toHaveLength(0)
  })

  it('stays silent when a file names an id and cites nothing of that family', () => {
    const findings = evaluateIdStability({
      declared: declare({}),
      namedFiles: [{ path: 'tests/fixtures/fr052-binding-request-v1.json', body: '{"destination":"x"}' }],
    })
    expect(criticals(findings)).toHaveLength(0)
  })
})

describe('the anchor itself', () => {
  it('is the leading subject, not the whole statement', () => {
    expect(anchor('Market translation is a seam: the translator produces a draft')).toBe('market translation is a seam')
    expect(anchor('Business Home — shell-level cross-domain aggregation')).toBe('business home')
  })

  it('ignores markdown and punctuation, which are presentation and not subject', () => {
    expect(anchor('**Neutral** work model with `WorkItem`')).toBe(anchor('Neutral work model with WorkItem'))
    expect(anchor('~~MVP has no PII~~')).toBe('mvp has no pii')
    expect(anchor('Workstream CRUD (create, rename)')).toBe(anchor('Workstream CRUD  create; rename'))
  })

  it('caps at a length that is a subject, not a paragraph, and never mid-word', () => {
    expect(anchor('x'.repeat(200))).toHaveLength(60)
    const long = anchor('alpha beta gamma delta '.repeat(6))
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long).not.toMatch(/(?:alph|bet|gamm|delt)$/)
  })

  it('compares on word boundaries, so a half-word is never a prefix match', () => {
    expect(sameAnchor('scope selector', 'scope selectors and filters')).toBe(false)
    expect(sameAnchor('scope selector', 'scope selector and filters')).toBe(true)
  })

  it('treats a missing anchor as never matching', () => {
    expect(sameAnchor(null, 'anything')).toBe(false)
    expect(sameAnchor(null, null)).toBe(false)
    expect(identicalAnchor(null, null)).toBe(false)
  })
})

describe('every id family that has a declaration site is actually read', () => {
  const declared = collectDeclared(ROOT)

  it('covers all six registries, including the two nothing guarded before', () => {
    const families = new Set([...declared.values()].map((d) => d.family))
    // MI-RQ has never been guarded by anything; RSK, ADR and ZV2-CR are not in
    // the doc graph either. Shipping blind to a family is how this recurs.
    for (const f of ['FR', 'NFR', 'BR', 'SEC', 'SDD', 'FEAT', 'RSK', 'MI-RQ', 'ADR', 'ZV2-CR']) {
      expect(families, `family ${f} is not being read`).toContain(f)
    }
    expect(REGISTRIES.length).toBe(6)
  })

  it('reads every registry it records, and says so rather than reporting an empty scan', () => {
    expect(declared.missing).toEqual([])
  })

  it('finds no id declared twice in any registry', () => {
    expect(declared.duplicates).toEqual([])
  })

  it('never mistakes a version-history row or a traces-to citation for a declaration', () => {
    // The Version History table is `|`-delimited too and its rows are full of
    // requirement ids; the traces-to lists live in cells 3 and beyond.
    for (const [id] of declared) expect(id).toMatch(/^(FR|NFR|BR|SEC|SDD|FEAT|RSK|MI-RQ|ADR|ZV2-CR)-\d{3}$/)
    expect(declared.has('1.79.0b')).toBe(false)
    expect(declared.has(FR('999'))).toBe(false)
  })

  it('reads the two-column BR table and the one three-column row in it', () => {
    expect(declared.get(rid('BR', '001'))?.anchor).toBeTruthy()
    expect(declared.get(rid('BR', '019'))?.anchor).toBeTruthy()
  })

  it('treats a CR wave document as belonging to its CR, not as a second claim on it', () => {
    expect(declared.get('ZV2-CR-001')?.source).toBe('docs/changes/ZV2-CR-001-MANAGED-LOCAL-FILES-AND-CACHE.md')
  })

  it('reads an ADR title from its H1 wherever the frontmatter puts it', () => {
    // ADR-038 opens with YAML frontmatter; ADR-024 opens with its title.
    expect(declared.get('ADR-038')?.anchor).toContain('market intelligence')
    expect(declared.get('ADR-024')?.anchor).toContain('zuri ai is a standalone product')
  })

  it('reads a cell containing an escaped pipe without truncating it', () => {
    // `\|` is the correct markdown escape for a literal pipe. Splitting on it cut
    // the statement mid-token, fired a subject move, and the sanctioned repair
    // would have pinned the fragment for the life of the project.
    expect(anchor('Workstream CRUD (create \\| rename \\| archive)')).toBe(anchor('Workstream CRUD (create | rename | archive)'))
  })
})

describe('retirement is read from the row, not from prose that mentions retiring', () => {
  // The Mitigation column of the risk matrix is definitionally free prose about
  // what to do with legacy paths. Reading a retirement word anywhere in the
  // trailing cells made a live risk read as retired and offered a remedy that
  // would have written a false retirement into the ledger for good.
  const declared = collectDeclared(ROOT)

  it('reads the three genuine retirements in this tree', () => {
    for (const id of [rid('SDD', '001'), rid('SEC', '004'), rid('RSK', '006')]) {
      expect(declared.get(id).status, id).toBe('superseded')
    }
  })

  it('reads every other row as live, including the ones whose prose discusses retiring things', () => {
    expect(declared.get(rid('RSK', '004')).status).toBe('current')
    expect(declared.get(rid('FR', '090')).status).toBe('current')
  })
})

describe('the committed ledger describes the tree it was generated from', () => {
  const ledger = JSON.parse(readCanonical(LEDGER_PATH))
  const declared = collectDeclared(ROOT)

  it('exists and is the witness, not a debt baseline', () => {
    expect(existsSync(LEDGER_PATH)).toBe(true)
    expect(ledger.purpose).toContain('AGENTS.md §18')
    expect(Object.keys(ledger.ids)).toHaveLength(declared.size)
  })

  it('carries a roster naming every id it has ever pinned', () => {
    // The roster is the redundancy that makes a deleted entry a fact rather than
    // an absence. Without it, one `delete` re-landed the whole 2026-08-20
    // incident as a routine "+" block with no deleted line in the diff.
    expect(new Set(ledger.roster)).toEqual(new Set(Object.keys(ledger.ids)))
  })

  it('raises nothing critical against the live tree', () => {
    const findings = evaluateIdStability({
      declared,
      ledger,
      readDoc: (p) => (existsSync(path.join(ROOT, p)) ? readCanonical(path.join(ROOT, p)) : null),
    })
    expect(criticals(findings).map((f) => `${f.title} — ${f.details}`)).toEqual([])
  })

  it('records anchors and never statements, so a reword past the window leaves no diff here', () => {
    const serialized = JSON.stringify(ledger.ids)
    // The full statement runs well past the anchor cap; only its head is stored.
    // Storing whole statements would churn this file on all 23 reword events the
    // history contains, reintroducing the noise the anchor avoids.
    expect(serialized).not.toContain('and it holds no write path at all')
    for (const entry of Object.values(ledger.ids)) {
      for (const h of entry.history) expect(h.anchor.length).toBeLessThanOrEqual(60)
    }
  })

  it('gives every retirement it records a reason, and marks the ones that predate it', () => {
    for (const [id, e] of Object.entries(ledger.ids)) {
      if (e.status === 'current') continue
      const first = e.history[0]
      expect(first.reason.length, `${id} records a retirement with no explanation`).toBeGreaterThanOrEqual(40)
      expect(first.pre_ledger, `${id} is retired but not marked as predating the ledger`).toBe(true)
    }
  })
})

describe('the writer refuses to launder a repurpose', () => {
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'id-ledger.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }
    }
  }
  const SENTENCE = 'A sentence long enough to be an actual explanation of what moved.'
  // Every case below exits before the ledger is written, so these do not touch
  // the committed file.

  it('will not record a move with no reason', () => {
    const r = run(['--declare', SDD('050')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('--reason is required')
  })

  it('will not accept a reason that is a shrug', () => {
    const r = run(['--declare', SDD('050'), '--reason', 'fix'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('is not an explanation')
  })

  it('will not record a move that did not happen', () => {
    const r = run(['--declare', SDD('050'), '--reason', SENTENCE])
    expect(r.code).toBe(1)
    expect(r.out).toContain('Nothing moved')
  })

  it('will not record a reword that did not happen either', () => {
    const r = run(['--reword', SDD('050'), '--reason', SENTENCE])
    expect(r.code).toBe(1)
    expect(r.out).toContain('Nothing to record')
  })

  it('will not use --distinct on anything but a genuinely new id', () => {
    // --distinct exists for one situation only: a NEW id whose subject collides
    // with a sibling. Offered anywhere else it would become the routine way to
    // pin anything, with a sentence nobody reads.
    const pinnedAlready = run(['--distinct', SDD('050'), '--reason', SENTENCE])
    expect(pinnedAlready.code).toBe(1)
    expect(pinnedAlready.out).toContain('only ever pins a NEW id')
    const undeclared = run(['--distinct', FR('999'), '--reason', SENTENCE])
    expect(undeclared.code).toBe(1)
    expect(undeclared.out).toContain('is not declared anywhere in the tree')
  })

  it('refuses --bulk on a settled registry, and has no --force that changes that', () => {
    // A settled registry's ids move one at a time, named out loud. --bulk exists
    // only for a DRAFT registry's whole-file revision (the Market Intelligence
    // SRS renumber, which will happen again), and there is no escape flag.
    for (const args of [['--bulk', PRD, '--reason', SENTENCE], ['--bulk', PRD, '--reason', SENTENCE, '--force']]) {
      const r = run(args)
      expect(r.code).toBe(1)
      expect(r.out).toContain('not a draft registry')
    }
  })
})
