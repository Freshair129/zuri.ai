---
version: "0.1.0b"
created_at: "2026-08-16T23:57:00+07:00,CLAUDE"
last_update: "2026-08-16T23:57:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "a projection gained a field; two narrow Prisma selects did not, and JSON.stringify hid it"
---

# Incident — a raw uuid in the UI, and a cache that silently disagreed with the read model

## Symptom 1 — a uuid rendered as a label

The File Manager's by-project view showed:

```
Project 39bc0dc0-a639-4abd-a199-fc5a2301739d · 1
```

## Symptom 2 — `code · undefined`

After the read model was taught to carry the project's name, the live surface
showed `PRJ-B01-TRANSFORM · undefined` while every unit test passed.

## Root cause

Two layers, each individually reasonable.

**The projection had no human label.** `assetDto` carried only `projectId`, the
`groups` structure carried only `projectId`/`assetIds`, and the files pages
fetched no project list. The component had nothing but a uuid to render. The
fix cost nothing: `groupsFor` **already received the full project records** and
iterated them — adding `code` and `name` to the pushed group was one line and
zero extra queries. The alternative a component author would reach for — a
second `/api/projects` fetch — would have broken SDD-031's "pure projection over
one canonical list".

**Two narrow selects then dropped the new field.** The production query paths
selected explicitly:

```js
select: { id: true, code: true, businessId: true, deletedAt: true }   // no `name`
```

Unit tests passed because their fixtures carry complete project records. Only the
real query path was broken — the classic shape of a defect that lives exactly in
the gap between a fixture and a query.

The same omission existed in **two** places: `file-asset-service.js`
(`listManagedFileAssets`, serving both the Business and Project file surfaces)
and `file-reconcile-cache-service.js` (`rebuildBusinessFileCache`). The second is
worse than a cosmetic gap: it writes the projection to
`.zuri/cache/business-overview/files.json` and hashes it into a
`sourceRevision`. **`JSON.stringify` drops `undefined` keys entirely**, so the
cached projection was structurally different from the live read model and its
revision hash diverged — a cache that quietly disagreed with its source.

## Why it took three passes to find

1. The uuid was found by a reviewer **opening the page**, not by any test — the
   e2e spec only ever created Business-scoped files, so it asserted the "No
   project" group and never rendered a PROJECT group at all.
2. The `undefined` was found by the next agent **running its new e2e against real
   code**, where its fixtures could not help it.
3. The cache instance was found only because that agent, blocked by ownership
   from editing the offending file, **enumerated every query feeding the read
   model** and reported the second site instead of quietly fixing the first.

That third step is the reason the cache defect was found at all. A worker that
had simply widened its own scope would have fixed one call site and left the
other.

## Fix

- `groupsFor` emits `projectCode`/`projectName` on PROJECT groups; the view
  renders `code · name`, matching the convention used by `Breadcrumb`,
  `CommandPalette` and the workspaces page.
- `name: true` added to both selects, keeping them explicit rather than widening
  to a bare `findMany`.
- Tests now assert the **name**, assert the `select` itself contains `name: true`,
  and assert **no uuid appears anywhere on the page** — an absence check, since a
  presence-only check would still pass if both were rendered.
- The FR-058 note was amended (1.0.0 → 1.1.0) because its "Out of scope" section
  had said *"No change to `groupsFor`"*. The contract was changed openly rather
  than quietly contradicted.

## Prevention

- **When a projection gains a field, every query feeding it must be updated —
  enumerate them, do not fix the one you found.** An explicit `select` is a
  second place the shape is declared, and it does not fail loudly when it falls
  behind.
- **`JSON.stringify` silently deletes `undefined` keys.** Any projection that is
  serialised, hashed, or compared cannot rely on a missing field surfacing as a
  visible difference.
- **A test whose fixture is richer than the production query cannot catch a
  narrow select.** Assert on the query shape, not only on the result built from a
  fixture.
- **Never render a raw identifier to a user.** A uuid on screen means the
  projection is missing a label; the fix belongs in the projection, not in a
  second fetch at the component.
