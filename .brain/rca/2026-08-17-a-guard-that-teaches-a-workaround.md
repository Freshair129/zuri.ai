---
version: "0.1.0b"
created_at: "2026-08-17T07:40:00+07:00,CLAUDE"
last_update: "2026-08-17T07:40:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "governance"
  doc_type: "root-cause-analysis"
  scope: "a false-positive guard whose workaround got documented and would have been copied"
---

# Incident — a guard that taught a workaround instead of a fix

## Summary

The viewer-fixture ratchet fired on a file that contained no hand-built viewer.
The agent repaying that file did the reasonable thing under the circumstances:
it **moved the offending code into a new file** to get out of the guard's
proximity window, and wrote a clear header explaining why.

Both halves are the wrong outcome. The code was fine. The guard was wrong. And
the workaround was now documented in the repository as though it were a
technique.

## What actually happened

The check is a proximity heuristic — a `role: 'OWNER'|'MEMBER'|'DEV'` literal
within ten lines of a viewer-only field name. It exists because three
authorization holes shipped green behind hand-built viewer fixtures.

`tests/unit/people-service.test.js` contains a fake Prisma return value: raw
**Membership** rows, which legitimately carry `role:`. A few lines away, an
assertion mentions `visibleBusinessIds`. The heuristic cannot tell a database
row from a viewer literal, so it fired.

The agent's fix was to extract the Membership mock into
`tests/fixtures/people-service-memberships.js`, whose header then explained that
the ratchet "can't tell the two apart by pattern alone" — a permanent, accurate,
and completely wrong-headed piece of documentation.

Earlier the same day the same check had fired on a *comment* that discussed
viewer fields near an unrelated `role:` in a mutation payload. That one was
fixed by stripping comments before matching. This was the second false positive
of the same family, and the first one should have prompted a harder look.

## Root cause

A guard over *absence* is necessarily heuristic — you cannot parse your way to
"this fixture is unrealistic". Heuristics have false positives. What turns a
false positive into damage is that **the cheapest way past a guard is almost
never the fix it was built to demand**, and the cheap path leaves a durable
artifact that the next person reads as guidance.

## Fix

The heuristic now suppresses a `role:` sitting on a line that also carries
Membership-only fields — `personId`, `domainKeysJson`, `employeeRef`, `branchId`,
`tenantId`. Those exist on Membership and on no viewer that has ever existed, so
the suppression is provable rather than a fudge. The mock moved back next to the
tests that use it.

Proven in both directions, which matters more than usual for a change that makes
a guard fire *less*: a planted hand-built viewer is still CRITICAL, and the
Membership rows no longer fire.

## Second instance, same day — and this one changed a number

The `enum-copy` check written *in response to this incident* produced its own
false positive within the hour, and it did worse than teach a workaround.

Its first version counted enum members anywhere in a file. `progress-service.js`
contains three unrelated single-value comparisons:

```js
line  55:  status: { not: 'ARCHIVED' }     // exclusion filter
line 118:  m.status !== 'DONE'             // next-milestone lookup
line 135:  p.status === 'ACTIVE'           // a count
```

Sixty lines apart, three different purposes, no list. The check called it a copy
of `PROJECT_STATUSES` "missing PLANNED, ON_HOLD". The agent repaying it did the
literal thing the finding asked for and rewrote the exclusion filter as an
inclusion filter:

```js
- status: { not: 'ARCHIVED' }
+ status: { in: ACTIVE_WORKSTREAM_STATUSES }
```

Those are not equivalent. `not: 'ARCHIVED'` admits any value that is not
`ARCHIVED`, including one outside the enum; `in: [...]` admits only the listed
ones. Statuses are plain strings in SQLite with no database-level constraint, so
an out-of-enum value silently drops out of a progress roll-up — in a repository
whose own rule is that progress must never report a number a page would
disagree with.

Reverted. The check now requires three distinct members inside a **five-line
window**: a hand-copied list is compact by nature — an array, a column map, a
status→label object — while a vocabulary used across a file is not. That single
change took the finding count from 26 to 10 and every one of the 16 it dropped
was a false positive.

Proven in both directions, as a loosening must be: a planted compact list is
CRITICAL, and three scattered single-value comparisons pass.

## Prevention

1. **When a check fires on something that is not the thing it names, fix the
   check in the same commit.** Do not restructure the code around it. The
   restructuring will be documented, and the documentation will be copied.
2. **Two false positives in one family is a design signal, not two accidents.**
   The comment case and the Membership case are the same bug — the matcher had no
   notion of what it was looking at.
3. **Prove a loosening in both directions.** Tightening a guard is safe to get
   wrong; loosening one is how a guard quietly stops guarding. Every change to
   these checks now plants a positive case and confirms it still fails.
4. **Say it where the person actually is.** A guard's failure message should tell
   the reader what to do when the finding is wrong — fix the heuristic — because
   that is the moment they are deciding between the fix and the dodge.
5. **A new guard's first run is a review of the guard, not a list of defects.**
   Read every finding before acting on any of them. Both false positives here
   were visible on the first run and both were acted on instead of read; the
   second one changed behaviour in a progress calculation.
6. **A finding phrased as "missing X" invites adding X.** When the honest fix
   might be "this is not a list at all", the message has already pointed the
   reader at the wrong repair. Prefer a wording that names the *shape* it
   objects to, not the values it thinks are absent.
