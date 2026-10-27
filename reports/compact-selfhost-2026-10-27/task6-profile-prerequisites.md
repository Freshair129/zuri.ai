---
doc_type: implementation-evidence
status: reviewed
version: "0.1.1"
recorded_at: "2026-10-27"
implementation_base: "59abfaac2bdd20c769bb8bf7af61c5f2c0216c32"
---

# Compact Task6 profile prerequisites and cohort probe

This is a bounded Task6 preparation milestone. The first shipping qualification
lane remains core, as selected by the owner. Neither LINE nor Knowledge has a
selected qualified Compact release artifact. Task6's actual AI acceptance and
native recovery checkboxes remain open; this report cannot close them.

The package producer and loader now refuse an incomplete or unreviewed Knowledge
model tuple. The admitted stdio tuple follows `deploy/ki17/pins.json`: MSP
`d0d48c1a`, GKS `ecf1e4de`, GenesisBlock `5156f412`, E5 revision `614241f6`.
The five model SHA-256 values are pinned from that GenesisBlock worker source.
The normal package hash pass must still verify every actual model byte; a
descriptor or image pin receipt is not exact-image KI17 acceptance. No model is
downloaded at startup, and no sibling source checkout is needed by the package.

Diagnostics distinguish missing installation/key/token/model prerequisites from
configuration presence. They bind only public release identities and never
return or hash secret configuration. Configuration presence does not establish
bootstrap, current Business authority, model availability, storage qualification,
queue replay, native recovery or live delivery. All those gates remain explicit.
Selected profiles always remain `NOT_QUALIFIED`; disabled profiles remain
`NOT_SELECTED`, even when private configuration is present.

The dependent workers and Knowledge state volumes carry owned TEST labels.
Read-only Docker inspection checks image reference, running state, ownership,
shared state mounts, read-only model mount and Genesis worker namespace against
the current web container ID. Missing, foreign or duplicated resources refuse
cohort readiness. The check does not start workers, issue grants, drain jobs or
send LINE messages. Docker Desktop drive-bind translation is compared against
the exact Windows model directory; Linux paths retain their exact spelling.

## Actual local evidence

- `npm run compact:test`: **156/156 PASS, zero skipped**, including the added
  Windows-path regression and the existing package/installer/bootstrap checks.
- Explicit owned Docker lifecycle probe: **3/3 PASS, zero skipped**, 13.09 s.
  It detected a stale namespace after actual web recreation, recreated only the
  owned inert worker, retained synthetic native-volume bytes and detected loss
  after deleting only that run-created synthetic volume. All remaining probe
  containers, volumes and network were removed through ownership checks.
- First failures retained privately: Docker's default subnet pool was exhausted;
  the fixture now chooses a nonoverlapping explicit subnet. Then the exact bind
  check refused Docker Desktop's translated Windows path; a focused RED case
  preceded the fix. No existing network, runtime or volume was modified.
- Existing worker/cadence/Knowledge replay regressions: **90 PASS, one SKIP**
  across five files. The OS-delivered SIGTERM forwarding case is skipped on
  Windows; no Linux signal forwarding claim is supplied by this run.
- Document query/view readers: **26/26 PASS**. Serial canonical registry/graph/
  views and `npm run govern`: **PASS, 0 critical, 0 warning, 43 info**. Server
  build after governance: **PASS**, including compile, lint/types and 94 pages.
- Independent GPT-6 Luna Max same-patch source review: no Task6 code blocker;
  the evidence-count finding was reconciled to the actual 156-test run here.
  The reviewer ran no tests or Docker. Scope excludes actual AI/LINE acceptance.

The probe uses a cached pinned Task3 tools image only as a Node process carrier.
Its tiny processes are inert; the read-only directory contains an inert fixture,
not an embedding model. This proves Docker namespace/mount wiring, **not** current
app-image, AI, native-store semantic recovery or LINE qualification. No model
bytes, MSP/GKS transport, current authority, outbound receipt or live account
were exercised. Stage9+ restore, source withdrawal/serving authorization and
exact-version object/DB remapping remain required for a selected Knowledge lane.
Existing LINE queue tests are separate from live UAT and cannot replace it.

## Task5 review follow-up

The subsequently requested full-range review of `d5525db1..59abfaac` found one P2
integrity/availability issue: first policy creation can race Business tenant
reassignment, leaving an immutable mismatched policy. The existing report-target
race fix was accepted by source review, but this additional scope race is not
covered by the recorded 22 tests. The integrator subsequently selected the
[bounded Task5 correction](task5-policy-scope-correction.md), with both schedules
promoted to tracked native tests. The linked report records the full composed
re-review and both finding resolutions; those checks remain separate from this
Task6 preparation milestone. The original commit and all Task7 work are preserved.
Paired-Go cases remain skipped/unqualified. No Supabase migration, existing role,
production, main-dev or UAT is changed by this preparation milestone.
