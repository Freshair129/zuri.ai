# PR #12 semantic conflict repair brief

## Role

You are Luna, the implementation agent for Zuri V2 pull request #12.

## Scope

Work only in `D:\zuri-ai-pr12-conflict`, which is a disposable integration
worktree paused during `git rebase origin/main`. Do not edit `D:\zuri-ai`, do not
read or copy `.env`, and do not push or merge remote branches.

Resolve the two Git conflicts and the requirement/ADR identity collisions they
expose. This is one atomic repair because a partial rename leaves duplicate keys.

## Authority and required mapping

Preserve the first-merged Phase 1 production meanings:

- `FR-051..055`, `NFR-011..013`, `BR-012..014`, `SDD-026..028`,
  `SEC-010..012`, and `ADR-018..020` remain production isolation/readiness/
  controlled-activation keys.
- Rename the later Zuri Landing meaning to `FR-056`, `SDD-029`, `ADR-021`.
- Rename PR #12 MSP authorization to `FR-057`, `NFR-014`, `BR-015`,
  `SDD-030`, `SEC-013`, `ADR-022`.
- Do not use `FR-058`, `BR-016`, `SDD-031`, `SEC-014`, or `ADR-023`; those are
  reserved for an approved local Typed Agent change in the untouched primary
  worktree.

The ID contract in `AGENTS.md` is binding. Rename filenames, frontmatter,
headings, annotations, tests, plans, roadmap references, and cross-references
for only the later Landing and PR #12 meanings. Do not mechanically replace the
production meanings that own the old IDs.

## Conflict procedure

1. Reconstruct the PRD from current `origin/main` plus the first-merged Phase 1
   registry at commit `f196212`, retaining later Landing/PlanEnvelope facts.
2. Resolve `docs/PRD-SDD-v1.0.md` with unique meanings and truthful version
   history. Use `1.43.0b` for the combined PR #12 candidate.
3. Resolve generated `docs/.preflight-report.json` from current-main authority;
   it will be regenerated after source repair.
4. Rename Landing and PR #12 documents/files and update all exact semantic
   references across non-inherited source. Never edit `docs/v1-inherited/`.
5. Continue the rebase non-interactively.
6. Add an RCA under `.brain/rca/` documenting symptom, evidence, root cause,
   escape, prevention, and the mapping above.
7. Run serially: `npm ci` only if dependencies are absent, `npm test`,
   `npm run build`, `npm run docs:preflight`, `npm run docs:graph`, then
   `npm run docs:check`. Regenerate source-derived artifacts; do not hand-edit
   generated graph/traceability outputs.
8. Confirm `git diff --check`, no conflict markers, no duplicate semantic IDs,
   and no secret/URL leakage.

## Output contract

Append a structured report to
`docs/.rwang-tasks/pr12-semantic-conflict-report.md` with status, resulting HEAD,
changed/renamed files, exact mapping, verification results, unresolved concerns,
and explicit confirmation that no push/merge or primary-worktree edit occurred.
