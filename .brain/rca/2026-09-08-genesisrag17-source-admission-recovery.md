---
version: "1.0.0b"
created_at: "2026-09-08T04:38:00+07:00,RWANG"
last_update: "2026-09-08T04:38:00+07:00,RWANG"
status: beta
attributes:
  domain: knowledge
  doc_type: root-cause-analysis
---

# GenesisRAG17 source admission and failed receipt recovery

## Symptom

A raw receipt failure cannot close through the central finish endpoint. A process
death between pipeline run creation and ingestion-intent creation can also leave
a queued run that the source recovery loop cannot discover.

## Evidence

The actual native boundary suite produced a persisted Stage1 FAILED row with one
input and one error, no batch, and `STAGE_NOT_SUCCEEDED`/`GATE_MISSING` on finish.
`ingestion-job.js` intentionally excludes Stage1 from its legacy executed stage
list because that earlier entrypoint started after receipt. The new raw executor
executes receipt itself. Before repair, `ingestGenesisRag17Raw` called
`createPipelineRun` and `ensureIngestionIntent` separately; the source worker
enumerates intents, not orphaned queued runs.

The follow-up review also found a template-string regex losing its whitespace
escape, a mention-replay comparison omitting source parent/hash fields, and
caller-supplied recognizer labels not checked against the executed rule. The
source fixture previously used single-word person names, and replay checks
compared visible mention shape rather than every immutable linkage field.

## Root cause

The legacy finish model was reused without accounting for the newly executable
receipt stage. Admission also persisted two mutually dependent records without
one transaction. A durable intent after Stage1 is insufficient if a run can
be committed before that intent exists.

## Why the issue escaped detection

Previous happy-path checks and crash tests began after local stage evidence or
the Stage9 handoff. They did not terminate inside admission, and successful runs
do not exercise early failure finalization.

## Proposed prevention

Create run and intent atomically; terminate a real source process between their
writes and verify rollback leaves no orphan before caller retry. Keep Stage1
failure handling in the central finish guard, using the monitor's current
step/attempt and matching immutable FAILED evidence. Worker and API must use the
same guard; historical evidence must not close a later attempt. Native acceptance
must verify no fabricated downstream evidence on an early failure.
Add multiword-name coverage, reject incompatible recognizer labels, compare all
durable mention parents/hashes, and select batches by persisted exact scope
before reading their payloads. These are bounded corrections to source integrity,
not a new extraction engine.

## Verification

Final four-process native acceptance passed 25/25 without skips. The full zuri
regression passed 4,217 tests; the final verification manifest is linked from the
[audit remediation report](../reports/GENESISRAG17-AUDIT-REMEDIATION.md).

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-09-08 | beta | Admission transaction and current-attempt receipt failure RCA | working tree | RWANG |
