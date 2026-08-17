import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXECUTION_MODES, EXECUTION_MODE_CONTRACTS } from '@/lib/validation/enums'

// @req FR-017 — the project wizard picks a starting item subtype per execution mode.
// @spec BR-004, SDD-002
// @tested tests/unit/mode-default-subtype.test.js
//
// `DEFAULT_ITEM_SUBTYPE` in the wizard was reported by the enum-copy check as an
// "INCOMPLETE copy of ITEM_SUBTYPES missing BUG/VALIDATION/RECONCILIATION/…".
// It is not a copy. It is one default per execution mode, and "repairing" it by
// adding the reportedly missing values would have turned a per-mode map into
// nonsense. The check was narrowed instead.
//
// But the review that cleared it surfaced the risk the false positive had been
// hiding, which nothing was checking: the map's VALUES must be subtypes the
// mode's own contract allows. If one drifts, the wizard creates a work item that
// `validatePlanSemantics` rejects — the wizard's own intake refusing the wizard's
// own output.
//
// It is deliberately NOT derived as `itemSubtypes[0]`: B2B_SALES defaults to DEAL
// while its contract lists ACCOUNT first. That is a product choice, so it is
// pinned rather than computed.

const source = readFileSync('src/app/(pm)/projects/new/page.jsx', 'utf8')

/** Read the map out of the wizard without importing a client component. */
function defaultItemSubtypes() {
  const block = source.slice(source.indexOf('const DEFAULT_ITEM_SUBTYPE'))
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'))
  return Object.fromEntries(
    // `[A-Z_]+` silently dropped B2B_SALES and B2C_CAMPAIGN — mode names carry
    // digits, and a parser that skips two of the seven modes would have made
    // this test pass by not looking at them.
    [...body.matchAll(/([A-Z][A-Z_0-9]*)\s*:\s*'([A-Z][A-Z_0-9]*)'/g)].map((m) => [m[1], m[2]])
  )
}

describe('every execution mode has a default item subtype its contract allows', () => {
  const defaults = defaultItemSubtypes()

  it('covers every declared execution mode, and no invented one', () => {
    // Derived from EXECUTION_MODES so adding a mode fails here rather than
    // leaving the wizard silently unable to start that mode.
    expect(Object.keys(defaults).sort()).toEqual([...EXECUTION_MODES].sort())
  })

  it.each(EXECUTION_MODES)('%s defaults to a subtype its own contract permits', (mode) => {
    const allowed = EXECUTION_MODE_CONTRACTS[mode].itemSubtypes
    expect(allowed).toContain(defaults[mode])
  })

  it('is a per-mode map, not a copy of the subtype vocabulary', () => {
    // The assertion that states what the enum-copy report got wrong: this has
    // exactly one entry per mode, far fewer than ITEM_SUBTYPES has members.
    expect(Object.keys(defaults)).toHaveLength(EXECUTION_MODES.length)
  })

  it('keeps B2B_SALES on DEAL rather than the contract\'s first entry', () => {
    // Pins the one place the map deliberately differs from `itemSubtypes[0]`, so
    // a future "simplification" into a derivation has to argue with a test.
    expect(EXECUTION_MODE_CONTRACTS.B2B_SALES.itemSubtypes[0]).toBe('ACCOUNT')
    expect(defaults.B2B_SALES).toBe('DEAL')
  })
})
