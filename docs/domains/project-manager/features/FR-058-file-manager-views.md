---
domain: project-manager
feature: FR-058
module: project-manager
source: v2-native
---

# FR-058 - File Manager Views

| Field | Value |
|---|---|
| **Version** | 1.1.0 |
| **Status** | Candidate |
| **Date** | 2026-08-16 |
| **Relates to** | FR-045, SDD-023, SDD-031, ADR-016, SEC-007 |

The Business and Project File Manager (FR-045) render **one** canonical asset
set — `buildBusinessFileManagerReadModel` / `buildProjectFileManagerReadModel`
in `src/modules/project-manager/application/file-manager-read-model.js` — in
four switchable read views: **grid** (current behaviour, unchanged), **timeline**,
**by-project**, and **preview**. View choice is client-side UI state. There is
no new persistence, no new route, and no new write path — this is a contract
for two independently implemented pieces (the read-model DTO change and the UI
switcher) to agree on without guessing.

## 1. `assetDto` additive fields

`assetDto()` in `file-manager-read-model.js` gains exactly two fields, appended
to the existing object (field order in the object literal does not matter, but
no existing field is renamed, removed, or reshaped):

```js
{
  // ...all existing fields unchanged...
  createdAt: asset.createdAt, // FileAsset.createdAt (Prisma DateTime)
  updatedAt: asset.updatedAt, // FileAsset.updatedAt (Prisma DateTime)
}
```

Serialization: these are `Date` objects at the service boundary, exactly like
every other Prisma `DateTime` field already returned by this codebase's API
routes (e.g. `Project.createdAt`, `WorkItem.updatedAt`) — `Response.json(...)`
/ `JSON.stringify` converts them to ISO-8601 strings automatically. Do not
pre-format them to strings in the service; do not add a second, differently-named
timestamp field.

## 2. Timeline view — deterministic ordering rule

The timeline view sorts the **same** `assets` array the grid view already
receives (post `compareAssets`, pre-render) using a new comparator that follows
the identical composite-key, `localeCompare` discipline as the existing
`compareAssets` helper (same file, do not duplicate the pattern differently):

```js
function compareAssetsByTimeline(left, right) {
  const leftKey = new Date(left.updatedAt).getTime()
  const rightKey = new Date(right.updatedAt).getTime()
  if (leftKey !== rightKey) return rightKey - leftKey // newest updatedAt first
  const leftCreated = new Date(left.createdAt).getTime()
  const rightCreated = new Date(right.createdAt).getTime()
  if (leftCreated !== rightCreated) return rightCreated - leftCreated // newest createdAt first
  return compareAssets(left, right) // final tiebreak: existing code|id discipline
}
```

Rule in words: **most-recently-updated first**; ties broken by **most-recently-created
first**; remaining ties broken by the existing `compareAssets` tiebreak
(`[code, id].join('|')` ascending, `localeCompare`). This guarantees the same
total order regardless of which agent implements the sort, because every
comparison has exactly one deterministic outcome — no two assets can be
"equal" under this comparator unless `code` and `id` are also both equal.

This comparator is a pure function over the DTO list; it may live alongside
`compareAssets` in the read-model module, or in the UI layer that consumes the
DTOs — either is compliant with SDD-031 (client-side projection) as long as no
new server route or persisted ordering field is introduced.

## 3. By-project view — consumed shape

The by-project view reuses the read model's existing `groups` array — a
`PROJECT` group also carries the project's human identifiers (v1.1.0 amendment,
see below):

```js
groups: [
  { kind: 'BUSINESS', businessId, projectId: null, assetIds: [...] },
  { kind: 'PROJECT', businessId, projectId, projectCode, projectName, assetIds: [...] }, // one per project with assets, code|id order
]
```

`groups[].assetIds` are ids only. The by-project view resolves each id against
the `assets` array already present in the same read-model response (a
`Map(assets.map(a => [a.id, a]))` join) — it must not issue a second fetch or
duplicate an asset DTO. A `PROJECT` group's display order follows the existing
`groups` array order (already sorted by project `[code, id]`); within a group,
assets keep the `compareAssets` order they arrive in.

A `BUSINESS` group (assets with no project) carries no equivalent fields and
keeps its existing "No project" label — there is no project to name.

### Amendment (v1.1.0) — `projectCode`/`projectName` on the PROJECT group

**Original v1.0.0 scope said `groupsFor` would not change; it changed.** The
first UI pass rendered a `PROJECT` group's heading as `` `Project ${projectId}` ``
— a raw uuid, not a label a user can read. Two ways to fix it were available:

1. Have the by-project view (or `ManagedFilesPanel`) fetch the Business's
   project list a second time and join on `projectId` client-side.
2. Add `projectCode`/`projectName` to the `PROJECT` group object inside
   `groupsFor`, since it already iterates the full `projectsById` project
   records (`file-manager-read-model.js`, `groupsFor`) to build each group —
   the identifiers are already in hand.

Option 1 requires a second fetch of data the read model already loaded once,
which is a sharper violation of SDD-031's "pure projection over one canonical
list" discipline than amending this scope line: it would give the by-project
view its own out-of-band data source instead of projecting the same response.
Option 2 costs zero extra queries and stays inside one read-model call, so it
was taken instead. `groupsFor`, `countsFor`, `compareAssets` and every
pre-existing field on `assetDto` are otherwise unchanged — this amendment adds
exactly two fields to the `PROJECT` group shape and nothing else.

## 4. Preview eligibility matrix

Preview eligibility is keyed on `(asset.kind /* storageKind */, asset.state /* status */, asset.mime)`:

| storageKind | status | mime | Behavior |
|---|---|---|---|
| `LOCAL_FILE` | `ACTIVE` | `image/*` | Inline preview: `<img>` pointed at `/api/files/{id}/content` |
| `LOCAL_FILE` | `ACTIVE` | `application/pdf` | Inline preview: embedded PDF viewer pointed at `/api/files/{id}/content` |
| `LOCAL_FILE` | `ACTIVE` | `text/*` | Inline preview: fetched text rendered in a scrollable pane |
| `LOCAL_FILE` | `ACTIVE` | any other mime | Fallback: no inline render; show file info panel with a "Download" link to `/api/files/{id}/content` (the route already serves any mime with `Content-Disposition: inline`, so this is a link-out, not a new endpoint) |
| `LOCAL_FILE` | `MISSING` or `QUARANTINED` | any | Fallback: "preview unavailable" placeholder; **never** call `/api/files/{id}/content` — the route itself rejects non-`ACTIVE` assets (`resolveFileAssetContent` throws `File asset is {status}`), so the UI must not attempt the fetch and surface a raw error |
| `MANAGED_BLOB` | any | any | Fallback: "preview unavailable" placeholder — `/api/files/{id}/content` only serves `LOCAL_FILE` (`resolveFileAssetContent` throws `Only active local files expose managed content` for any other kind); do not call it |
| `EXTERNAL_URL` | any | any | Link-out only: open `asset.externalUrl` in a new tab/window. Never proxied through `/api/files/{id}/content` |

No new API route is introduced for preview. `/api/files/{id}/content`
(`src/app/api/files/[id]/content/route.js`) is called only for the two
`LOCAL_FILE` + `ACTIVE` rows above; every other combination is a client-side
fallback decision made from fields already on `assetDto` (`storageKind` is
exposed as `asset.storageKind`, not renamed — the "kind" language above refers
to that same field).

## Out of scope

- No change to `countsFor`, `compareAssets`, or any existing field on
  `assetDto`. (`groupsFor` itself *does* change as of v1.1.0 — see the
  Amendment in §3 above — but only additively: two new fields on the
  `PROJECT` group, nothing removed or reshaped.)
- No server-side sort/group parameter, no new query string, no persisted view
  preference.
- No preview support for `MANAGED_BLOB` in this slice (would require a new
  content-serving path FR-045 does not have).
