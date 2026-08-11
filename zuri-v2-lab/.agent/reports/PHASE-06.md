# Phase 06 — Agent Plan Import + Backup

**Status: PASS**

## Implemented
**PlanEnvelope import** (`src/modules/project-manager/import/`):
- `plan-schema.js` — strict Zod mirror of `contracts/plan-envelope.schema.json` (schemaVersion "1.0", additionalProperties rejected, mode/strategy/dependency-type enums enforced) + semantic validation (duplicate codes, dangling container/parent/dependency refs, self-references, repository-dependency rejection).
- `plan-import-service.js` — read-only dry run resolving the target workspace (explicit id or `scope.workspaceCode`), classifying every entity as insert / update / conflict (cross-workspace project code, cross-project workstream code); commit re-validates, then upserts everything in ONE `prisma.$transaction` (containers two-pass for parent links; dependencies resolved via envelope codes), and records a `PLAN_IMPORTED` AuditEvent with `actorType: AGENT_PLAN`. Conflicts block commit. No plan content is ever executed.
- UI `/projects/[id]/import`: paste JSON → validate+dry-run (insert/update/conflict lists) → confirm import → link to project.

**Backup** (`backup-service.js` + `/backup`):
- Export: full-domain snapshot (schemaVersion, exportedAt, 19 tables incl. audit) downloaded as JSON; EXPORTED audit event.
- Import: preview (incoming vs current counts, wouldReplace flag) → explicit confirmation → transactional delete-children-first / insert-parents-first restore → RESTORED audit event. Never silently overwrites.

## Tests run / results
`tests/unit/plan-schema.test.js` (10) — valid plan, unknown mode/strategy, wrong version, extra props, probability range, dangling refs, duplicates.
`tests/integration/plan-import.test.js` (7) — dry-run purity (no writes), transactional commit with full graph + audit, idempotent re-import as updates, cross-workspace conflict blocks commit, unresolvable workspace rejection.
`tests/integration/backup.test.js` (4) — export shape, invalid snapshot rejection, preview-without-confirm purity, full round trip restore.
**All pass.**

## Known issues
Snapshot restore is a full replace (documented in UI); partial/merge restore is future work.

## Decisions made
Re-import of the same plan upserts (update classification) rather than conflicting — supports iterative agent planning.

## Next phase
Phase 07 — Hardening.
