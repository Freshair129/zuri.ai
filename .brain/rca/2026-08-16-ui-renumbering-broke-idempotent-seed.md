---
version: "0.1.0b"
created_at: "2026-08-16T23:49:00+07:00,CLAUDE"
last_update: "2026-08-16T23:49:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "an edit form resubmitting array indices silently rewrote a natural key"
---

# Incident — a title-only edit renumbered a natural key and broke `db:seed`

## Symptom

Editing **only the title** of a Business roadmap rewrote every horizon's
`position` from the seeded `1,2,3` to `0,1,2`. The next `npm run db:seed` then
failed:

```
PrismaClientKnownRequestError: Unique constraint failed on the fields:
(`roadmapId`,`key`)     at prisma/seed.js:135
```

`CLAUDE.md` documents `db:seed` as idempotent. One roadmap edit by any developer
broke that promise for the whole repository.

## Root cause

The edit modal built its rows from the read model but re-derived `position` from
the **array index** on submit:

```js
horizons: rows.map((row, index) => ({ ...row, position: index }))
```

The read model returns horizons ordered by position, so the array index is a
*correct-looking* value — the list renders identically afterwards. Nothing in the
UI reveals that a key changed, because every runtime consumer uses `position`
only for relative ordering.

`prisma/seed.js` is the one consumer that treats it as an identity: its
idempotent upsert keys on `roadmapId_position`. After the renumber it matched a
different row and collided on `(roadmapId, key)`.

A second, quieter defect: a title-only edit rewrote every horizon row. Even
without the seed collision, that is a gratuitous write, an inflated audit
payload, and needless version churn.

## Why nothing caught it

- Unit and integration tests assert *ordering*, which is preserved.
- The UI looks right, because ordering is preserved.
- `db:seed` is not part of `npm test`, so the only consumer that cares was never
  exercised by CI after a mutation.

The reviewer found it by grepping every consumer of `position` before judging
the change harmless — and then, crucially, by **actually running `node
prisma/seed.js` twice** rather than reasoning about whether it would still work.

## Fix

Carry each existing horizon's real `position` through the modal's row state and
resubmit it unchanged; only genuinely new horizons receive a fresh position
(`max + 1`). Verified live: a title-only edit now leaves positions at `1,2,3`,
and `node prisma/seed.js` run twice is clean.

## Prevention

- **A value that appears in a `@@unique` constraint is a key, even when it looks
  like a display ordinal.** Do not re-derive it from client-side array position.
- **Send only what changed.** A patch that rewrites untouched child rows will
  eventually collide with something that treats those rows as stable.
- **Exercise the documented commands after a mutation lands.** `db:seed`,
  `db:reset` and the docs chain are part of the contract; a change that breaks
  one of them is not done, and only running them proves it.
