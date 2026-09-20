# RCA - FR-244 residency heartbeat re-warmed a released model

**Date:** 2026-09-19
**Scope:** apps/edge/src/desktop-worker.ts, FR-244 / TASK-ZAI-109 model residency lifecycle

## Symptom

After the business-hours schedule released the local model when the last served
account closed, the next Edge heartbeat could warm it again. The worker therefore
could not guarantee that a closed aggregate directive stayed unloaded.

## Evidence

- runManagedWorker called triggerWarm unconditionally during initialization.
- status treated a model absent from Ollama /api/ps as degraded and called the
  same triggerWarm without consulting the latest residency directive.
- The FR-244 schedule called releaseModel only when its aggregate directive changed
  to false, so a later heartbeat warm was outside the schedule's change detector.
- The existing tests covered the schedule's polling and change-only behavior, but not
  the private desktop-worker interaction between a release and the heartbeat probe.

## Root Cause

The worker had one in-flight guard but no durable desired-residency state. The
heartbeat's pre-existing cold-model recovery policy was allowed to override the
business-hours schedule. A slow warm could also overlap a closing transition and
the old guard would drop the release request without a retry.

## Why the issue escaped detection

The FR-244 unit tests exercised the schedule in isolation, where warm and
release are the only side effects. They did not exercise status after the
schedule had emitted shouldBeWarm: false, nor did they cover a close arriving
while the previous keep-alive request was still pending. The local implementation
was reviewed as a merged code path, but no real Ollama/desktop lifecycle evidence
was available.

## Proposed prevention

createModelResidencyController now records the latest directive, refuses warm
retries before a successful directive and after a false directive, and queues the
latest transition behind an in-flight warm/release request. Startup no longer warms
before the first directive. A focused desktop-worker regression covers the
fail-closed startup, queued close, and no-rewarm-after-close cases. Production
Ollama/first-reply timing remains a separate deployment evidence gate.
