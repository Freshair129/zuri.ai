---
status: active
superseded_by: null
version: "0.1.0"
---

# PM workflow merge: generated architecture navigation is stale

Complexity C-2; risk LOW for a derived navigation correction. Owner authority is
`merge` of PR #631; no PM implementation or candidate promotion is authorized.

## Symptom

Hosted governance job failed for PR head
`f9f641e3c17bd181eed6182721bdc3205de226e5`. The requested merge remains pending.

## Evidence

- [Hosted governance job](https://github.com/Freshair129/zuri.ai/actions/runs/37288692555/job/111693839899): at 2026-10-05T09:16:20Z, `node ../../tools/generate-document-views.mjs --check` reported `docs/architecture/README.md is stale; run generator without --check` and exited 1.
- `docs/architecture/README.md` line 42 retains the main title `Multi-agent delivery — Luna Max → Verify gate → Final gate`.
- Reviewed `docs/architecture/project-manager-system/20-MULTI-AGENT-DELIVERY-PLAN.md` line 22 uses the selected snapshot title `Multi-agent execution — Luna Max workers → Terra decision gate → Astra escalation`.
- `tools/generate-document-views.mjs` renders architecture navigation from current graph node titles and compares exact bytes in check mode.
- The governance workflow regenerates the graph before running the view check. It checks committed navigation without repairing it.

## Root Cause — VERIFIED

The approved source composition changed the title used by generated navigation,
while its committed architecture navigation projection was not regenerated.
The source/title and view inputs no longer agree. This conclusion explains the
observed view-check failure; it makes no claim about other pending CI jobs.

## Why the issue escaped detection

Local govern/test/build were intentionally NOT_RUN under the owner constraint.
Exact source review and snapshot preservation checked source composition, not
fresh generated-view output. Their PASS receipts were insufficient to establish
hosted governance acceptance. Earlier evidence remains historical and unchanged.

## Proposed prevention and correction

The integrator regenerates graph inputs and document views serially using the
sanctioned generators, inspects the resulting diff, and commits only necessary
tracked projections. Acceptance requires the generated navigation label to match
the reviewed source title, exact source/candidate hashes to remain unchanged,
and normal required hosted checks on the final PR head to pass. Do not hand-edit
the generated README or alter the source to silence a stale-view check.

Local govern/test/build remain NOT_RUN. Narrow documentation generation and its
view freshness check are reported separately. Final hosted results remain pending
until observed. Operational adoption and loop prevention effectiveness remain
UNKNOWN. `dispatchable=false`, `implementationAuthorized=false`.

0.0 → 0.1.0: records the exact hosted stale-navigation failure, confirmed source
cause and bounded generator correction; no requirement or candidate is changed.
