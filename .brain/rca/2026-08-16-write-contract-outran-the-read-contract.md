---
version: "0.1.0b"
created_at: "2026-08-16T23:59:00+07:00,CLAUDE"
last_update: "2026-08-16T23:59:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "a write path could create state the only read path cannot show"
---

# Incident — a goal you could create, and then never see again

## Symptom

`POST /api/business/goals` accepted a goal with no `horizonId`, returned **200**
with a valid DTO — and the goal was then invisible on every subsequent
`GET /api/business/strategy`, permanently.

A unit test explicitly certified the permissive behaviour:

```js
it('accepts roadmapId and horizonId as independently optional', ...)
```

## Root cause

The write schema and the read projection were designed against each other
without either being checked against the other.

- `zGoalCreateInput` made `roadmapId` and `horizonId` **independently optional** —
  defensible in isolation, and it matches the nullable columns.
- `getBusinessStrategy` emits goals **only** nested under
  `roadmap.horizons.goals`.

So the set of goals the write path can create is strictly larger than the set the
read path can express. Anything in the difference is created successfully and is
then unreachable: no endpoint lists it, and the client has already discarded the
id by the time it notices.

The implementer knew about the asymmetry — it appears in a code comment, used as
an argument for duplicating a DTO serialiser locally. It was recorded as a
technical detail and never recognised as a product hole.

## Why it mattered immediately

The next wave built a UI on this endpoint. Without the fix the user-visible
sequence would have been: fill the form → success → refresh → **the goal is
gone**. That is the worst class of bug to ship, because it looks like data loss
to the user and like success to the server.

## Fix

`horizonId` is required on goal creation, and a patch may move a goal between
horizons but never detach it (`.nullish()` removed from both fields). The read
side was frozen for this change, so the write contract was made to conform to the
read contract rather than the reverse.

The permissive unit test was **updated, not deleted** — it now asserts that a
goal with no `horizonId` is rejected, with an explicit note that such a goal
would be invisible on the next GET. A companion test retains the genuinely
optional case (`roadmapId` omitted once `horizonId` is present).

## Prevention

- **Every state a write path can create must be reachable by some read path.**
  When the only read is a nested projection, the write must require whatever the
  nesting depends on.
- **"The column is nullable" is not a reason for the API to allow null.** The
  schema permits it; the contract decides it.
- **A comment explaining an asymmetry is a finding, not a footnote.** When an
  implementer documents that two contracts disagree, that belongs in the report,
  not only in the code.
- **The equivalence test is cheap.** Creating an entity through the write path and
  asserting it appears in the read path would have caught this in one assertion —
  which is exactly the test now added for DTO parity.
