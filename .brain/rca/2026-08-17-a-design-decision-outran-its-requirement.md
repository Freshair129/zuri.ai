---
version: "0.1.0b"
created_at: "2026-08-17T07:45:00+07:00,CLAUDE"
last_update: "2026-08-17T07:45:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "an SDD claiming four sub-views while its FR declared two — and the gate that found it"
---

# Incident — a design decision out-ran the requirement it was keyed to

## Summary

SDD-019 states that the project Work tab "owns `Structure Plan`, `Board`,
`Schedule`, and `Dependency Map`". FR-040, the requirement SDD-019 traces to,
declares only that "every Project provides a Structure Plan (WBS) and a
project-local Dependency Map".

Two of the four sub-views shipped, were linked in the tab bar, and were reachable
by users, with **no requirement behind them at all**.

## Root cause

An SDD is a design decision keyed to a requirement. Nothing prevents its text
from asserting scope the requirement never granted — and nothing could, by
machine: whether a design decision stays inside its FR's scope is a question of
meaning, not of structure.

What made it survive is subtler. The FR-040 test asserts that the tab bar
*contains the label* `Board`. It never opens the page. So the label was verified,
the behaviour was not, and the trace views showed FR-040 as covered by code and
by a test. From every automated angle the feature looked accounted for.

## The prevention already existed — it was added the same morning

This was not found by inspection. The **route-anchor check**, added earlier on
2026-08-17, refuses a route that implements no declared requirement. The 46
routes predating it were recorded as accepted debt, and repaying that baseline is
what surfaced these two.

So the honest answer to "how do we stop this happening again" is: it already
cannot happen again for a *route*. A new page with no `@req` is a CRITICAL on the
first run. The two survivors here are historical debt from before the gate, and
the gate is precisely what dug them out.

That is worth stating plainly, because the reflex after finding a defect is to
build something. Here the right response was to notice that the thing already
built had done its job.

## Fix

[FR-063](../../docs/domains/project-manager/features/FR-063-project-board.md) and
[FR-064](../../docs/domains/project-manager/features/FR-064-schedule-timeline.md)
declare Board and Schedule. SDD-019 now cites them and records that it had
claimed four while its FR stated two.

Widening FR-040's text was proposed and rejected. Sharpening a statement to name
the surface of behaviour it already declares is legitimate — FR-005, FR-006 and
FR-007 got exactly that treatment in the same commit. But no requirement anywhere
described rendering work as a status board or dates as a grid, so folding them
into FR-040 would have put new requirement content under an existing key, which
is the one thing the id contract forbids.

**Unstated surface for stated behaviour is an incomplete sentence. Unstated
behaviour is a missing requirement.** Only the first can be repaired by editing.

## Prevention

1. **A test that asserts a navigation label is not evidence the destination
   works.** It verifies the sign, not the room. Where a tab bar names N
   destinations, the coverage question is N pages, not one label list.
2. **When an SDD enumerates more than its FR does, one of the two is wrong.** No
   check can decide which; a human reading them side by side can, and the moment
   to do it is when either is edited.
3. Residual gap, stated rather than solved: nothing detects an SDD whose scope
   exceeds its FR. The route-anchor check catches the *consequence* when the
   excess scope reaches a route. Excess that never reaches a route stays
   invisible.
