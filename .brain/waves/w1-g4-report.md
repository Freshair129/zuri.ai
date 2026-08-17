# W1-G4 — requirement anchor annotations added

| Route | ID Anchored | Description Used |
|---|---|---|
| `src/app/api/import/dry-run/route.js` | FR-012 | validate PlanEnvelope import via dry-run semantic contract check |
| `src/app/api/import/commit/route.js` | FR-012 | transactional commit leg of PlanEnvelope import pipeline |
| `src/app/api/import/template/route.js` | FR-018 | download intake template workbook (generated from Zod enums) |
| `src/app/api/import/xlsx/route.js` | FR-018 | upload filled template: convert with per-row error reporting, then dry-run |
| `src/app/api/projects/route.js` | FR-003 | project CRUD: list and create |
| `src/app/api/projects/[id]/route.js` | FR-003 | project CRUD: get, update, and archive |
| `src/app/api/repositories/route.js` | FR-008 | repository records and many-to-many project links: list and create |
| `src/app/api/repositories/[id]/route.js` | FR-008 | update repository metadata |
| `src/app/api/repositories/link/route.js` | FR-008 | link repository to project (many-to-many relationship) |
| `src/app/api/repositories/link/[id]/route.js` | FR-008 | unlink repository from project (many-to-many relationship) |
| `src/app/api/resolve/route.js` | FR-019 + BR-002/SDD-003 | resolve external ref lookup or human code to internal id |
| `src/app/api/scope/route.js` | FR-001, FR-020 | scope hierarchy CRUD; one-step tenant+business+workspace creation |
| `src/app/api/workspaces/[id]/route.js` | FR-001 | update and archive workspace |

## Notes

- **All 13 routes successfully annotated.** No deviations from the w0-s4-report survey.
- **Special treatment applied correctly:** `/api/resolve` carries both `@req FR-019` and `@spec BR-002, SDD-003` as instructed, covering external-ref lookup (FR-019) and human-code infrastructure (BR-002/SDD-003). `/api/scope` carries `@req FR-001, FR-020` with inline FR-020 comment left untouched on the businessInGroup branch.
- **Format followed:** All annotations placed at file top, above imports, matching the style from `src/app/api/platform/users/route.js`.
- **No other files touched:** Application layer and tests remain untouched (reserved for parallel lane).
