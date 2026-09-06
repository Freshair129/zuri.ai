// @req FR-059 — OWNER-scoped Business Strategy editing UI: edit affordances are
// gated on the resolved viewer's role, horizon/goal forms validate the same
// rules the mutation service enforces, and every mutation's 400/409/403
// response is surfaced rather than swallowed.
// @spec BR-001, SDD-032, NFR-004
// @tested tests/unit/fr059-strategy-edit-ui.test.js
//
// Follows this repo's established UI-test idiom (tests/unit/overview-split.test.js,
// tests/unit/design-system.test.js): source files are read as text and asserted
// on directly. There is no React rendering harness in this repo (vitest runs
// with `environment: 'node'`, no @testing-library/react dependency), so this is
// the idiom the codebase already uses for UI logic that would otherwise need a
// DOM to exercise.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  horizonRowsFromRoadmap,
  nextHorizonPosition,
  horizonsPayloadFromRows,
} from '@/modules/project-manager/components/StrategyEditModals'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

const overview = read('src/app/(pm)/overview/page.jsx')
const modals = read('src/modules/project-manager/components/StrategyEditModals.jsx')

describe('FR-059 Business Strategy editing UI', () => {
  describe('OWNER gating', () => {
    it('derives isOwner from the current Business membership in ownedBusinessIds, via the same /api/viewer contract as DomainBar/BusinessShellGuard', () => {
      expect(overview).toContain("useFetch('/api/viewer')")
      expect(overview).toContain('const isOwner = Boolean(viewer.data?.ownedBusinessIds?.includes(businessId))')
      // Not the global per-principal `role` label (T3b-1 FIX 1) — an OWNER of
      // a different Business who is only a MEMBER of this one must not pass.
      expect(overview).not.toContain("const isOwner = viewer.data?.role === 'OWNER'")
      expect(overview).not.toContain("role !== 'MEMBER'")
    })

    it('gates every edit affordance on isOwner — a MEMBER (or DEV) viewer renders none of them', () => {
      expect(overview).toContain('{isOwner && roadmap && (')
      expect(overview).toContain('action={isOwner && (')
      expect(overview).toContain('{isOwner && (')
      expect(overview).toContain('{isOwner && goalModalState && (')
      expect(overview).toContain('{isOwner && linkingGoal && (')
      // The three edit entry points: roadmap edit, goal create/edit, project link.
      expect(overview).toContain('Edit roadmap')
      expect(overview).toContain('New goal')
      expect(overview.match(/aria-label=\{`Edit \$\{goal\.title\}`\}/)).toBeTruthy()
      expect(overview.match(/aria-label=\{`Link Projects to \$\{goal\.title\}`\}/)).toBeTruthy()
    })

    it('never renders an edit affordance unconditionally next to the read-only strategy content', () => {
      // Every button that mutates strategy state must sit behind an isOwner check
      // somewhere in its enclosing JSX (an `{isOwner && (...)}` wrapper).
      const mutationButtons = ['setEditingRoadmap(true)', 'setGoalModalState(', 'setLinkingGoalId(']
      for (const trigger of mutationButtons) {
        let index = overview.indexOf(trigger)
        expect(index).toBeGreaterThan(-1)
        let found = 0
        while (index !== -1) {
          const precedingContext = overview.slice(Math.max(0, index - 900), index)
          if (/isOwner/.test(precedingContext)) found += 1
          index = overview.indexOf(trigger, index + 1)
        }
        expect(found).toBeGreaterThan(0)
      }
    })
  })

  describe('Horizon form validation (RoadmapModal)', () => {
    it('rejects a horizon count outside 2-3 with the exact server wording, before any request is sent', () => {
      expect(modals).toContain("if (rows.length < 2 || rows.length > 3) return 'Business roadmap must have 2 or 3 horizons'")
      expect(modals).toContain("setError('Business roadmap must have 2 or 3 horizons')")
    })

    it('rejects a duplicate horizon key client-side with the exact server wording', () => {
      expect(modals).toContain('if (keys.has(key)) return `Duplicate horizon key "${key}"`')
    })

    it('never exposes a raw "position" input — no form field can set a duplicate position', () => {
      expect(modals).not.toMatch(/label="Position"/)
    })

    it('blocks removing a horizon that still has goals attached, with the exact server wording', () => {
      expect(modals).toContain(
        'setError(`Cannot remove horizon "${row.key}" — it still has ${row.goalCount} goal(s) attached. Move or update those goals first.`)'
      )
    })

    it('blocks removing a horizon below the 2-horizon floor', () => {
      expect(modals).toContain('if (horizons.length <= 2) {')
    })

    it('blocks adding a 4th horizon', () => {
      expect(modals).toContain('if (horizons.length >= 3) {')
    })
  })

  describe('Horizon position carry-through (T3b-1 FIX 2)', () => {
    // Real behavior, not a source-text grep: these are pure functions exported
    // from StrategyEditModals.jsx specifically so the read-model -> row-state
    // -> submit-payload round trip is directly executable here without a DOM.
    const seededRoadmap = {
      horizons: [
        { key: 'SHORT', label: 'Short term', position: 1, description: null, targetAt: null, goals: [] },
        { key: 'MEDIUM', label: 'Medium term', position: 2, description: null, targetAt: null, goals: [{ id: 'g1' }] },
        { key: 'LONG', label: 'Long term', position: 3, description: null, targetAt: null, goals: [] },
      ],
    }

    it('a title-only edit (no row changes) resubmits the exact same, non-contiguous seeded positions — not the 0-based array index', () => {
      const rows = horizonRowsFromRoadmap(seededRoadmap)
      expect(rows.map((r) => r.position)).toEqual([1, 2, 3])

      // Simulate editing only the title: horizons rows are never touched.
      const payload = horizonsPayloadFromRows(rows)
      expect(payload.map((h) => h.position)).toEqual([1, 2, 3])
      expect(payload.map((h) => h.position)).not.toEqual([0, 1, 2])
    })

    it('carries goalCount through so an attached horizon is still protected from removal after the position fix', () => {
      const rows = horizonRowsFromRoadmap(seededRoadmap)
      expect(rows[1].goalCount).toBe(1)
    })

    it('a newly-added horizon gets a position past the current maximum, never colliding with a kept horizon', () => {
      const rows = horizonRowsFromRoadmap(seededRoadmap).slice(0, 2) // SHORT(1), MEDIUM(2) kept; LONG(3) dropped
      const fresh = nextHorizonPosition(rows)
      expect(fresh).toBe(3)
      expect(rows.map((r) => r.position)).not.toContain(fresh)
    })

    it('a brand-new roadmap with no existing horizons starts rows at positions 0 and 1', () => {
      const rows = horizonRowsFromRoadmap(null)
      expect(rows.map((r) => r.position)).toEqual([0, 1])
    })

    it('the component builds new rows via nextHorizonPosition, not a hardcoded blankHorizon(), when adding a horizon', () => {
      expect(modals).toContain('setHorizons((rows) => [...rows, blankHorizon(nextHorizonPosition(rows))])')
    })

    it('submit uses horizonsPayloadFromRows, not an inline index-based map', () => {
      expect(modals).toContain('horizons: horizonsPayloadFromRows(horizons),')
      expect(modals).not.toContain('position: index,')
    })
  })

  describe('RoadmapModal lifecycle (T3b-1 FIX 3)', () => {
    // No React rendering harness is available in this repo's test config (see
    // the file header) to actually mount/unmount and assert on real component
    // state, so — same idiom as the rest of this file — this asserts on the
    // structural pattern in the source rather than on runtime behavior.
    it('is rendered conditionally on editingRoadmap, matching the GoalModal/LinkProjectModal unmount-on-close pattern', () => {
      expect(overview).toContain('{isOwner && editingRoadmap && (')
      // The old defect: permanently mounted (gated only on isOwner) with only
      // `open` toggled, so the `useState(() => ...)` initializer never re-ran.
      expect(overview).not.toContain('open={editingRoadmap}')
    })

    it('passes a bare `open` prop (mount-only), not a toggled open={...} expression, so state resets via unmount rather than a prop flip', () => {
      const start = overview.indexOf('<RoadmapModal')
      const end = overview.indexOf('/>', start)
      const block = overview.slice(start, end)
      expect(block).toMatch(/\n\s+open\n/)
      expect(block).not.toMatch(/open=\{/)
    })
  })

  describe('Goal form validation (GoalModal)', () => {
    it('requires horizonId before submit and never offers a no-horizon option', () => {
      expect(modals).toContain("if (!form.horizonId) {")
      expect(modals).toContain("setError('Choose a horizon for this Goal')")
      // The <select> for horizon renders only real horizons — no empty/placeholder option.
      const selectBlock = modals.slice(modals.indexOf('label="Horizon"'), modals.indexOf('label="Horizon"') + 300)
      expect(selectBlock).not.toMatch(/<option value=""/)
      expect(selectBlock).toContain('horizons.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)')
    })

    it('bounds progress to 0-100 to match the server Zod schema', () => {
      expect(modals).toContain('type="number" min="0" max="100"')
    })
  })

  describe('Mutation response handling (400 / 409 / 403)', () => {
    it('surfaces every mutation error message verbatim instead of swallowing it (covers 400 isolation/validation and 403 owner-permission responses)', () => {
      // Every modal's submit/action catch sets visible error state — none discard err silently.
      expect(modals).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/)
      expect(modals.match(/setError\(err\.message\)/g)?.length).toBeGreaterThanOrEqual(3)
    })

    it('treats re-linking an already-linked Project (409) as a normal outcome, not a crash', () => {
      // T3b-1 FIX 6: keyed on the HTTP status api() attaches (err.status),
      // not on sniffing the message text — a reworded server message can no
      // longer silently degrade this branch to a generic red error.
      expect(modals).toContain('err.status === 409')
      expect(modals).not.toContain('/already linked/i.test(err.message)')
      expect(modals).toContain("setInfo('This Project is already linked to the Goal.')")
      // Still reloads the strategy read model on the 409 path — the UI recovers, it does not just swallow the error.
      const linkFn = modals.slice(modals.indexOf('const link = async'), modals.indexOf('const unlink = async'))
      expect(linkFn).toContain('onSaved?.()')
      expect(linkFn).not.toMatch(/throw/)
    })

    it('documents the 403 "Owner permission is required" path is handled by the same generic error surface', () => {
      expect(modals).toMatch(/403 "Owner permission is required"/)
    })
  })

  describe('Accessibility (NFR-004)', () => {
    it('closes on Escape and returns focus to the previously-focused element', () => {
      expect(modals).toContain("event.key === 'Escape'")
      expect(modals).toContain('previouslyFocused.focus()')
    })

    it('traps Tab focus inside the open modal', () => {
      expect(modals).toContain("event.key !== 'Tab'")
      expect(modals).toContain('event.preventDefault()')
    })

    it('every field is a Field-wrapped native label, not a bare input', () => {
      expect(modals).toContain("import { Modal, Field } from '@/components/ui'")
      expect(modals.match(/<Field label=/g)?.length).toBeGreaterThanOrEqual(8)
    })
  })

  describe('Focus-trap effect stability across parent re-renders (T3b-1 FIX 4)', () => {
    // This repo's test harness has no DOM/rendering layer (see the file
    // header), so it cannot actually mount A11yModal, re-render its parent
    // with a fresh inline `onClose`, and assert focus stayed put — the kind
    // of assertion that would really catch a regression here. That coverage
    // exists instead as a real Playwright focus assertion in
    // tests/e2e/fr059-strategy-edit.spec.js ("focus stays trapped ... across
    // a mutation reload"), which runs against a live browser DOM and checks
    // `toBeFocused()` before and after a mutation while the dialog stays
    // open. What follows here is a narrower, but still meaningful (not a
    // generic string grep), structural check of the actual root-cause fix:
    // the effect's dependency array no longer includes `onClose`, and the
    // latest `onClose` is read through a ref instead, so a fresh `onClose`
    // identity from the parent no longer tears the effect down.
    it("the focus-trap effect's dependency array is [open], not [open, onClose] — onClose no longer re-triggers it", () => {
      expect(modals).toContain('const onCloseRef = useRef(onClose)')
      expect(modals).toContain('onCloseRef.current = onClose')
      expect(modals).toContain('onCloseRef.current?.()')
      expect(modals).not.toContain('onClose?.()')
      expect(modals).toMatch(/\}, \[open\]\)/)
      expect(modals).not.toMatch(/\}, \[open, onClose\]\)/)
    })

    // The second half of FIX 4: a currently-focused button that becomes
    // `disabled` mid-mutation is a native browser focus fix-up straight to
    // `document.body`, independent of the effect-teardown issue above.
    // Confirmed empirically (not assumed) against a live browser that
    // Chromium fires `focusout` on the disabling element but no matching
    // `focusin` for the implicit move to `<body>` — so the reclaim has to be
    // wired to `focusout`, checked on the next tick, not `focusin`.
    it('reclaims focus that escaped to <body> via a focusout listener (not focusin, which never fires for the implicit body move)', () => {
      expect(modals).toContain("document.addEventListener('focusout', reclaimFocusIfEscapedToBody, true)")
      expect(modals).toContain("document.removeEventListener('focusout', reclaimFocusIfEscapedToBody, true)")
      expect(modals).not.toMatch(/addEventListener\('focusin'/)
      expect(modals).toContain('if (document.activeElement !== document.body) return')
      expect(modals).not.toMatch(/\}, \[open, onClose\]\)/)
    })
  })
})
