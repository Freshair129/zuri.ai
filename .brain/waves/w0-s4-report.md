# W0-S4 — survey: import / projects / repositories / scope API

| Route | Verdict | Requirement | Evidence | Source (registry \| sibling annotation) | Confidence |
|---|---|---|---|---|---|
| `src/app/api/import/dry-run/route.js` | EXISTING | FR-012 (also FR-019) | Delegates to `plan-import-service.dryRunPlan`, which is annotated `@req FR-012, FR-019`. FR-012 = "PlanEnvelope import: validate → seven-mode semantic contract check → dry run → transactional commit → audit" — this route *is* the dry-run leg of exactly that pipeline. | sibling annotation (`plan-import-service.js:6`) + registry (FR-012, PRD-SDD-v1.0.md:127) | High |
| `src/app/api/import/commit/route.js` | EXISTING | FR-012 (also FR-019) | Same delegation, to `commitPlan` in the same file/annotation block — the transactional-commit leg of FR-012's pipeline. | sibling annotation (`plan-import-service.js:6`) + registry | High |
| `src/app/api/import/template/route.js` | EXISTING | FR-018 | Route already carries an inline comment `// FR-018 — download the intake workbook (generated from Zod enums; no drift).` and delegates to `xlsx-template.js`, whose FR in TRACE.md's FR-018 entry lists `xlsx-template.js` as Code. | registry (TRACE.md:132-137) + route's own inline note | High |
| `src/app/api/import/xlsx/route.js` | EXISTING | FR-018 (also FR-012 via dry-run) | Route's own inline comment: `// FR-018 — upload a filled template: convert (per-row errors) then dry-run.` Delegates to `xlsx-convert.js` (FR-018 code) and then `plan-import-service.dryRunPlan` (FR-012). | route's own inline note + sibling annotations | High |
| `src/app/api/projects/route.js` | EXISTING | FR-003 | Delegates to `project-service.listProjects` / `createProject`; the file is annotated `@req FR-003, FR-004 — project CRUD/archive + workstream mode/strategy/weight`. FR-003 registry text: "Project CRUD + archive (soft delete) + mixed execution modes" — this route is the list/create half. | sibling annotation (`project-service.js:12`) + registry (PRD-SDD-v1.0.md:118) | High |
| `src/app/api/projects/[id]/route.js` | EXISTING | FR-003 | Same file/annotation via `getProject` / `updateProject` / `archiveProject` — the detail/update/archive half of FR-003. | sibling annotation (`project-service.js:12`) + registry | High |
| `src/app/api/repositories/route.js` | EXISTING | FR-008 | Delegates to `repository-service.listRepositories` / `createRepository`; file annotated `@req FR-008 — repository records + many-to-many project links`. FR-008 registry text: "Repository records (local metadata) + ผูกโปรเจกต์แบบ many-to-many". | sibling annotation (`repository-service.js:6`) + registry (PRD-SDD-v1.0.md:123) | High |
| `src/app/api/repositories/[id]/route.js` | EXISTING | FR-008 | Same file, `updateRepository` — repo metadata update half of FR-008. | sibling annotation | High |
| `src/app/api/repositories/link/route.js` | EXISTING | FR-008 | Same file, `linkRepository` — the many-to-many link half of FR-008 explicitly. | sibling annotation | High |
| `src/app/api/repositories/link/[id]/route.js` | EXISTING | FR-008 | Same file, `unlinkRepository` — unlink half of the same many-to-many relationship. | sibling annotation | High |
| `src/app/api/resolve/route.js` | EXISTING (split route, see note) | FR-019 (system/value branch); no dedicated FR for the type/code branch | The `system`/`value` branch calls `lookupExternalRef`/`listExternalRefs` from `external-ref.js`, annotated `@req FR-019 — validate a customer's existing core ids against our records`, and TRACE.md's FR-019 entry lists `external-ref.js` as Code. The `type`/`code` branch (human code → internal id, no ExternalRef involved) is not itself an ExternalRef lookup — it is generic infrastructure resting on BR-002/SDD-003 ("UUID PK + human code (unique)... code ใช้อ้างใน Excel/envelope ได้"), which are a business rule and a design decision, not a functional requirement. Appendix A documents the two query shapes separately: `?type=&code=` under "Project core" (no FR cited) vs. `?system=&value=` under "Intake surfaces (FR-017..FR-020)" tagged FR-019. | registry (A-api-spec.md:108,150; TRACE.md:139-144) + sibling annotation (`external-ref.js:3`) | Medium — high for the system/value half, but the route is genuinely two behaviors merged into one handler |
| `src/app/api/scope/route.js` | EXISTING | FR-001 (POST `businessInGroup` branch also touches FR-020) | Delegates `listScope`/`createPortfolio`/`createTenant`/`createBusiness`/`createWorkspace`/`createLegalEntity`/`createBranch` to `scope-service.js`, file-annotated `@req FR-001 — scope hierarchy CRUD (portfolio/tenant/business/branch/workspace)`. FR-001 registry text: "จัดการ scope hierarchy: Portfolio / Tenant / Business / Branch / LegalEntity / Workspace (CRUD + human codes)" — this route is literally that CRUD surface. TRACE.md's FR-001 entry lists `scope-service.js` as Code, no separate route citation, but no other route delegates to this service either. One dispatch target, `createBusinessInGroup`, carries its own inner `@req FR-020` doc-comment (the "เพิ่มธุรกิจ" one-step create). | registry (PRD-SDD-v1.0.md:116; TRACE.md:11-16) + sibling annotation (`scope-service.js:14`, `:92`) | High — see note below on why this contradicts the "likely NONE" expectation |
| `src/app/api/workspaces/[id]/route.js` | EXISTING | FR-001 | Delegates `updateWorkspace`/`archiveWorkspace`, both defined in the same `scope-service.js` file under the FR-001 annotation block (Workspace is explicitly one of the six entities named in FR-001's text). | sibling annotation (`scope-service.js:14`) + registry | High |

## Routes needing a new requirement

None of the 13 assigned routes came back NONE. Every route's delegate module carries
an `@req` that the route's own behavior matches (or, for `template`/`xlsx`, the route
file itself already has an inline `FR-018` comment that just needs promoting to the
canonical annotation format). The one open item is the split inside `/api/resolve`
described below — it does not need a *new* FR, but whoever annotates the file should
decide whether to cite `@spec BR-002, SDD-003` alongside `@req FR-019` to cover the
type/code branch, rather than inventing a new id for what is existing human-code
lookup infrastructure.

## /api/resolve and /api/scope

**`/api/resolve`** serves two different lookups behind one `GET` handler, selected by
which query params are present. `?system=&value=` is the FR-019 Enterprise API path:
it turns a customer's own external id (their core/ERP/GitHub id, etc.) into our
internal id via the `ExternalRef` table, and is exercised by the enterprise
integrator persona documented in PRD-SDD-v1.0.md line 107 ("upsert ผ่าน API ด้วย
external ID ของระบบตัวเอง ไม่ใช้ UI"). `?type=&code=` is a different, older lookup:
it turns *our own* human-readable code (e.g. `PRJ-0007`) into the internal UUID for
one of eight entity types (`TYPE_MODEL` map), which is the mechanism BR-002/SDD-003
describe ("code ใช้อ้างใน Excel/envelope ได้" — codes are usable as references in
Excel/envelope). It's consumed wherever a caller only has a human code and needs the
internal id before calling another endpoint (e.g. Excel/envelope processing, and
potentially UI deep-links). Verdict: the system/value half is squarely FR-019; the
type/code half is real, working infrastructure but is not itself named by any FR — it
supports BR-002/SDD-003 as a `@spec`, not a `@req`. No new FR is needed; annotate with
`@req FR-019` plus `@spec BR-002, SDD-003` to cover both branches honestly, or split
the file if the annotator wants one FR per branch (not required — `@req` can list more
than one id, and this route is small).

**`/api/scope`** is more consequential than the task brief's hint suggested. It is not
UI-orphaned infrastructure — it is the *only* implementation of `listScope` and of
create for six of the six entity types named in FR-001's text (Portfolio, Tenant,
Business, Branch, LegalEntity, Workspace), and `scope-service.js` (the sole module it
delegates to) already carries `@req FR-001` at the top of the file specifically
because of this route's behavior — no other route touches `scope-service.js`'s
`listScope`/`createPortfolio`/`createTenant`/`createBusiness`/`createLegalEntity`/
`createBranch`. Appendix A's caveat ("Internal broad scope-management compatibility
interface; entry surfaces do not request it. Production hardening remains separately
gated.") is about `/api/scope` no longer being on the `/businesses` *entry* path after
FR-046/SDD-024 rerouted that flow through `/api/entry` — it is not a statement that
the route implements no requirement. The route is still live, is still the only way
the app creates a Portfolio/Tenant/Business/Workspace/LegalEntity/Branch, and its
`businessInGroup` branch is the literal implementation of FR-020 ("เพิ่มธุรกิจ": one-step
tenant+business+workspace creation). Recommendation: annotate `@req FR-001` (primary)
with a note that the `businessInGroup` case also serves FR-020, rather than treating
this as a route needing a new requirement.

## Notes and doubts

- **Method used throughout:** for every route except `import/template` and
  `import/xlsx` (which already carry inline FR comments), the strongest signal was
  the `@req` annotation on the delegate module in `application/` or `import/`, cross-
  checked against the registry text in `docs/PRD-SDD-v1.0.md` and, where present,
  against the generated `docs/TRACE.md` entry's `Code:` file list. In every case the
  registry text was a semantic match for what the route actually does (not merely
  adjacent), so confidence is High except for `/api/resolve`.
- **`/api/resolve` is the one route in this batch that is genuinely two behaviors
  wearing one file.** If preflight's route-annotation check expects a single clean
  `@req` per route, the honest move is `@req FR-019` plus a `@spec BR-002, SDD-003`
  note rather than forcing a second FR into existence for the human-code branch.
- **`/api/scope` deliberately contradicts the task brief's steer** ("most likely NONE
  verdicts"). I verified this three ways — the file-level `@req FR-001` comment in
  `scope-service.js`, the registry text at PRD-SDD-v1.0.md:116, and the generated
  `docs/TRACE.md` FR-001 entry naming `scope-service.js` as the FR's only Code file
  — and all three agree the route is FR-001's CRUD surface, not orphaned
  infrastructure. Flagging this explicitly in case the wave lead wants a second
  opinion before annotating it.
- **FR-020 co-citation on `/api/scope`:** `createBusinessInGroup` has its own doc-
  comment `@req FR-020` inside `scope-service.js` (separate from the file-level
  FR-001 block). Since `/api/scope`'s POST handler dispatches to it via the
  `CREATORS` map, the route technically serves both FR-001 and FR-020 depending on
  `body.entity`. I recorded FR-001 as primary since it's the file's own top-of-file
  annotation and covers 6 of 7 dispatch targets; FR-020 is worth a secondary
  citation if the annotation format supports multiple ids (it does, per CLAUDE.md's
  `@req FR-020` example already showing comma-separated ids elsewhere in this repo).
- **No BR-009/SDD-009 single-transaction claim was needed for `/api/projects`,
  `/api/repositories`, `/api/scope`, or `/api/workspaces/[id]`** — those are direct
  CRUD services, not intake-envelope surfaces, so BR-009's "every intake surface
  converges on one envelope" does not apply to them; only the four `/api/import/*`
  routes are part of that pipeline, confirming the task brief's expectation there.
- I did not find any route in this batch of 13 that lacks registry coverage. If the
  wave lead disagrees with the FR-001/FR-019 splits above for `/api/scope` or
  `/api/resolve`, those are the two to re-litigate — everything else (import x4,
  projects x2, repositories x4, workspaces x1) is unambiguous.
