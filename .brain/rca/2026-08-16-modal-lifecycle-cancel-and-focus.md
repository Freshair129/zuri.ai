---
version: "0.1.0b"
created_at: "2026-08-16T23:51:00+07:00,CLAUDE"
last_update: "2026-08-16T23:51:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "a modal that never unmounted, and a focus trap torn down on every parent render"
---

# Incident — Cancel discarded nothing, and focus left the open dialog

Two defects in the same component, both invisible to the test suite, both found
only by driving the running application.

## Defect 1 — Cancel silently kept the edits

`RoadmapModal` was rendered whenever `isOwner`, with only its `open` prop
toggled. The shared `Modal` returns `null` when closed, so **the component never
unmounted** and its `useState(() => ...)` initialiser never re-ran.

Reproduced live:

1. type `ABANDONED DRAFT — must not persist`
2. click **Cancel**
3. reopen → the text is still there

A user who cancels, returns later and clicks Save persists edits they believe
they discarded. That is a data-integrity defect, not a cosmetic one. A second
symptom of the same cause: the goal count shown in the modal stayed frozen at
its mount-time value.

`GoalModal` and `LinkProjectModal` were free of this — they are rendered
conditionally and therefore unmount. The bug existed only where the rendering
idiom differed, in one of three siblings.

**Fix.** Render `RoadmapModal` conditionally like its siblings, so closing
unmounts it and reopening builds fresh state.

## Defect 2 — the focus trap released the dialog after every mutation

The trap effect's dependencies were `[open, onClose]`, and `onClose` was a fresh
inline arrow from the parent on every render. Each `reload()` after a mutation
therefore tore the effect down and re-ran it, restoring focus to a node React
may already have replaced.

Measured in the running app:

```
focus before link : SELECT
focus after link  : BODY      ← dialog still open
```

Escape-closing also left focus on `<body>` rather than the button that opened
the modal — contradicting the component's own header comment.

**Fix.** Hold `onClose` in a ref so the effect depends only on `[open]`. That
alone was not sufficient: a focused button becoming `disabled` mid-mutation is a
native browser fix-up to `<body>` that fires `focusout` but **no** `focusin`, so
a reclaim keyed on `focusin` never runs. The working fix listens for `focusout`
and reclaims on the next tick, guarded by `activeElement === body` so it never
steals focus from a legitimate target outside the dialog.

That second mechanism was discovered empirically — the first attempt did not make
the end-to-end test pass, and the difference was only visible by instrumenting a
real browser.

## Why the tests were blind

The unit test asserted on **source text**:

```js
expect(source).toContain('previouslyFocused.focus()')
expect(source).toContain("event.key !== 'Tab'")
```

This repository has no DOM test harness for components (`vitest` runs with
`environment: 'node'` and no `@testing-library/react`), so component tests are
source-text assertions by convention. Such a test proves a string exists. It
cannot observe that the effect is destroyed on every parent render, or that
focus ends up on `<body>`.

Both defects were caught by an agent driving the app and by an adversarial gate
that stress-tested the reclaim across six scenarios in a live browser.

## Prevention

- **A modal whose parent only toggles `open` never unmounts.** If per-open state
  is expected — and "Cancel discards" is exactly that expectation — render it
  conditionally or key it on something that changes.
- **An inline arrow in an effect's dependency array re-runs that effect on every
  parent render.** For effects that install and restore global state (focus
  traps, listeners, locks) this is a correctness bug, not a performance one.
- **Source-text assertions are a convention here, not a verification.** When the
  behaviour is DOM behaviour, it must be proven in a browser — the e2e layer is
  the only place these two defects were observable.
