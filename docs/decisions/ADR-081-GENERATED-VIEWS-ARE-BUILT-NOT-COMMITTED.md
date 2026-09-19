---
version: "1.0.0"
created_at: "2026-09-12T22:30:00+07:00,Claude Opus 5"
last_update: "2026-09-12T22:30:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "platform"
  doc_type: "architecture-decision"
  scope: "Generated documentation views stop being committed and become build output verified in CI, and the monorepo provenance graph is retired now that apps/edge is scanned directly — removing a class of merge conflict that was costing more than the artefacts were worth"
---

# ADR-081 — Generated views are built, not committed; the monorepo provenance graph retires

**Status:** Accepted.
**Date:** 2026-09-12
**Decided by:** Owner instruction of 2026-09-12, after a day in which six pull
requests each paid the same toll: *"เอาระบบ graph ทั้งหมดออก แล้วใช้ llms อย่างเดียว
หรือคู่กับ wikilink เพียงพอไหม"* — answered with evidence as "the graph is not the
cost, committing its output is" — then *"เลิก commit ไฟล์ generated แล้วให้ CI
สร้าง+ตรวจเอง"*.
**Relates to:** [ADR-062](ADR-062-ZURI-SERVER-EDGE-MONOREPO-BOUNDARY.md),
[ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md),
[ADR-039](ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md),
FR-124, NFR-008.

## Context

Eleven files in this repository are written by a generator and committed. On
2026-09-12 six pull requests merged in sequence, and the conflict ledger reads:

| PR | conflicts | of which generated |
|---|---|---|
| #352 | 15 | 11 |
| #350 | 15 | 11 (then twice more as `main` moved) |
| #353 | 2 | 2 |
| #356 | 5 | 5 |

A three-file CI change collided twice on `domain-state.json` alone. None of
these were disagreements about anything a person wrote: two branches ran the
same generator over different inputs, and git was asked to reconcile the output.

Two things about that cost were discovered rather than assumed.

**It is not the graph's fault.** The `verify` job — which runs the whole
governance chain — passed on every branch all day. What failed was merging
committed *output*. The preflight checks that actually catch defects (21
CRITICAL families: `schema-migration-drift`, `membership-writer`,
`viewer-fixture`, `route-anchor`, `id-stability`…) mostly do not read the graph
at all; they scan source directly. Deleting the graph system would have
surrendered real guards to fix a problem the guards were not causing.

**Timestamps were half of it, and that half is already fixed.** #354 removed
`generatedAt` from both domain-state files, and the very next merges stopped
conflicting on them. That is the model this ADR generalises: an artefact that
is not committed cannot go stale, and one that is committed must at least be
reproducible.

Separately, `monorepo-graph.mjs` merges Server's graph with the Edge graph that
arrived with the ADR-062 snapshot import, re-verifying 599 files against
`source-manifest.json`. It is 3.9 MB, was regenerated 244 times in six days, and
**nothing downstream reads it** — the only readers are its own `--check` and one
unit test. Meanwhile the 38 Edge files added since the import were invisible to
it, which is how FR-189 came to be reported as `🔜 planned · code —` while
running in production.

## Decision

**D1 — Generated documentation views are no longer committed.** `docs/.doc-graph.json`,
`docs/.domain-state.json`, `docs/.preflight-report.json`, `docs/FEATURE-MAP.md`,
`docs/DOMAIN-MAP.md`, `docs/TRACE.md`, `docs/DOCUMENT-LINKS.md` and
`docs/appendices/D-traceability.md` are build output. CI generates them before
anything reads them and fails on a preflight CRITICAL, which is the check that
was ever worth running.

**D2 — Three files stay committed, for stated reasons, and the reasons are the test.**

| file | why it stays |
|---|---|
| `apps/server/runtime/domain-state.json` | `product-readiness-read-model.js` imports it, and the Docker build context is `apps/server/` — the repo-root `docs/` it is generated from is not in the image. It cannot be rebuilt at image build time |
| `llms.txt` | hand-written index, not generated |

A file may only join this list with a reason of that kind. "It is convenient to
read on GitHub" is not one; that is what a CI artefact is for.

> **Amended before merge, by the owner's instruction** — *"แก้ generated ถ้าแก้ไม่ได้
> แก้ยากแก้เย็น เอาออกไปให้หมดจบๆไป"*: remove them all, and be done.
>
> `llms-full.txt` was in the table above with a genuine argument — its purpose is
> to be readable without a checkout. The merge ledger overruled the argument. It
> conflicted on **four of the five** pull requests merged that day, more often
> than any other single file, because it inlines README, CLAUDE.md, AGENTS.md,
> PRODUCT.md and every charter: an edit to any one of them rewrites it whole.
> It is now built in CI and uploaded as the `llms-full` artefact, which serves a
> reader without a checkout at least as well as a committed file that was
> regularly wrong between merges.
>
> `apps/server/runtime/domain-state.json` stays, and the reason is not "hard to
> change" but "removing it breaks the production build": `src/` imports it, and
> the Docker build context excludes the `docs/` tree it derives from, so
> `next build` inside the image cannot produce it. It also stopped being part of
> the problem — since #354 removed its run timestamp it has not conflicted once.
>
> Net effect: **one** generated file remains in git, for a reason that is a
> build constraint rather than a preference, and it no longer churns.

**D3 — The staleness gates retire with the artefacts they guarded.** The CI steps
"Committed graph is current", "Relocated graph is committed and current" and the
generated-views diff exist to catch a committed copy drifting from its source.
With no committed copy there is nothing to drift. What survives is the check
inside `govern` — regenerate, then compare — which catches a *non-reproducible
generator*, a different and still-real defect.

**D4 — `monorepo-graph.mjs` and `docs/.monorepo-graph.json` are retired.** Its
provenance proof covered a frozen 599-file set and missed everything added
since. `doc-graph.mjs` now scans `apps/edge/src` and `apps/edge/tests` directly,
which is live coverage rather than a re-proof of a six-day-old import.

**D5 — `source-manifest.json` is kept as a frozen historical record and is no
longer verified on every push.** It answers "where did this file come from",
which is worth keeping and is not worth re-deriving 244 times a week.

**D6 — The `edge::` qualifier is NOT retired.** Edge owns 46 ids minted in
another repository whose numbers overlap this one's with different meanings —
Edge `FR-004` is `send <template> --group <alias>`, Server `FR-004` is Workstream
CRUD. ADR-039 forbids renumbering either side, so the collision is permanent.
The qualifier is the one part of `monorepo-graph.mjs` that was load-bearing.

## Consequences

A fresh clone has no `docs/.doc-graph.json` until `npm run govern` runs, and the
tests that read it require that order. CI already runs governance before tests
(#354 moved them); locally, `npm run verify` does the same. A contributor who
runs `npm test` first in a clean clone gets a clear failure rather than a wrong
answer, which is the acceptable side of that trade.

`TRACE.md` and `FEATURE-MAP.md` stop being browsable on GitHub. That is a real
loss, taken deliberately: they were browsable and wrong often enough that the
conflict resolutions regenerated them anyway, and anyone who needs them can run
one command or read `llms-full.txt`, which stays.

What this does not do: none of the 21 preflight CRITICAL families is weakened,
because none of them depended on the committed copy. The guards that caught four
separate defects in a single pull request earlier the same day — a hand-copied
enum, two stale API-appendix counts, and a route that skipped
`assertDomainVisible` — all still run, and still fail the build.
