---
version: "0.3.0b"
created_at: "2026-09-20T00:00:00+07:00,Luna Max"
last_update: "2026-09-20T00:00:00+07:00,Luna Max"
status: "candidate"
superseded_by: null
attributes:
  domain: "knowledge"
  doc_type: "root-cause-analysis"
  scope: "KI17 isolated runtime recovery for TASK-ZAI-094"
---

# RCA — KI17 isolated runtime roots were deleted before the native rerun

## Symptom

At the incident point, the real four-process GenesisRAG17 acceptance suite was
merged in PR #470, but the native launcher could not start because its configured
external roots were gone. The pinned model cache survived. Recovery now uses the
fixed zuri.ai snapshot `3b92cd0f` over an artifact-attested Linux acceptance image;
this is not Git-restored source, native Windows acceptance, or production
activation. Final receipt run `59a0a93d862e442895296872f4b9ca58` is PASS: 40/40
tests across two files, zero failed/pending/todo, `tickElapsedMs=504`, grounding
hops `[290,300,292,300]` ms, and the 2,500 ms budget holds. The matching tracked
report is `.brain/reports/task-zai-094-line-grounding.json`; the dated provenance
summary is `.brain/reports/2026-09-20-ki17-runtime-recovery.json`.

## Evidence

- The operator confirmed that the old isolated KI17 roots were deleted. The
  KI17_MSP_ROOT, KI17_GKS_ROOT, KI17_GENESIS_ROOT and KI17_MODEL_DIR environment
  values were unset.
- Running the existing launcher from the recovery worktree failed closed with:
  KI17_MSP_ROOT must explicitly name an existing isolated runtime/model directory;
  this suite never skips missing prerequisites.
- git show 3b92cd0f --stat shows the real PR #470 addition of 267 lines to
  apps/server/tests/acceptance/genesisrag17-e2e.test.js. The launcher invokes
  that suite and the SmartGift suite; this is not the old mocked grounding test.
- The checked sibling MSP and GKS repositories are at unrelated current heads
  (68e6169d and 1a9f75da). The default GenesisBlock-ki17 and GenesisBlock
  directories are absent. This enumerates the four native candidate roots checked
  for this rerun; Compose context overrides may name other locations.
- apps/server/deploy/ki17/pins.json requires MSP
  49fe7de7d5603a4a75b279bcd72b16619fdc0046, GKS
  ecf1e4de269e949406a6a5f791f9ff8fe30c9578, GenesisBlock
  5e75c4a85e1a42faf6d2afe42633c4f2a4725c92, and model revision
  614241f622f53c4eeff9890bdc4f31cfecc418b3.
- The historical G-3 image run passed 35/35 on Linux inside a throwaway
  ki17-acceptance image. It proves the historical pinned image path, not a fresh
  native Windows run or production deployment.
- The separate `ki17-build-stage30` plus `ki17-acceptance-harness5` validation
  passed 35/35 across two files. It is a unit/build-harness contract result, not
  the historical G-3 result and not the current 40-case runtime acceptance.
- GitHub returns 422 for the current GenesisBlock pin. Recovery therefore uses
  the existing local image by raw ID
  `sha256:6314674e54b4e2873f85be52aeb4ce69de4dcd9d26524036dfd0a49c19dfd7d0`,
  verifies `/opt/ki17/pins/resolved.json`, and overlays the fixed zuri.ai
  snapshot `3b92cd0f` plus the current application source and tests. The model
  cache exists and is checked separately from the image's GenesisBlock provenance.
- The final helper receipt is
  `C:\Users\pc\.codex\runtimes\ki17-runtime\runs\ki17-59a0a93d862e442895296872f4b9ca58\receipt.json`.
  It records `PASS`, exit `0`, 40/40 tests across two files, zero failed/pending/todo,
  and the same four-process grounding measurements recorded in the tracked report.

## Root cause

The native acceptance depended on external, absolute runtime roots that were treated
as recoverable local state. Losing those roots removed the configured source inputs
the launcher requires, while the repository retained the test contract and pin
manifest but not the external source trees at the required pinned commits. The pinned
Hugging Face model cache survived. The durable reproducibility gap was the absence of
one saved recovery invocation and receipt that separated embedded image provenance
from the current zuri.ai source/test overlay.

## Why detection escaped

G-3 had already passed inside a throwaway Linux image, and that result remained valid
as historical image evidence. The launcher correctly stopped when configured roots
were absent. The gap was the lack of a durable, repeatable recovery invocation and
receipt; normal CI does not provision the external runtime needed for this 40-case
suite. The runbook also carried a stale GenesisBlock example 7c9261c4 while the
current manifest pins 5e75c4a, which made source restoration ambiguous.

## Recovery runbook

1. Use the fixed Linux image route. Verify the raw local image ID above and
   `/opt/ki17/pins/resolved.json`, then invoke
   `C:\Users\pc\.codex\runtimes\ki17-runtime\run-ki17-acceptance.ps1`.
   The helper extracts the fixed `3b92cd0f` source/test overlay; GenesisBlock
   provenance is artifact-attested, not a fresh Git clone.
2. Record `linux-x64`, actual Node 24.18.0 and Python 3.12 versions, the image
   ID, fixed snapshot, model revision/hash, and helper run ID. The deployment
   manifest's linux-x64 addon is a deployment fact, not native Windows or
   production certification.
3. Preserve the helper exit status, two-file Vitest proof, 40-case count, zero
   skips, real LINE evidence, and grounding report from the same run. Keep the
   historical G-3 35/35 and the separate unit/build-harness 35/35 results distinct.
4. Reconcile TASK-ZAI-094 from the final receipt and its matching tracked report:
   the isolated source state is `done / LOCAL / MERGED`, with all task-control DoD
   checks evidenced. This does not activate production; TASK-ZAI-095 remains
   planned.

## Proposed prevention

- Retain an immutable image tar/hash or an exact source checkout/export with
  .ki17-pin before deleting any external KI17 root.
- Keep one operator rerun receipt around the existing launcher and pin verifier.
  Any helper that produces that receipt belongs to the implementation owner; this RCA adds
  no product code.
- Make every report state whether proof came from native Windows, Linux image G-3,
  hosted CI or production, and record the current app/test overlay hash separately
  from the embedded KI17 source provenance.
- Make the canonical roadmap and its generated 24-week/task-control projections
  consume the receipt only after the reviewer reconciles the evidence. Do not make an
  isolated stage or an image build appear to be production activation.

## Scope and release limit

This RCA records the deletion recovery and its evidence boundary. It does not
restore external repositories from Git, perform native Windows recovery, deploy
Compose, or activate production. The recovered state is an artifact-attested
Linux image plus the fixed zuri.ai source/test overlay. TASK-ZAI-094 is isolated
`done / LOCAL / MERGED` from final run `59a0a93d862e442895296872f4b9ca58`; TASK-ZAI-095
remains planned. The prior G-3 result and the separate unit/build-harness result
remain distinct evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.0b | 2026-09-20 | candidate | Recorded the final artifact-attested Linux receipt, 40-case proof, grounding timings and isolated TASK-ZAI-094 closure. | working-tree | Luna Max |
| 0.2.0b | 2026-09-20 | candidate | Reframed the RCA around lost external inputs and the artifact-attested Linux recovery route; separated historical G-3, unit/build-harness, isolated runtime and production evidence. | working-tree | Luna Max |
| 0.1.0b | 2026-09-20 | candidate | Recorded deleted KI17 roots, native fail-closed evidence, image/native provenance boundary and recovery runbook. | working-tree | Luna Max |
