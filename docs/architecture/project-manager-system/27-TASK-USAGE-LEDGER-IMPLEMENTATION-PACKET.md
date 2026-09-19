---
version: "0.3.0b"
status: "beta"
created_at: "2026-09-18T02:45:00+07:00,RWANG,source 0c7fd88418b8be40a78f1fb8bc743b34c5a52c39"
last_update: "2026-09-18T05:25:00+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: "implementation-packet"
  domain: "platform-control"
  scope: "TaskUsageLedger read projection over ProgrammeUsageReport and declared lane telemetry"
---

# TaskUsageLedger implementation packet

## 1. Gate status and scope

This packet is the implementation handoff and local verification record for
the approved `TaskUsageLedger` contract baseline. The first pure read
projection and authenticated export route are now implemented in the primary
repository; no database schema or migration was added, and the public Site
has not been activated from this runtime change.

**Risk: MEDIUM.** The change alters the meaning of task-level measured usage and
the roadmap task card, but the recommended first implementation is a pure
read projection over the existing `ProgrammeUsageReport` model and the
declared meter lanes. No new database table or migration is part of this
packet.

### Intended outcome

For every known `TASK-ZAI-*`:

1. `taskStatus` remains the roadmap status (`done`, `review`, `planned`, etc.).
2. `plan.predictedTokens` remains an estimate only.
3. `actual` is populated only from a usage record explicitly bound to the task
   by `taskCode`.
4. A done task without such a record reads `actual: null` with
   `measurementStatus: NOT_REPORTED`.
5. Shared lane totals are shown as lane evidence and are never divided or
   copied into individual task actuals.
6. The public projection contains no session, branch, repository, person,
   installation, account label, raw report id, or raw payload.

### Exit criteria for the root integrator

- Pure projection and redaction functions are implemented with unit tests.
- Task cards render `Plan` and `Actual` as separate fields.
- A direct report is accepted only for a known task and is deduped by the
  existing report key.
- `predictedTokens` and legacy `totalTokens` are absent from the actual object.
- Shared lane and branch-only measurements remain visible but are labelled
  `LANE_ONLY_UNALLOCATED` or `UNATTRIBUTED`.
- Existing lane aggregate tests remain green.
- Documentation and generated registries are reconciled by the root owner in
  one governance pass.

## 2. Root cause and current evidence

### Root cause

The roadmap has two different facts that were rendered near each other:

- plan data in Task Containers (`predictedTokens`, and historical
  `totalTokens`), and
- measured data from the local meter or `ProgrammeUsageReport`.

The container generator still exposes both fields. The board task header at
`ProgramRoadmapBoard.jsx:602` renders `container.predictedTokens` directly,
without consulting a task-bound measured projection. A `done` status therefore
does not prove that an actual token figure exists.

ADR-086 explicitly says that a task with no measurement must read
“not measured”, never zero and never its prediction, and that historical
`total_token_usage` is no longer read by the board. The new projection makes
that rule enforceable at task granularity instead of only at phase/lane level.

### Source facts verified at baseline commit

| Fact | Evidence | Consequence |
|---|---|---|
| Planned and measured are separate | ADR-086 D1, lines 51–63 | Never use a plan value as an actual value |
| Task Container contains prediction and legacy total | `programme-containers.mjs:121–161`; generated container rows include `predictedTokens` and `totalTokens` | Both are plan/history fields; ignore for actuals |
| Usage report accepts optional explicit task | `programme-usage-reports.js:63–79`, `:160–170` | Explicit `taskCode` is the only direct task binding already validated at the API boundary |
| Existing report key is `(source, sessionId, branch)` | `programme-usage-reports.js:173`; Prisma schema `:5256` | One row can represent one session/branch; extension is an update, not a second row |
| Branch-only reporting is valid | `programme-usage-reports.js:169–170`; ADR-087 D4 | Branch-only reports must not be guessed into a task |
| Lane merge skips a meter-counted session | `program-delivery-metrics.js:102–156` | Task projection must keep its own direct binding and a reconciliation flag |
| Meter output is lane-level | `programme-usage-meter.mjs` and ADR-086 D3/D4 | It cannot be allocated among shared-lane tasks |
| Harness reporter supports explicit `taskCode` | `plugins/zuri-harness/lib/usage.mjs:181–211`; `bin/zuri-harness.mjs:305–344` | Direct ledger coverage requires a caller-owned task assignment; absent input remains branch-only |
| Existing production evidence says report table had zero rows | `docs/appendices/B-db-schema.md:542,546,550` | “No report” is a measured absence, not zero token usage |

## 3. Contract baseline

The machine-readable contract is in
[task-usage-ledger.contract.json](contracts/task-usage-ledger.contract.json).

### 3.1 Identity and status rules

`taskCode` is a stable programme key. It is not a database foreign key because
the current programme task registry is generated from the roadmap document.
The projection receives the known task set from `PROGRAMME_TASKS` and rejects
or quarantines any input task code that is not in that set.

The projection keeps the following statuses separate:

| Field | Meaning |
|---|---|
| `taskStatus` | Roadmap status copied from `PROGRAMME_TASKS` |
| `measurementStatus` | Whether a direct task-bound actual exists |
| `reconciliationStatus` | Whether the direct report overlaps an existing lane meter session or has a conflict |
| `availability` | Whether the source report table/read path was available |

The presence of `taskStatus: done` never changes `measurementStatus`.

### 3.2 Internal projection shape

```json
{
  "schemaVersion": "task-usage-ledger.v1",
  "availability": "AVAILABLE",
  "asOf": "2026-09-14T13:43:56.014Z",
  "tasks": [
    {
      "taskCode": "TASK-ZAI-066",
      "taskStatus": "done",
      "plan": {
        "predictedTokens": 52000,
        "source": "PROGRAMME_CONTAINERS"
      },
      "measurementStatus": "MEASURED_DIRECT",
      "reconciliationStatus": "METER_OVERLAP",
      "actual": {
        "tokens": {
          "inputTokens": 1200,
          "cacheWriteTokens": 100,
          "cacheReadTokens": 90000,
          "outputTokens": 800,
          "usedTokens": 2100
        },
        "requestCount": 14,
        "activeMinutes": 32,
        "startedAt": "2026-09-13T10:00:00.000Z",
        "endedAt": "2026-09-13T10:40:00.000Z",
        "reportCount": 1,
        "models": [{ "name": "gpt-5.5-codex", "requests": 14 }]
      },
      "attribution": {
        "kind": "DIRECT_TASK_CODE",
        "directReportCount": 1,
        "laneIds": ["LANE-DELIVERY-TELEMETRY"]
      },
      "evidence": {
        "sourceRefs": [
          {
            "kind": "PROGRAMME_USAGE_REPORT",
            "id": "operator-only-row-id",
            "payloadSha256": "operator-only-hash"
          }
        ]
      },
      "warnings": []
    }
  ]
}
```

`actual` is `null` when no direct measurement exists. `usedTokens` is always
`inputTokens + cacheWriteTokens + outputTokens`; `cacheReadTokens` is shown
beside it and is never included in `usedTokens`.

### 3.3 Measurement status vocabulary

| Status | Use |
|---|---|
| `MEASURED_DIRECT` | At least one stored report has this task's explicit `taskCode`; actual is aggregated from those rows |
| `MEASURED_DIRECT_WITH_WARNING` | Direct actual exists, but overlap, interval or model consistency warnings are present |
| `NOT_REPORTED` | Source is available but no direct report names this task |
| `LANE_ONLY_UNALLOCATED` | A lane or branch has measured usage, but it is not directly bound to this task; actual stays `null` |
| `UNATTRIBUTED` | A report or meter activity has no declared lane and no task binding |
| `SOURCE_UNAVAILABLE` | Report read failed or the source table is not available; actual stays `null` |
| `CONFLICT` | A source conflict was detected and no actual is admitted |

### 3.4 Reconciliation status vocabulary

| Status | Meaning |
|---|---|
| `NONE` | No meter overlap or warning |
| `METER_OVERLAP` | The report's `source:sessionId` is also present in a declared lane meter session. The direct report remains the task-level source; the lane aggregate must not be added a second time to a programme total. |
| `BRANCH_ONLY_LANE` | A report was attributed by branch only; no task actual was created. |
| `UNATTRIBUTED_REPORT` | A report has neither explicit task nor declared branch lane. |
| `OVERLAPPING_INTERVALS` | Multiple direct reports for one task have overlapping time intervals; token totals may still sum, but active-time interpretation requires review. |
| `TASK_BINDING_CHANGED` | A resumed report attempts to change `taskCode` for an existing `(source, sessionId, branch)` key; admission must be rejected after the contract patch. |

## 4. Mapping and reconciliation algorithm

The implementation uses a pure function in
`application/task-usage-ledger.js` under platform-control, keeping the
existing `mergeLaneUsage` contract unchanged.

### Inputs

```text
knownTasks: PROGRAMME_TASKS
containers: PROGRAMME_CONTAINERS
lanes: PROGRAMME_LANES
meterUsage: PROGRAMME_USAGE
reports: listProgrammeUsageReports(prisma)
```

### Algorithm

1. Build `knownTaskCodes` from `PROGRAMME_TASKS` and a task metadata map from
   `PROGRAMME_CONTAINERS`.
2. Initialise one projection row per known task. Set `plan.predictedTokens`
   from the container only. Do not read or expose `totalTokens` as an actual.
3. For each report with a non-null `taskCode`:
   - require that the code is in `knownTaskCodes`;
   - group by the stored report identity `(source, sessionId, branch)`;
   - use the final row after a valid extension;
   - sum token/request/active-minute fields across distinct report identities;
   - keep `cacheReadTokens` separate;
   - set `measurementStatus` to `MEASURED_DIRECT`;
   - resolve the report's lane only as supporting metadata.
4. For each report without `taskCode`:
   - resolve by declared branch using `laneOfReport`;
   - update lane coverage only;
   - do not add tokens to any task row;
   - mark affected lane tasks `LANE_ONLY_UNALLOCATED` only when no direct report
     exists for that task; a direct report wins the task row's status.
5. For every meter lane:
   - retain its aggregate in the lane projection;
   - mark all member tasks as lane-covered, not task-measured;
   - never divide or copy lane tokens, active time or request counts to tasks,
     including when a lane happens to contain one task. This preserves ADR-086
     D3's no-estimation rule.
6. Build `meterSessionKeys` from each meter lane's `sessions` array. For every
   direct report, set `METER_OVERLAP` when `${source}:${sessionId}` is present
   in the lane that contains the task. The direct report is retained for task
   attribution, while a combined programme total excludes the report from the
   lane total a second time.
7. Detect overlapping intervals among direct reports for the same task. Do not
   invent a subtraction rule; set `OVERLAPPING_INTERVALS` and leave the token
   sum measured, while active time is labelled as a sum of reported active
   minutes.
8. If no direct report exists, leave `actual: null` and set status according to
   source availability and lane coverage. A `done` task is still
   `NOT_REPORTED` when the source is available but empty.
9. Sort task rows by `taskCode`; sort models, source refs, lane ids and warning
   codes deterministically.

### Why the direct report survives meter overlap

`mergeLaneUsage` correctly avoids double counting at the lane aggregate, but a
lane may contain multiple tasks and therefore cannot answer “which task used
these tokens?”. A report carrying explicit `taskCode` is the only finer-grained
evidence. The ledger may therefore show the direct report on the task and mark
the overlap, while the lane aggregate remains the programme-level total. The
UI must not add these two figures together without a reconciliation label.

### Task binding immutability

`growsFrom` now checks installation, start time, end time, monotonic counts and
task-code equality. The task-binding rule is:

- A report may extend only when the existing and incoming `taskCode` are equal
  (both null is valid for branch-only reporting).
- A first report must include `taskCode` if the caller wants direct task
  attribution; branch-only reports remain branch-only forever for that key.
- A later attempt to change `null → TASK-ZAI-*` or `TASK-ZAI-* → another task`
  returns `409 USAGE_REPORT_CONFLICT` and creates no new ledger actual.

This prevents a resumed branch report from being silently reassigned to a task.

## 5. Public redaction contract

The operator projection may retain report ids, payload hashes, model names,
detail counts and person/device breakdowns under the existing operator guard.
The public or member artifact must use a separate redactor before serialization.

### Allowed in public task rows

- `taskCode`
- `taskStatus`
- `plan.predictedTokens` with a visible “planned” label
- `measurementStatus`
- `reconciliationStatus`
- actual aggregate token counts only when `MEASURED_DIRECT`
- actual request count and active minutes
- UTC start/end at aggregate level, if the artifact needs them
- coarse `sourceClass` (`direct-report`, `lane-meter`, `unattributed`)
- model family only if the product explicitly chooses to expose it
- warning codes and evidence coverage labels

### Forbidden in public rows

```text
sessionId
branch
repository
personId
installationId
aiAccountLabel
raw report id
payloadSha256
detailJson
tool names and tool-level counts
raw prompt, response, reasoning, arguments or outputs
device labels and OS user
```

The member view already strips person, device, tool and model names in
`projectMemberLaneUsage`. The new task projection must apply the same principle
at the task boundary; redaction must happen before the React/page payload and
before any public static JSON is written.

## 6. API and migration boundary

### Existing write API remains the source contract

`POST /api/platform/programme-usage-reports` already accepts `taskCode` and
rejects unknown task ids. No new write route is needed for this slice.

The harness plugin emits `taskCode` only when an orchestrator or CLI explicitly
passes a caller-owned assignment to `toReportBody(summary, { taskCode,
repository, aiAccount })` or `--task-code TASK-ZAI-###`. It must not infer a
task from a shared branch.

Suggested body addition:

```json
{
  "source": "codex",
  "sessionId": "...",
  "branch": "feat/delivery-telemetry",
  "taskCode": "TASK-ZAI-066",
  "inputTokens": 1200,
  "cacheWriteTokens": 100,
  "cacheReadTokens": 90000,
  "outputTokens": 800,
  "requestCount": 14,
  "activeMinutes": 32,
  "startedAt": "2026-09-13T10:00:00.000Z",
  "endedAt": "2026-09-13T10:40:00.000Z"
}
```

### No migration in the first implementation slice

The current Prisma/Supabase model already carries nullable `taskCode`, the
branch-aware unique key, token counts, time fields, detail columns and indexes.
The first `TaskUsageLedger` is a deterministic read projection. It does not
create a second token source of truth and does not add a `TaskUsageLedger` table.

Production schema state must remain distinguished from migration source text:

- migration files are release artifacts and contain “NOT APPLIED” comments;
- the database appendix records owner-instructed production application of the
  report, attribution and detail migrations with zero rows at the recorded
  inventory points.

No production migration may be claimed from this packet. If later scale or
retention requirements require materialization, open a separate high-risk ADR
and migration packet with a source-report foreign key, append-only history and
an explicit backfill/reconciliation policy.

## 7. Patch plan for root

### P1 — Pure read projection — implemented locally

1. Add `apps/server/src/modules/platform-control/application/task-usage-ledger.js`.
2. Export `projectTaskUsageLedger(input)` and
   `redactTaskUsageLedger(ledger, audience)`.
3. Reuse `tokensUsed` semantics from `program-delivery-metrics.js`; do not
   duplicate a second formula with cache reads included.
4. Keep `mergeLaneUsage` unchanged except for any shared helper extraction that
   preserves its existing tests.

### P2 — Admission contract closure — implemented locally

1. In `programme-usage-reports.js`, require task-code equality in
   `growsFrom` before accepting an extension.
2. Return `USAGE_REPORT_CONFLICT` for a task-code rebinding attempt.
3. Include operator-only `id`, `payloadSha256` and `extendedAt` in the list
   projection if evidence links require them; strip them in member/public
   projections.
4. Add unit tests for null-to-task and task-to-task rebinding.

### P3 — Explicit plugin binding — implemented locally

1. `toReportBody` accepts an explicit `taskCode` option and validates its
   shape before a request is queued.
2. The report builders and CLI accept `--task-code TASK-ZAI-###`; absent input
   leaves the report branch-only.
3. The task binding is never inferred from a branch or title; the server remains
   authoritative against `knownTaskCodes`.
4. Plugin regression coverage proves the option is additive and rejects a
   branch-shaped value.

### P4 — Runtime and artifact UI — implemented locally

1. Pass the operator ledger into `ProgramRoadmapBoard`.
2. Replace the task-header token string at `ProgramRoadmapBoard.jsx:602` with:
   `Plan <n> tokens · Actual <n> tokens` when direct measured, or
   `Plan <n> tokens · Actual not reported` otherwise.
3. Keep lane telemetry in the expanded task detail explicitly labelled as
   `shared lane / not allocated to this task`.
4. Feed the same pure projection into the PM static artifact generator and
   serialize only the redacted projection.

### P5 — Documentation and governance

1. Update the API appendix to distinguish direct task reports from branch-only
   reports and to document task-code immutability on extension.
2. Update the DB appendix with the read-projection contract; do not add a model
   row for this slice.
3. Update the harness plugin specification with the explicit optional task-code
   field and no branch inference rule.
4. Root integrator reconciles the G14/registry package, runs `npm run govern`
   once, then runs the focused tests and full required checks.

## 8. Acceptance test matrix

| ID | Given / when | Required result |
|---|---|---|
| TUL-01 | A `done` task has `predictedTokens` but no report | `actual=null`, `measurementStatus=NOT_REPORTED`; predicted value appears only under `plan` |
| TUL-02 | A valid report names a known `taskCode` | One direct ledger row; `usedTokens=input+cacheWrite+output`; cache read is separate |
| TUL-03 | Same report payload is submitted again | Existing report is replayed; ledger counts it once |
| TUL-04 | Same key is extended with larger counts and unchanged task code | Stored row is updated once; ledger reflects final cumulative counts |
| TUL-05 | Same key attempts null-to-task or task-to-task rebinding | `409 USAGE_REPORT_CONFLICT`; no reassigned actual |
| TUL-06 | A report names an unknown task | Existing `404 PROGRAMME_TASK_UNKNOWN`; no ledger row |
| TUL-07 | A branch-only report resolves to a lane with multiple tasks | Lane aggregate is visible; every affected task remains `LANE_ONLY_UNALLOCATED`; no token split |
| TUL-08 | A lane meter contains one task | Still no task actual unless an explicit report has `taskCode`; no hidden inference |
| TUL-09 | A direct report's session also occurs in the meter lane | Direct task actual remains; reconciliation is `METER_OVERLAP`; combined lane/programme total does not double count |
| TUL-10 | A report has an undeclared branch and no task | It is `UNATTRIBUTED`; no task actual |
| TUL-11 | Two direct reports for one task use distinct sessions | Their measured values aggregate; overlapping intervals produce a warning, not silent subtraction |
| TUL-12 | Report read fails or table is unavailable | All actuals remain null and status is `SOURCE_UNAVAILABLE`; no zero fallback |
| TUL-13 | Public redactor serializes a measured row | No session, branch, repository, person, installation, account label, report id, hash, detail JSON or tool/model identifiers leak |
| TUL-14 | Public redactor serializes a plan-only row | It retains plan prediction and says `NOT_REPORTED`; no `actual` prediction copy |
| TUL-15 | Task order and report input order vary | Projection JSON is byte-stable after canonical sorting |
| TUL-16 | Existing `mergeLaneUsage` fixtures run | Existing lane dedupe and phase metrics behavior remains unchanged |
| TUL-17 | Harness `toReportBody` gets an explicit task code | Body includes it; absent option omits it; invalid shape is rejected before send |
| TUL-18 | Member view receives task projection | Person/device/tool/model names are removed before render, matching ADR-092 D3 |

## 9. Known limitations and non-goals

- The existing meter has no task-level request observations in its generated
  lane block. It cannot answer task actuals by itself.
- A branch shared by several tasks cannot be apportioned by complexity,
  predicted tokens, commit size or time. Any such allocation would violate
  ADR-086 D3.
- A direct report's `activeMinutes` is reported active time, not necessarily
  wall-clock elapsed time. Keep both fields distinct.
- `ProgrammeUsageReport` has no task foreign key. The stable task registry and
  server validation are the current authority. A future database FK would be a
  separate migration decision.
- This packet does not change task status, feature readiness, FR readiness,
  production activation, or workforce capacity semantics.

## 10. Local implementation evidence

The local implementation now contains:

- `apps/server/src/modules/platform-control/application/task-usage-ledger.js`
  with deterministic projection, nested `actual.tokens`, reconciliation states
  and public redaction;
- `apps/server/src/app/api/platform/task-usage-ledger/route.js` with
  bearer-first authentication, known-task filtering and `no-store` responses;
- roadmap server pages and `ProgramRoadmapBoard.jsx` rendering plan and actual
  values as separate fields;
- task-code immutability in `growsFrom` and regression coverage for null/task
  rebinding.
- explicit `taskCode` handoff in `plugins/zuri-harness/lib/usage.mjs`, report
  builders and CLI, with early shape validation.

Focused verification on 2026-09-18 passed: 5 files, 57 tests. Governance
regeneration and strict preflight passed with 0 critical findings. Build and
full verification remain release gates; this packet does not claim production
activation.

## 11. Handoff note

P1–P4 are implemented locally after the approved contract baseline. P5 is
recorded by the root integrator in one governance pass so generated registries
and appendices are not edited concurrently by workers.

The source baseline and file hashes are recorded in `evidence-manifest.json`;
generated packet hashes are in `SHA256SUMS.txt`. The root integrator must
record the final commit and deployment decision separately after release gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-18 | candidate | Add TaskUsageLedger contract, mapping algorithm and acceptance matrix | worker-local; uncommitted | RWANG |
| 0.2.0b | 2026-09-18 | beta | Record local projection, route, UI separation and 36 focused tests | pending | RWANG |
| 0.3.0b | 2026-09-18 | beta | Align internal token shape and close explicit harness task-code handoff | pending | RWANG |
