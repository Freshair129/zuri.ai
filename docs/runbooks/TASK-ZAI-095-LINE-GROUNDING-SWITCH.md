---
version: "0.1.0"
created_at: "2026-09-27T00:00:00+07:00,Claude Sonnet 5"
last_update: "2026-09-27T00:00:00+07:00,Claude Sonnet 5"
status: "beta"
superseded_by: null
attributes:
  domain: "knowledge"
  doc_type: "runbook"
  scope: "TASK-ZAI-095 — owner-triggered switch of one SmartGift DIRECT LINE OA account from BUSINESS_KNOWLEDGE to GKS_THEN_BUSINESS_KNOWLEDGE, its shadow-compare window, and rollback"
---

# TASK-ZAI-095 — LINE OA grounding-mode production switch runbook

## What this is, and what it is not

This is the operator runbook for **TASK-ZAI-095** (`docs/roadmap/ROADMAP.md`,
`docs/roadmap/ROADMAP-zuri-ai-24w-program.md` container `TC-TASK-ZAI-095`): switching one
SmartGift DIRECT LINE OA account's `knowledgeGrounding` mode from `BUSINESS_KNOWLEDGE` to
`GKS_THEN_BUSINESS_KNOWLEDGE`, running a shadow-compare window, recording it, and rolling
back on regression. It implements the procedure ADR-090 D5 and
[the design doc](../plans/LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md) §10.1
Phase 3 describe at a design level and TASK-ZAI-095's own DoD names — it does not add any
new capability. Every write this runbook performs goes through the existing
`CONFIGURE_KNOWLEDGE_GROUNDING` service action (`line-oa-account-service.js`), never a raw
SQL `UPDATE`, so the audit trail (`AuditEvent`, action
`LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED`) is preserved both for the switch and for
the rollback.

**This runbook does not claim TASK-ZAI-095's blockers are resolved.** TASK-ZAI-095 depends
on TASK-ZAI-094 (done — isolated acceptance, PR #470/#473), **TASK-ZAI-042** (SmartGift
catalog convergence through the 17-stage adapter — `docs/roadmap/ROADMAP.md` row: **in
progress**, not done) and **TASK-ZAI-050** (activate the 17-stage runtime on production
beyond the isolated profile — `docs/roadmap/ROADMAP.md` row: **planned**, not started as a
tracked task, though `docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md` §9.2 records that the
runtime it describes is separately observed running in production as of 2026-09-24). Read
the current status of both rows in `docs/roadmap/ROADMAP.md` yourself before starting
Preflight below — do not trust this paragraph's snapshot, it will go stale.

## Roles

| Role | Does |
|---|---|
| **Owner** | Triggers the switch (D-5/ADR-090 D5: "switching is an owner-triggered operator step"). Decides the campaign-window duration (see "The one open decision" below). Approves the rollback if triggered by someone else's finding |
| **Operator** | Runs the preflight inspection, applies the `CONFIGURE_KNOWLEDGE_GROUNDING` action, collects shadow-compare evidence, records the switch and any rollback in `docs/DB-MIGRATION-NOTES.md` and the `TC-TASK-ZAI-095` changelog |
| **Business OWNER or `LINE_OA_PUBLISHER`** on the target Business | The authority `applyLineOaAccountAction` requires (`assertMayPublish`) to actually call `CONFIGURE_KNOWLEDGE_GROUNDING` — the Operator must either hold this role or have the owner/publisher perform the PATCH |

## The one open decision this runbook will not guess

**How long is "one campaign window"?** Neither the design doc nor ADR-090 gives a number of
days or a specific SmartGift campaign. `docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md`'s own
CHANGELOG names the same gap for its Phase 5 condition ("both campaign windows' dates must
be written down, or the Phase 5 condition cannot be evaluated"). **This is an owner
decision, not an engineering default** — do not pick a duration and proceed as though it
were specified. Get the owner to name the window (a specific SmartGift campaign's start/end
dates) before Step 3 below, and write the dates into the shadow-compare evidence record and
the `TC-TASK-ZAI-095` changelog.

## Step 0 — Read the current blockers yourself

Before anything else:

1. Open `docs/roadmap/ROADMAP.md` and read the current rows for TASK-ZAI-042 and
   TASK-ZAI-050 (search for `TASK-ZAI-042` and `TASK-ZAI-050`). If either is not `done` /
   `merged` / equivalent, **stop here** — TASK-ZAI-095's own dependency list names both, and
   ADR-090 D5 is explicit that SmartGift only goes first "after ADR-075 Phase 3 has deployed
   MSP, GKS and the GenesisBlock worker beside the web container."
2. Cross-check against `docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md` §9 (the Phase 3
   pre-deploy gate, G-1..G-9) and its §9.2 "Current state" note — the deployment design and
   the roadmap task rows have drifted from each other before (that is exactly why this
   section exists); read both and do not resolve the discrepancy by assumption. If they
   disagree, that disagreement is itself a reason to stop and ask the owner, not a reason to
   pick the more convenient reading.
3. Confirm with the owner directly that TASK-ZAI-042/TASK-ZAI-050 are considered resolved
   for the purpose of this switch, even if the roadmap file has not been updated yet. Record
   that confirmation (who, when) in the changelog entry Step 5 describes.

## Step 1 — Preflight: run the read-only inspection script

```bash
cd apps/server
DIRECT_URL="<production direct connection string>" \
  node scripts/ki17-line-grounding-inspect.mjs /tmp/ki17-grounding-inspect-$(date +%Y%m%d).json
```

Use `DIRECT_URL`, never the pooler `DATABASE_URL` — the pooler role is missing grants this
repo's migration notes already document, and `readonly-supabase-preflight.mjs` (the pattern
this script follows) makes the same choice. The script performs no write of any kind; it
only queries `LineOaAccount`, `LineConversationJob` and `AuditEvent`.

Read the report for:

- **Every `LineOaAccount` row**, its `knowledgeGrounding` value, `businessId`/`businessCode`/
  `businessName`, and `isSmartGiftBusiness`.
- **`recentAudienceKindCounts` / `recentDirectJobShare`** — the best-effort signal for which
  SmartGift account is the "DIRECT" one ADR-090 D5 and the design doc mean. **Read the
  report's own `notes` field first**: `LineOaAccount` has no stored "DIRECT account" column;
  `DIRECT` is `LineConversationJob.audienceKind` (a 1:1 chat, as opposed to `GROUP`/`ROOM`),
  recorded per job, not per account. A `recentDirectJobShare` near 1.0 over a representative
  window is evidence, not proof; if it is `null` (no recent jobs at all) or ambiguous, ask
  the owner which account is meant rather than guessing from the number alone.
- **`knowledgeGroundingAuditHistory`** for the candidate account — this must be empty, or
  its most recent entry's `to` must already be `BUSINESS_KNOWLEDGE`, before you proceed. A
  non-empty history with a different current mode means someone already switched this
  account; do not switch it again without finding out why the roadmap/changelog does not
  reflect that.
- **`queryFailures`** (if present) — a named query that failed (e.g. a missing column) means
  the report is incomplete for that section; do not treat a partial report as a clean one.

Record the exact account id, code and Business you intend to switch, and the pre-switch
report file, before Step 2.

## Step 2 — Enable the corpus-first mode for the chosen account

This is the one production write this runbook performs, and it goes through the existing,
audited, version-checked (compare-and-swap) service action — never a raw SQL `UPDATE`
against `LineOaAccount.knowledgeGrounding`.

**Via the API** (what the console UI's grounding control in
`LineStudioAccountConsole.jsx` calls), as a session with Business OWNER or
`LINE_OA_PUBLISHER` authority on the target Business:

```
PATCH /api/line-oa/accounts/{accountId}
Content-Type: application/json

{
  "action": "CONFIGURE_KNOWLEDGE_GROUNDING",
  "knowledgeGrounding": "GKS_THEN_BUSINESS_KNOWLEDGE",
  "version": <the account's current "version" from Step 1's report>
}
```

**Via the console UI:** LINE OA Studio → the target account → the grounding-mode control
(`LineStudioAccountConsole.jsx`) → select "GKS_THEN_BUSINESS_KNOWLEDGE" → save. This is the
same write, through the same route, under the same authority check — prefer it when a human
is present, since it surfaces the account's live `version` for you instead of requiring you
to have carried it over from Step 1's report by hand.

Either path is handled by `applyLineOaAccountAction` (`line-oa-account-service.js`):

- It fails closed with `409 LINE_OA_ACCOUNT_VERSION_CONFLICT` if `version` is stale — re-read
  the account and retry with the current version rather than forcing it.
- It fails closed with `409 LINE_OA_ACCOUNT_ARCHIVED` if the account was archived since
  Step 1.
- It fails closed with `409 LINE_OA_KNOWLEDGE_GROUNDING_UNCHANGED` if the account is already
  in the target mode (this should not happen if Step 1's audit-history check passed).
- On success it writes the `LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED` `AuditEvent` with
  `payload.from`/`payload.to` — this is the row Step 1's inspection script will find on a
  later run, and the row that proves the switch happened, when it happened and under which
  actor.

**Nothing else changes.** `GKS_THEN_BUSINESS_KNOWLEDGE` tries the published corpus first and
falls back, per job, to `business_knowledge` on `GKS_UNAVAILABLE` or zero results, recording
`EVIDENCE_SELECTED{source, reason}` on the job's trace either way — the model is still never
called without evidence. Customers on the edge execution path (CH-01, `executionMode:
EDGE`) are unaffected regardless: this switch only changes what a **SERVER**-executed job's
answer is grounded in. Confirm from Step 1's report (or `GET /api/line-oa/accounts/{id}`)
that the chosen account actually runs `executionMode: SERVER` — switching a mostly-EDGE
account's mode would produce shadow-compare evidence with almost no SERVER traffic to
compare.

## Step 3 — Shadow-compare window

For the duration the owner names (see "The one open decision" above):

1. For each SERVER-executed job answered by the switched account, read its trace
   (`GET /api/line-oa/jobs/{id}/trace`) for the `EVIDENCE_SELECTED` events. Record, per job:
   the `source` actually used (`GKS_CORPUS` vs. `BUSINESS_KNOWLEDGE` vs. `NONE`), the
   `reason` on a fallback, and (per the design doc §5.1) the `retrievalRefs`
   (`citationId`/`sourceId`/`snapshotId`/`generation`) when the corpus was used.
2. Compare the corpus-grounded answer against what `business_knowledge` would have answered
   for the same question. The design doc does not specify an automated side-by-side compare
   tool as already built — if the sibling shadow-compare harness under
   `apps/server/src/modules/knowledge/` exists by the time you run this step, use it and
   record its own report format; if it does not yet exist, do the comparison manually from
   the trace evidence above and record it the same way.
3. Keep the evidence: which accounts ran SERVER execution during the window (the DoD's
   success criterion names this explicitly — "recorded and names which accounts ran SERVER
   execution, because customers on the edge path (CH-01) are not affected"), the count of
   `GKS_CORPUS` vs. `BUSINESS_KNOWLEDGE` vs. `NONE` answers, any answer mismatch found, and
   the campaign window's actual start/end dates. Store this evidence file alongside this
   runbook's changelog entry (a path under `.brain/reports/` following this repo's existing
   convention, e.g. `.brain/reports/<date>-task-zai-095-shadow-compare.md`).

## Step 4 — Rollback (on regression, or at the owner's instruction)

Flipping back is the same audited action, in reverse — never a raw SQL `UPDATE`:

```
PATCH /api/line-oa/accounts/{accountId}
Content-Type: application/json

{
  "action": "CONFIGURE_KNOWLEDGE_GROUNDING",
  "knowledgeGrounding": "BUSINESS_KNOWLEDGE",
  "version": <the account's current version>
}
```

This restores today's behavior and today's traces immediately — the fallback logic already
means `BUSINESS_KNOWLEDGE` mode never attempts a corpus read, so there is no "draining" step
and no data to migrate back. The rollback itself produces a second
`LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED` `AuditEvent` row (`from:
GKS_THEN_BUSINESS_KNOWLEDGE`, `to: BUSINESS_KNOWLEDGE`) — re-running
`ki17-line-grounding-inspect.mjs` afterward should show exactly this as the account's most
recent history entry, which is the read-only proof the rollback took effect.

Nothing about the corpus, MSP, GKS or GenesisBlockDB is torn down by this rollback — GKS
data is never deleted (ADR-072 D5/D11; §3.3 of the design doc), and this switch never wrote
anything into GKS in the first place (it is read-only against the published corpus). A
rollback here is purely "stop reading it for this one account."

## Step 5 — Record the switch (and any rollback)

Per the DoD's exit criterion ("the switch and any rollback are recorded in the migration
notes and this container's changelog"):

1. **`docs/DB-MIGRATION-NOTES.md`** — add an entry following the existing "Applied — …"
   section style (see e.g. "Applied — knowledge candidate Business gate (TASK-ZAI-099,
   2026-09-15)"): date, account id/code and Business, the pre- and post-switch
   `knowledgeGrounding` values, who triggered it (owner) and who executed it (operator), and
   a pointer to the shadow-compare evidence file from Step 3. If a rollback happened, add a
   second dated entry the same way — do not edit the switch entry in place to hide that a
   rollback occurred.
2. **`TC-TASK-ZAI-095`'s changelog** (`apps/server/src/modules/platform-control/program-roadmap-containers.js`,
   and mirrored in `docs/roadmap/ROADMAP-zuri-ai-24w-program.md`) — append a dated changelog
   line the same way other task containers in this file do, and update `dod.acceptance` /
   `dod.success` / `dod.exit` `checked` flags only for the criteria the recorded evidence
   actually satisfies. Do not mark `exit.checked: true` unless a rollback was actually
   exercised and verified — the exit criterion is conditioned on "given a regression", so an
   uneventful switch with no rollback leaves that criterion's precondition untested, not
   satisfied.
3. Run `npm run govern` after editing generated-adjacent files (`docs:graph` /
   `docs:preflight`) so the roadmap views stay consistent.

## What this runbook is not a substitute for

- It does not decide whether TASK-ZAI-042/TASK-ZAI-050 are done — Step 0 asks you to check,
  not to assume.
- It does not pick the campaign-window duration — that is the owner's call.
- It does not build the shadow-compare harness — that is separate, sibling work (see the
  design doc §10.1 Phase 3 and any module under `apps/server/src/modules/knowledge/` built
  for it); this runbook tells you how to fold its output (or, absent it, a manual trace
  comparison) into the recorded evidence.
- It does not authorize a second Business. ADR-090 D5: "a second Business waits for the
  single-binding routing decision" (R-1 in the design doc, `knowledge-runtime.js` accepts
  exactly one `ZURI_KNOWLEDGE_BINDINGS` entry).

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0 | 2026-09-27 | beta | Initial runbook: preflight (via `ki17-line-grounding-inspect.mjs`), the audited `CONFIGURE_KNOWLEDGE_GROUNDING` switch and rollback, shadow-compare evidence collection, and the migration-notes/changelog recording step. Does not resolve or claim resolution of TASK-ZAI-042/TASK-ZAI-050; does not pick a campaign-window duration (flagged as an owner decision); does not implement the shadow-compare harness | working-tree | Claude Sonnet 5 |
