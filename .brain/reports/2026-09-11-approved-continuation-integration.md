---
version: "1.0.1b"
created_at: "2026-09-11T05:29:00+07:00,RWANG"
last_update: "2026-09-11T06:23:00+07:00,RWANG"
status: beta
---

# Approved continuation integration

The owner's "merge and approve" instruction approved the three bounded contracts
following PR #319. PR #319 is merged at `196e4a9a`; this continuation incorporates
the subsequent documentation-only PR #320 (`e35fe604`) and regenerates its
`llms-full.txt` companion. The shared primary checkout and old dirty source
worktrees remain untouched. The work ran with three GPT-5.6 Luna Max agents and
one central integrator in independent worktrees.

## Delivered behavior

- FR-184: persisted NONE/LOT Stocktake previews and results, shared ledger fence,
  stale/incomplete refusal, exact-key commit replay, saved-result history and
  mobile UI. Restore reconciles every claimed adjustment against exported
  StockMovement identity, scope, kind, reference and line quantities; malformed
  snapshots cannot erase current evidence.
- FR-185: Business-scoped immutable broadcast planning revisions, real Content
  and LINE account pickers, retained create key after response loss, revise and
  archive history. Invalid stored revisions remain readable with Edit disabled.
  Paid Media and AskMarketing expose unavailable measurements explicitly.
- FR-171: default-off immutable per-job primary LINE worker memory enrollment,
  scoped MSP context, mandatory injection receipts, atomic accepted-message
  checkpoint and leased delivery recovery. UNKNOWN injection outcomes preserve
  uncertainty without sending or invoking the model again.

Integration preserves all three recovery manifests and warning accumulation.
Source route/database/interface inventories and both generated graph scopes are
reconciled. IDs remain pinned: FR-182 SCM, FR-183 POS, FR-184 Stocktake, FR-185
Marketing planning, FR-186 Billing. No published subject was repurposed.

## Verification

Evidence root:
`C:/Users/pc/.codex/visualizations/2026/09/10/01a08aba-fa9c-7a51-9e67-415f939bd9ac`.

| Gate | Result and provenance |
|---|---|
| Stocktake browser | 3/3 passed, including response loss/retry, stale fence and delayed Business/history reads |
| Marketing browser | 4/4 passed plus the full route warmup; no retries/flaky results; `approved-marketing-four-green.log` |
| Full browser regression | 161 passed / 4 skipped, zero failure/flaky, 10.5 minutes; normal fail-on-flaky gate retained; `approved-final-e2e.log` |
| Lifecycle regression | 6/6 integration tests after two reproduced failures; `approved-marketing-lifecycle-green.log` |
| Stocktake restore | 7/7 integration tests, including missing/wrong movement evidence, null/non-array fields, post-count balances, later ledger writes and aggregate variance above Int32 |
| Route inventory/navigation | 42/42 tests across five files; exact path/method coverage and ordering retained |
| Actual MSP contract | 1/1 passed against MSP `e4303cb7` and this integration tree; `approved-cross-msp-final.log` |
| Server full suite | 4,682 passed / 15 skipped; 576 passed files / 5 skipped; `approved-final-tests-verified.log`; zero-test guard confirmed execution |
| Server production build | PASS; `approved-final-build.log`; subsequent source changes are test fixture selection and documentation only |
| Governance | Reconciled strict gate passed; final regeneration/check recorded in `approved-commit-govern.log` |
| SQLite/PostgreSQL | All three additive migrations executed in disposable databases; parity, FK/index, SQLite integrity, RLS/FORCE and runtime/web grant probes passed; `approved-migrations-qa/` |
| Edge | No Edge changes relative to PR #319; prior 944 passed / 3 skipped, build/typecheck and native lifecycle proof remain applicable; current Server tests exercise the Edge consumer contract |

The six continuation migration hashes were rechecked after source integration
and still match the isolated execution manifests. No production database or
runtime was used. The disposable PostgreSQL container was removed. Mobile
screenshots were inspected at `fr184-stocktake-mobile.png` and
`fr185-broadcast-mobile.png` in the evidence root.

## Review and release boundaries

Independent reviews closed the Stocktake, Marketing and memory integration
findings. Marketing parent pages key their workspaces by Business, so a Business
change unmounts pending requests and local selection state. The malformed
revision Edit regression was reproduced before its guard was fixed. Source
inventory failures exposed a real OpenAPI omission and were repaired alongside
the exact expected route lists, without weakening coverage.

Production deployment, migration, LINE sending, advertising spend, real payment
execution and runtime activation are excluded. Primary-worker opt-in activation
also requires MSP erasure/retention API and distributed fence/receipt acceptance:
the final local-read-to-network interval is not atomic. Broader memory onboarding,
policy inspector, runtime hosting and Marketing measurement/dispatch/consent
phases remain separately scoped work. Local fixtures do not prove live delivery.

Hosted CI is checked on the exact final PR head before merge; its result belongs
to the PR, not to the earlier source-lane test reports.

## Concurrent main reconciliation

PR #321 merged at `35b86021` while PR #323 head `12fd48f1` was in hosted E2E.
The incoming change adds approved ADR-075/FEAT-026/FR-187..FR-189 planning and
fixtures. The merge retains both registry histories, all approved subjects and
generated views; Server/Edge application source and migrations remain identical
to the locally verified `12fd48f1`. The local full-suite/browser evidence above
belongs to that application source revision. Registry/document checks, build,
governance and llms-full freshness are rechecked after reconciliation, and
hosted CI runs against the new head. Incoming catalog implementation is not
claimed delivered by this continuation.
PR #322 (`c8be486a`) then added the llms-full CI freshness gate and corresponding
CLAUDE instructions. Both are retained; the corpus is regenerated against the
combined documentation before the new head is pushed. The superseded head's
unfinished CI is not represented as a completed E2E result.

Version diff 1.0.0b -> 1.0.1b: retain exact evidence provenance while reconciling
the concurrently approved main planning change; production boundaries remain explicit.
