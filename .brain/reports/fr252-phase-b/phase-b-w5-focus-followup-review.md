# Phase B W5 UI focus follow-up independent review

**Date:** 2026-09-17 (Asia/Bangkok)
**Tree:** `zuri-pm-feature-phase-b-integrated`
**Review type:** bounded read-only static review
**Disposition:** **PASS — source focus correction**

## Scope and evidence boundary

This follow-up reviews the frozen focus correction in `ProjectFeatureView.jsx`, the
matching owner-action callback change in `ProjectFeatureForms.jsx`, and the final
mutation browser fixture change. The previously written provisional review remains
unchanged in `phase-b-w5-ui-independent-review.md`; the earlier static PASS remains
the historical baseline in `phase-b-w5-ui-final-review.md`. This report records only
the post-browser-focus-defect follow-up.

No tests, browser runs, build, server, or governance command was executed by this
review. Root owns the pending rerun and its execution evidence. The conclusions
below are from source and test-file inspection at the hashes listed here.

## Frozen file hashes

| File | SHA-256 | Review role |
|---|---|---|
| `apps/server/src/modules/project-manager/components/ProjectFeatureView.jsx` | `0B720943EEE25DCB1EB1F765689F5FDEABBC4616DD2DF21F9FAD3E5FC2D97143` | focus/lifetime implementation |
| `apps/server/src/modules/project-manager/components/ProjectFeatureForms.jsx` | `58D2E3CFE196A14211185C5651D96E48285EA402B82D4B3CC7F42A00C959BFBB` | action opener capture |
| `apps/server/src/modules/project-manager/components/ProjectFeaturePickers.jsx` | `70088CA29F922F06509D232FFC9B83832D224B757F164E66EE70595EC160C2DA` | previously frozen picker dependency |
| `apps/server/tests/unit/project-feature-forms.test.js` | `3908D86DAFBDA8B167B4ADD3F0171F0C9B475D11C4A368699644FFBA477AAA6E` | Forms unit evidence source |
| `apps/server/tests/unit/project-feature-pickers.test.js` | `D1311D3BDC3F58CB104A770AE1168FC5782A78523BE82361134BE878D4CF754F` | picker unit evidence source |
| `apps/server/tests/e2e/project-feature-mutations.spec.js` | `31977FAFD87D45726440B9381AC581AEC056BC10218A69B90E5EA5BDC8E1466F` | browser fixture/locator change |

## Focus defect and closure

The prior browser failure occurred when an owner action suspended the drawer: after
Escape/resume, the expected `Edit Feature` action was not focused. The failure was
at the browser assertion corresponding to `project-feature-mutations.spec.js:348`.

The current View source separates two responsibilities:

1. The drawer-lifetime effect is keyed only by `projectId` and `featureId`. It
   captures the external pre-drawer element and restores that connected element on
   Project/Feature change or unmount. It no longer runs cleanup merely because the
   drawer is temporarily suspended.
2. The suspension-sensitive effect is keyed by `projectId`, `featureId`, and
   `suspended`. On an unsuspended `requestAnimationFrame`, it consumes the
   scope-tagged action opener only when the stored project and feature match, the
   element is connected, the element is inside the current drawer, and it is still
   enabled. Otherwise it uses the existing connected drawer close-button fallback.

The action callback now captures `event.currentTarget` at the six owner-action
buttons before the asynchronous mutation begins. The View adds the current
Project/Feature scope to that element, so a late callback cannot focus an action
from another feature. The existing `inert`, `aria-hidden`, and suspended modal
semantics remain intact; keyboard listeners, the focus-reclaim timer, and the
animation frame are guarded and cleaned up by the suspension effect.

The View-level `closeForm` guard also requires the captured Project, Feature, and
action to match current context. This prevents a stale child completion or close
callback from clearing a newly selected action while the stable keyed form owner
continues to preserve the pending intent.

This addresses the reported focus defect without weakening the modal, authorization,
scope, or pending-intent behavior. I found no remaining P1/P2 focus or stale-scope
defect in this delta.

## Forms, picker, and browser fixture check

The Forms hash contains the six `event.currentTarget` owner-action callbacks, while
the existing pending-intent map and stable Project/Feature form ownership remain
available for close/reopen and late-response handling. The picker hash is unchanged
from the prior final static review and retains Project-response masking, generation
guards, canonical domain handling, and non-form search behavior.

The current mutation spec hash includes the fixture/locator update requested by the
workers. Its focus assertion remains an exact role/name assertion for the action
button, and the in-flight scenario continues to assert preserved method, body,
idempotency key, and `If-Match` across close/reopen. I observed no assertion removal
or broadening that would hide the original defect. These are static observations;
the current browser outcome belongs to Root's pending rerun.

## Final disposition

**PASS for the frozen source focus correction.** The two-effect lifetime/suspension
split, action `currentTarget` capture, exact scope tagging, connected in-panel
enabled-target check, and close-button fallback close the reported browser focus
defect while preserving the existing drawer privacy and pending-intent boundaries.

Root must attach the post-fix browser, focused-test, and build results separately;
this report makes no execution-pass claim.
