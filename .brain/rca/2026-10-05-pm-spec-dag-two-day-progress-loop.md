# RCA: PM specification DAG progress loop

Date: 2026-10-05
Scope: Progress and review loop in the PM specification DAG, covering the 48-hour history window from 2026-10-03 02:38 through 2026-10-05 02:38 Asia/Bangkok. This is a process RCA; it does not claim a product runtime defect.

## Symptom

The user saw little visible completion after more than two days. The execution plan and local dashboard showed different revisions, while multiple candidate packages were reviewed, held, or re-authored without a matching increase in accepted package count.

## Evidence

- The thread history contains 17 turns in the 48-hour window, with turn starts in 13 distinct hours. The read API timestamps turns, not each command or subagent event; an hour below means a turn started then, not that work lasted exactly one hour. Quiet gaps are not proof that no background work occurred.
- Hourly activity, Asia/Bangkok (turn-start hour):
  - **Oct 3, 14:00** — plan v0.9.34b was written and JSON/hash/receipt invariants checked. A prewrite syntax guard caught a malformed patch before the plan was changed.
  - **Oct 3, 19:00** — MA-D01/MA-D02 and NFR reviews found a newer MA-D02 candidate not selected by the plan and conflicting NFR wording; work shifted to further review.
  - **Oct 4, 09:00** — resumed PMR-032 and MA-D08 review while preserving source files under review.
  - **Oct 4, 10:00** — MA-D02 was reviewable only as candidate material; MA-D01 and MA-D03 were held for stale plan/source pins or dependency lineage.
  - **Oct 4, 11:00** — PMR-025 was held for stale Document 20/plan pins and predecessor labeling; successor preparation was discussed.
  - **Oct 4, 14:00** — MA-D02 investigation found a fixture `patchRef` naming UX v0.4.5b while its hash belonged to UX v0.4.6b; a separate RCA was started.
  - **Oct 4, 15:00** — Terra High returned REWORK after finding two stale MA-D02 source pins (Doc09/Doc11); further plan metadata and candidate checks followed.
  - **Oct 4, 16:00** — the 43-package DAG still showed 3 ACCEPTED, 12 CANDIDATE_READY_FOR_REVIEW, 24 PLANNED, and 4 blocked. The local `origin/main` observation had advanced 39 commits from the worktree base, requiring freshness review.
  - **Oct 4, 18:00** — all 33 plan candidate artifact hashes matched their files; read-only candidate reviews continued, without a plan-pointer change.
  - **Oct 4, 20:00** — a corrected v0.1.7b candidate received Terra High-role GO_WITH_LIMITS and Luna Max PASS on its exact hash; the next step was still plan audit.
  - **Oct 4, 22:00** — exact reviews found MA-D03 still at REWORK/HOLD and exposed a Doc15 statement that PM could write a People calendar.
  - **Oct 4, 23:00** — the People write conflict was documented and Doc15 corrected to v0.3.1b. `npm run govern` first stopped on stale generated views, then passed after regeneration; this was real documentation/governance progress, but did not close the overall DAG.
  - **Oct 5, 01:00** — current-state review found PMR-032 v0.2.6 had 10/25 stale source pins and an older embedded plan snapshot (v0.9.42b versus live v0.9.46b). PMR-031 also had 18/22 current pins. Successor preparation began.
  - **Oct 5, 02:00** — PMR-025 v0.1.8 was finalized at 02:39 after a verified prewrite snapshot taken at about 02:29. Independent postwrite checks found all 44 input pins current and all 11 open questions preserved. It remained unselected at the initial capture; its exact review then returned REWORK/HOLD for one stale provenance field. The later .1.9 successor and review outcome are recorded below.
- The current live plan is v0.9.46b, SHA-256 `9138bb3fde52014c293df613785bf0515527bc42d7793cc9e893654c7bf6c393`: 43 packages; 3 accepted, 12 candidate-ready, 24 planned, 4 blocked; `dispatchable=false` and `implementationAuthorized=false`.
- The open dashboard at `C:\Users\pc\.codex\visualizations\2026\09\29\01a0eb8d-0439-72c1-8685-1f7ba9efd1a6\pm-execution-progress.html` was last written at 01:21:57 on Oct 5 and embeds plan v0.9.45b. It was one revision behind the live plan when checked.
- Existing RCA `2026-10-05-pm-dashboard-refresh-replacement-corruption.md` records a failed dashboard rewrite caused by regex replacement interpreting `$` in the embedded payload; rollback restored the verified preimage before a later successful refresh. Existing RCA `2026-10-04-pmr032-source-pin-and-boundary-drift.md` records the recurring stale-source and mismatched-boundary pattern.

## Root Cause

The execution loop had no enforced freeze-and-compose checkpoint per DAG wave. Source documents and the plan kept advancing while candidates were being reviewed. Reviews bound to older plan/source snapshots then became stale, so the same packages were re-audited or re-authored. For example, PMR-032's review-time candidate pins were 10/25 stale against the live tree, while PMR-025 and PMR-031 also needed successor work after current-pin checks.

A second process gap was that review outcomes were treated as evidence to inspect, but were not consistently followed by one root-owned composition that updated the selected candidate pointer, receipt ledger, package state, and dashboard from the same exact plan revision. This left candidate-only GO/PASS results visible as activity without an accepted-state change. The dashboard's v0.9.45b snapshot lagging live v0.9.46b is direct evidence of that split.

The workflow also spent time retrying authoring/validation tooling after prewrite guards caught patch, JSON replacement, assertion, and offset errors. Those guards prevented some corrupt writes, but the retries compounded the review loop.

## Why the issue escaped detection

- Exact hashes proved which bytes a reviewer saw, but did not keep the reviewed source set current through plan composition.
- The workflow had no bounded retry rule, no source-freeze interval, and no mandatory root composition receipt after a review batch.
- Dashboard refresh did not assert that its embedded plan digest/version matched the live plan.
- Progress was narrated through review calls and command activity rather than the package lifecycle counters, so repeated checks looked like movement while acceptance counts stayed flat.
- Owner, G0, SPEC, and implementation gates correctly remained closed when evidence or authority was missing; the process did not consistently mark those items blocked and move on to independent work.

## Proposed prevention

1. Freeze one exact plan/source snapshot per wave before dispatch. Do not edit its shared inputs while reviewers are working; if a pinned input changes, invalidate only the affected candidate with a recorded reason.
2. After each batch, have the root integrator perform one composition pass: apply exact reviewed pointers/receipts, update package states, recompute DAG counts, then refresh the dashboard from that same plan SHA.
3. Add a dashboard prewrite/readback assertion that the embedded plan version and SHA match the selected live plan. Keep literal replacement and full in-memory JSON validation, as the existing dashboard RCA requires.
4. Bound each candidate to one repair successor and one exact re-review. If it still fails current-source or owner gates, mark it BLOCKED/REWORK and continue with independent DAG work rather than re-running unchanged checks.
5. Report progress by accepted/candidate-ready/planned/blocked counts and artifacts changed per hour. Do not use command count or review count as a completion metric.
6. Keep owner, G0, SPEC, dispatch, and implementation gates closed until their required evidence exists.

## Subsequent review after the initial 48-hour capture

- Luna Max, Terra-role GPT-6-Sol fallback, and Astra independently reviewed PMR-025 v0.1.8 and returned HOLD/REWORK for one provenance error: its historical baseline comparison labeled plan v0.9.44b SHA `b0030ea9…` as `currentWorktreeSha256`, while the live plan was v0.9.46b SHA `9138bb3f…`.
- Terra-role fallback returned GO_WITH_LIMITS and Astra CONCUR_WITH_LIMITS for one immutable metadata-only v0.1.9 successor. v0.1.8 was preserved unchanged.
- PMR-025 v0.1.9 SHA-256 `03207eac2818f469e10bd164543a0dc0db42c45fb5f363965b20604245f103ac` corrected that field. Luna returned PASS, Terra-role fallback GO_WITH_LIMITS, and Astra CONCUR_WITH_LIMITS for the exact bytes. Current source pins were 44/44; the rollback snapshot verified 46/46 protected payloads; all 11 questions remain OPEN.
- The delivery plan remains v0.9.46b and still selects v0.1.4. v0.1.9 is unselected/uncomposed; file-boundary reconciliation, owner decisions and other gates remain open. Remote freshness remains UNVERIFIED.
## Follow-up: PMR-025 composition and execution-tool failures

Observed 2026-10-05, approximately 03:55 Asia/Bangkok. This follow-up supersedes the preceding status only for the PMR-025 pointer: it does not close owner, G0/SPEC, dashboard, or implementation work.

- A separate plan-composition proposal was created for the exact v0.1.9 candidate. Astra found an authority-attribution wording defect in the first proposal; the wording was corrected before the reviewed proposal SHA `eb8c951e017ff94c04d30acb6f417f7211f44839564546b5f22bb3a3a0222f1b` was submitted for decisions.
- On that same corrected proposal SHA, Luna first raised a HOLD concern because the proposal did not repeat every previous review field and the old coordinator reconciliation. After checking that the exact plan preimage was hash-pinned and all supplied before-values matched it, Luna revised the outcome to PASS with a nonblocking documentation caveat. Terra-role GPT-6-Sol returned GO_WITH_LIMITS and Astra returned CONCUR_WITH_LIMITS for that proposal SHA. This is a reviewer-interpretation change on unchanged bytes, not a candidate change.
- Before writing, the rollback snapshot was rechecked: 49/49 payload files and 49/49 archive entries matched; manifest SHA-256 `b3fed07504c460db1210ede0beb7e7324c83abe1b00cdb2c6fb7d81d1fa93534`; archive SHA-256 `0a2898818eee5db388b6c86d3b7d2cc1e2710b28c55acb3bd3637b99b471495a`.
- The first root prewrite validator incorrectly compared the expected post-composition 43/44 source-pin state against the still-unmodified preimage file, observed 44/44, and aborted before writing. The second attempt created only a temporary output file, then Windows returned `EPERM` because the temp handle was opened read-only for `fsync`. The temp was removed and the live plan hash was rechecked as the original preimage. The third attempt opened the temp file read/write, reran the hash and semantic-delta guards, and completed the rename.
- The plan now reads v0.9.47b, SHA-256 `2b83dc3b5f907293848ddf5cc68fee587520c8cba643652ace4347056ae2b08e`. PMR-025 points to candidate v0.1.9 SHA `03207eac2818f469e10bd164543a0dc0db42c45fb5f363965b20604245f103ac`; one root receipt was appended (108 to 109). The DAG remains 43 packages / 90 edges / 13 waves; package states and execution flags are unchanged. The plan pin is now historical, so 43/44 candidate inputs match the post-composition tree. All 11 questions remain OPEN; Q11 remains implementation-blocking; `dispatchable=false` and `implementationAuthorized=false`.
- The open dashboard still embeds v0.9.45b from its 2026-10-05 01:21:57 write, so it is now two plan revisions behind. Dashboard refresh remains a separate task and must use the literal-replacement, prewrite-parse, rollback and readback safeguards in the dashboard RCA.
- The attached execution worktree is detached at `a6e295a5e30b61aa0e6a178454e371d59e053818` and contains 151 modified/untracked paths at this capture. A report-only handoff branch named `codex/pm-spec-issue-analysis-20261005` is being created from that commit so the analysis branch will not accidentally absorb those unrelated dirty files. The branch contains this RCA only; it does not carry the current plan/candidate worktree edits.
- Exact follow-up inputs in the active worktree are: plan v0.9.47b SHA `2b83dc3b5f907293848ddf5cc68fee587520c8cba643652ace4347056ae2b08e`; PMR-025 candidate v0.1.9 SHA `03207eac2818f469e10bd164543a0dc0db42c45fb5f363965b20604245f103ac`; composition proposal SHA `eb8c951e017ff94c04d30acb6f417f7211f44839564546b5f22bb3a3a0222f1b`; direct predecessor v0.1.8 SHA `cefa496ebcc0e778b55957df18378b42a7a701192077a43163fbf9a4bf3a6b78`. The live copies are under `C:\Users\pc\.codex\worktrees\pm-spec-execution\zuri-ai`; the report branch is an analysis record, not a checkout of those dirty bytes.

## Follow-up root cause and prevention

These execution-tool failures did not cause the 48-hour stagnation, and the prewrite guards prevented them from corrupting the delivery plan. They did add avoidable retries during the recovery. The source-pin assertion compared the preimage file to a postimage expectation instead of evaluating the proposed plan bytes. The temporary-file path was validated with a read-only flush handle on Windows. Review status also changed from a blocking interpretation to a nonblocking caveat on an unchanged proposal hash, which forced manual coordinator reconciliation.

For future composition work, compute every postwrite invariant against the in-memory postimage before creating a temp file; exercise Windows flush semantics before the final write; and record one immutable final verdict per reviewer/hash, with any superseded verdict and reason preserved. The existing prevention steps above remain in force: freeze a wave snapshot, batch exact reviews, compose once at root, and refresh the dashboard from the same plan SHA.

## Status

RCA updated for handoff. PMR-025 v0.1.9 is now selected by the candidate pointer in plan v0.9.47b, but remains `CANDIDATE_READY_FOR_REVIEW`, unaccepted, and behind open owner/G0/SPEC gates. This RCA does not change product source code or implementation authorization. The handoff branch contains only this RCA file; the active worktree's other dirty files are intentionally excluded. Dashboard refresh and subsequent DAG tasks remain open.
