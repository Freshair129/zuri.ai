---
title: "BACKLOG: Task-Scoped Context Injection"
doc_id: "BACKLOG-TASK-SCOPED-CONTEXT-INJECTION"
status: "approved"
version: "0.1.0"
updated: "2026-06-19"
owner: "LYRA"
source_of_truth: true
prd_system: "SYSTEM-02::Project-Roadmap-Management-System"
related_docs:
  - "docs/PRD-GoVibe-Platform-Overview.md"
  - "docs/features/project-roadmap/FEAT-Document-Driven-Roadmap-Source.md"
  - "docs/features/project-roadmap/FEAT-Roadmap-Promotion-Contract.md"
  - "docs/roadmap/IMP-SYSTEM05-Task-Scoped-Context-Injection.md"
  - "docs/features/agent-team/FEAT-Task-Scoped-Context-Injection.md"
---

# BACKLOG: Task-Scoped Context Injection

**ImpId:** `IMP-SYSTEM05-TASK-SCOPED-CONTEXT-INJECTION`  
**Source Export:** `derived-from-imp`  
**Source Phase:** `system-05, task-scoped-context-injection`  
**Primary Systems:** `SYSTEM-02::Project-Roadmap-Management-System`, `SYSTEM-05::Agent-Team-Management-System`  
**Supporting Systems:** `SYSTEM-03::Docs-to-Code-System`, `SYSTEM-08::Genesis-Knowledge-HCS-System`, `SYSTEM-09::Traceability-Audit-Verification-System`, `SYSTEM-10::Execution-Governance-System`  
**Planning PIC:** `LYRA`  
**Architecture PIC:** `ARCHON`  
**Data Contract PIC:** `KIN`  
**Audit PIC:** `ATHER`  
**Verification PIC:** `GHOST`  
**Status:** `approved`  
**Backlog Source Path:** `docs/roadmap/BACKLOG-task-scoped-context-injection.md`  
**Mission Control Render:** `A2 Roadmap Board consumes roadmap hierarchy plus Task Container detail records.`

## Goal

Represent the `Task-Scoped Context Injection` implementation plan as a Mission Control compatible backlog source with bounded task containers, explicit task breakdown, local packet references, and verification traceability.

## Phases

| Phase | Parent ID | Goal | Status | Progress | Recorded At |
|---|---|---|---|---:|---|
| PHA-SYS05-TSCI-01 | SYS05-TSCI | Implement bounded context packet lifecycle and promotion flow without widening runtime schema | planned | 0 | 2026-06-19T00:00:00+07:00 |

## Sprints

| Sprint | Parent ID | Goal | Task Count | Exit Criteria | Status | Progress | Recorded At |
|---|---|---|---:|---|---|---:|---|
| SPR-SYS05-TSCI-01A | PHA-SYS05-TSCI-01 | Establish packet shell, selectors, and assembly order | 3 | Packet shell, source selection, and deterministic assembly are implemented with bounded escalation | planned | 0 | 2026-06-19T00:00:00+07:00 |
| SPR-SYS05-TSCI-01B | PHA-SYS05-TSCI-01 | Complete result, promotion, and audit closure | 3 | Result normalization, promotion gate, and traceability closure are implemented without schema expansion | planned | 0 | 2026-06-19T00:00:00+07:00 |

## Backlog Items

| ID | Parent ID | Type | Title | PRD System | Priority | PIC | Executor | Approver | Auditor | Source Section | Dependencies | Acceptance | Status | Progress | Legacy Code | Token Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---:|---|---:|
| TASK-TSCI-01 | SPR-SYS05-TSCI-01A | task | Assembly skeleton | SYSTEM-05 | P0 | ARCHON | Codex or module worker | LYRA | ATHER | slice-1 | - | Packet shell exists with baseline policy block and bounded completeness checks | planned | 0 | TASK-TSCI-01 | 1800 |
| TASK-TSCI-02 | SPR-SYS05-TSCI-01A | task | Source and verification injection | SYSTEM-05 | P0 | ARCHON | Codex or module worker | LYRA | ATHER | slice-2 | TASK-TSCI-01 | Approved source refs, file refs, verification expectations, and critical issue sets are injected with escalation support | planned | 0 | TASK-TSCI-02 | 2600 |
| TASK-TSCI-03 | SPR-SYS05-TSCI-01A | task | Packet assembly integration | SYSTEM-05 | P0 | ARCHON | Codex or module worker | LYRA | ATHER | slice-3 | TASK-TSCI-02 | One bounded packet is assembled in deterministic order and respects source-of-truth precedence | planned | 0 | TASK-TSCI-03 | 2200 |
| TASK-TSCI-04 | SPR-SYS05-TSCI-01B | task | Result normalization and classification | SYSTEM-05 | P0 | ARCHON | Codex or module worker | LYRA | ATHER | slice-4 | TASK-TSCI-03 | Executor output is normalized into governed buckets without synthesizing missing evidence | planned | 0 | TASK-TSCI-04 | 2200 |
| TASK-TSCI-05 | SPR-SYS05-TSCI-01B | task | Promotion gate and review loop | SYSTEM-05 | P0 | ARCHON | Codex or module worker | LYRA | ATHER | slice-5 | TASK-TSCI-04 | Promotion flow is lead-reviewed, conflict-aware, and blocks private-note promotion | planned | 0 | TASK-TSCI-05 | 2000 |
| TASK-TSCI-06 | SPR-SYS05-TSCI-01B | task | Audit and operational closure | SYSTEM-09 | P1 | ATHER | Codex or auditor support | LYRA | ATHER | slice-6 | TASK-TSCI-05 | Packet lineage and promotion decision trace points exist without tenant or vault schema expansion | planned | 0 | TASK-TSCI-06 | 1400 |

## Task Breakdown

### TASK-TSCI-01: Assembly skeleton

- [ ] S-TSCI-01.1 Build packet shell from task metadata and baseline policy only.
  - [ ] M-TSCI-01.1 Implement task metadata intake and baseline policy block construction.
    - [ ] A-TSCI-01.1 Verify required packet shell fields exist before any source or learning injection.
- [ ] S-TSCI-01.2 Lock early completeness checks for missing metadata and review ownership.
  - [ ] M-TSCI-01.2 Keep learning promotion logic out of this slice.
    - [ ] A-TSCI-01.2 Verify incomplete shell states escalate instead of widening scope.

### TASK-TSCI-02: Source and verification injection

- [ ] S-TSCI-02.1 Implement approved source ref and file ref selection.
  - [ ] M-TSCI-02.1 Exclude transcript-first, stale, and speculative refs.
    - [ ] A-TSCI-02.1 Verify `missing_source_truth`, `needs_more_context`, and `scope_conflict`.
- [ ] S-TSCI-02.2 Implement verification expectation and critical issue injection.
  - [ ] M-TSCI-02.2 Keep verification and issue inputs bounded to the current slice.
    - [ ] A-TSCI-02.2 Verify `verification_blocked` handling.

### TASK-TSCI-03: Packet assembly integration

- [ ] S-TSCI-03.1 Merge packet shell, refs, verification, and issue sets into one bounded packet.
  - [ ] M-TSCI-03.1 Apply deterministic assembly order from blueprint and LLD.
    - [ ] A-TSCI-03.1 Verify approved docs outrank promoted prior learnings.
- [ ] S-TSCI-03.2 Add optional promoted learning lookup and debug refs handling.
  - [ ] M-TSCI-03.2 Keep optional inputs non-primary.
    - [ ] A-TSCI-03.2 Verify missing optional inputs do not widen retrieval.

### TASK-TSCI-04: Result normalization and classification

- [ ] S-TSCI-04.1 Normalize raw executor output into the fixed result contract.
  - [ ] M-TSCI-04.1 Separate result summary, files touched, verification status, and escalation reason.
    - [ ] A-TSCI-04.1 Verify malformed executor output stays bounded.
- [ ] S-TSCI-04.2 Classify result knowledge into governed buckets.
  - [ ] M-TSCI-04.2 Keep `nonPromotedNotes` separate from promotable outputs.
    - [ ] A-TSCI-04.2 Verify no promotable path accepts private notes.

### TASK-TSCI-05: Promotion gate and review loop

- [ ] S-TSCI-05.1 Implement review-gated approval and rejection flow.
  - [ ] M-TSCI-05.1 Review `criticalKnowledge` and `durableLearnings` separately.
    - [ ] A-TSCI-05.1 Verify source-of-truth conflicts reject promotion candidates.
- [ ] S-TSCI-05.2 Preserve issue visibility and private-note isolation.
  - [ ] M-TSCI-05.2 Block automatic promotion bypass.
    - [ ] A-TSCI-05.2 Verify private notes remain non-canonical.

### TASK-TSCI-06: Audit and operational closure

- [ ] S-TSCI-06.1 Add packet lineage and promotion decision trace points.
  - [ ] M-TSCI-06.1 Keep traceability inside current governed runtime surfaces.
    - [ ] A-TSCI-06.1 Verify no new tenant or vault schema is introduced.
- [ ] S-TSCI-06.2 Finalize verification closure evidence.
  - [ ] M-TSCI-06.2 Keep evidence references explicit from assembly through promotion.
    - [ ] A-TSCI-06.2 Verify closure does not alter source-of-truth precedence.

## Task Containers

### TC-TASK-TSCI-01

```yaml
task_container_id: TC-TASK-TSCI-01
task_id: TASK-TSCI-01
legacy_task_id: slice-1
legacy_code: TASK-TSCI-01
parent_phase_id: PHA-SYS05-TSCI-01
parent_sprint_id: SPR-SYS05-TSCI-01A
title: Assembly skeleton
requirement_type: FR
complexity: high
status: stable
version: 1.0.0
pic: ARCHON
executor: Codex or module worker
approver: LYRA
auditor: ATHER
assignee: system-05-parent
completed_by: Unassigned
symbol_links:
  code: unavailable
  doc: docs/lld/LLD-Task-Scoped-Context-Injection-Core.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Packet shell exists with required slice-1 fields
      checked: false
    - criterion: Baseline policy block is injected without source or learning logic
      checked: false
  success_criteria:
    - criterion: Missing metadata or policy owner escalates
      checked: false
    - criterion: No promotion logic exists in slice 1
      checked: false
  exit_criteria:
    - criterion: Verification evidence exists for shell completeness
      checked: false
    - criterion: No scope widening fallback is introduced
      checked: false
changelog: Planned bounded packet shell and baseline policy implementation from canonical IMP slice 1.
created_at: 2026-06-19T00:00:00+07:00,LYRA,planning
last_update: 2026-06-19T00:00:00+07:00,LYRA,planning
token_telemetry:
  model_name: codex
  context_length: 32k
  predicted_token_usage: 1800
  actual_input_tokens: unavailable
  actual_output_tokens: unavailable
  tool_calling_tokens: unavailable
  total_token_usage: 1800
export:
  json: enabled
  yaml: enabled
  markdown: enabled
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-TSCI-02

```yaml
task_container_id: TC-TASK-TSCI-02
task_id: TASK-TSCI-02
legacy_task_id: slice-2
legacy_code: TASK-TSCI-02
parent_phase_id: PHA-SYS05-TSCI-01
parent_sprint_id: SPR-SYS05-TSCI-01A
title: Source and verification injection
requirement_type: FR
complexity: high
status: stable
version: 1.0.0
pic: ARCHON
executor: Codex or module worker
approver: LYRA
auditor: ATHER
assignee: system-05-parent
completed_by: Unassigned
symbol_links:
  code: unavailable
  doc: docs/lld/LLD-Task-Scoped-Context-Injection-Core.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Approved source refs and file refs are selected while transcript-first, stale, and speculative refs are excluded
      checked: false
    - criterion: Verification expectations and critical issue sets are injected bounded to the current slice
      checked: false
  success_criteria:
    - criterion: missing_source_truth, needs_more_context, and scope_conflict escalate instead of widening scope
      checked: false
    - criterion: verification_blocked is emitted when the required verification basis is unavailable
      checked: false
  exit_criteria:
    - criterion: No fallback source or verification synthesis occurs
      checked: false
    - criterion: Verification evidence exists for selector and injection behavior
      checked: false
changelog: Planned approved-source and verification injection slice from canonical IMP slice 2.
created_at: 2026-06-19T00:00:00+07:00,LYRA,planning
last_update: 2026-06-19T00:00:00+07:00,LYRA,planning
token_telemetry:
  model_name: codex
  context_length: 16k
  predicted_token_usage: 2600
  actual_input_tokens: unavailable
  actual_output_tokens: unavailable
  tool_calling_tokens: unavailable
  total_token_usage: 2600
export:
  json: enabled
  yaml: enabled
  markdown: enabled
ui_state:
  dropdown_default: collapsed
  expanded: false
  disabled_reason: Planned slice — implementation not yet started.
```

### TC-TASK-TSCI-03

```yaml
task_container_id: TC-TASK-TSCI-03
task_id: TASK-TSCI-03
legacy_task_id: slice-3
legacy_code: TASK-TSCI-03
parent_phase_id: PHA-SYS05-TSCI-01
parent_sprint_id: SPR-SYS05-TSCI-01A
title: Packet assembly integration
requirement_type: FR
complexity: high
status: stable
version: 1.0.0
pic: ARCHON
executor: Codex or module worker
approver: LYRA
auditor: ATHER
assignee: system-05-parent
completed_by: Unassigned
symbol_links:
  code: unavailable
  doc: docs/architecture/BLUEPRINT-Task-Scoped-Context-Injection.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Packet shell, refs, verification, and issue sets merge into one bounded packet
      checked: false
    - criterion: Deterministic assembly order from blueprint and LLD is applied
      checked: false
  success_criteria:
    - criterion: Approved docs outrank promoted prior learnings in assembly order
      checked: false
    - criterion: Optional promoted learnings and debug refs stay non-primary
      checked: false
  exit_criteria:
    - criterion: Missing optional inputs do not widen retrieval
      checked: false
    - criterion: Assembly-order unit test verifies source-of-truth precedence
      checked: false
changelog: Planned bounded packet assembly integration slice from canonical IMP slice 3.
created_at: 2026-06-19T00:00:00+07:00,LYRA,planning
last_update: 2026-06-19T00:00:00+07:00,LYRA,planning
token_telemetry:
  model_name: codex
  context_length: 16k
  predicted_token_usage: 2200
  actual_input_tokens: unavailable
  actual_output_tokens: unavailable
  tool_calling_tokens: unavailable
  total_token_usage: 2200
export:
  json: enabled
  yaml: enabled
  markdown: enabled
ui_state:
  dropdown_default: collapsed
  expanded: false
  disabled_reason: Planned slice — implementation not yet started.
```

### TC-TASK-TSCI-04

```yaml
task_container_id: TC-TASK-TSCI-04
task_id: TASK-TSCI-04
legacy_task_id: slice-4
legacy_code: TASK-TSCI-04
parent_phase_id: PHA-SYS05-TSCI-01
parent_sprint_id: SPR-SYS05-TSCI-01B
title: Result normalization and classification
requirement_type: FR
complexity: high
status: stable
version: 1.0.0
pic: ARCHON
executor: Codex or module worker
approver: LYRA
auditor: ATHER
assignee: system-05-parent
completed_by: Unassigned
symbol_links:
  code: unavailable
  doc: docs/api/API-004-Task-Scoped-Context-Packet-Schema.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Raw executor output is normalized into the fixed result contract
      checked: false
    - criterion: Result summary, files touched, verification status, and escalation reason are separated
      checked: false
  success_criteria:
    - criterion: Malformed executor output stays bounded and does not synthesize missing evidence
      checked: false
    - criterion: Result knowledge is classified into governed buckets
      checked: false
  exit_criteria:
    - criterion: nonPromotedNotes are kept out of any promotable bucket
      checked: false
    - criterion: No promotable path accepts private notes (verified by classification test)
      checked: false
changelog: Planned result normalization and classification slice from canonical IMP slice 4.
created_at: 2026-06-19T00:00:00+07:00,LYRA,planning
last_update: 2026-06-19T00:00:00+07:00,LYRA,planning
token_telemetry:
  model_name: codex
  context_length: 16k
  predicted_token_usage: 2200
  actual_input_tokens: unavailable
  actual_output_tokens: unavailable
  tool_calling_tokens: unavailable
  total_token_usage: 2200
export:
  json: enabled
  yaml: enabled
  markdown: enabled
ui_state:
  dropdown_default: collapsed
  expanded: false
  disabled_reason: Planned slice — implementation not yet started.
```

### TC-TASK-TSCI-05

```yaml
task_container_id: TC-TASK-TSCI-05
task_id: TASK-TSCI-05
legacy_task_id: slice-5
legacy_code: TASK-TSCI-05
parent_phase_id: PHA-SYS05-TSCI-01
parent_sprint_id: SPR-SYS05-TSCI-01B
title: Promotion gate and review loop
requirement_type: FR
complexity: high
status: stable
version: 1.0.0
pic: ARCHON
executor: Codex or module worker
approver: LYRA
auditor: ATHER
assignee: system-05-parent
completed_by: Unassigned
symbol_links:
  code: unavailable
  doc: docs/features/agent-team/FEAT-Task-Scoped-Context-Injection.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Review-gated approval and rejection flow reviews criticalKnowledge and durableLearnings separately
      checked: false
    - criterion: Source-of-truth conflicts reject promotion candidates
      checked: false
  success_criteria:
    - criterion: Issue visibility and private-note isolation are preserved
      checked: false
    - criterion: Automatic promotion bypass is blocked
      checked: false
  exit_criteria:
    - criterion: Private notes remain non-canonical (verified by promotion test)
      checked: false
    - criterion: Promoted learnings never override approved docs
      checked: false
changelog: Planned promotion gate and review loop slice from canonical IMP slice 5.
created_at: 2026-06-19T00:00:00+07:00,LYRA,planning
last_update: 2026-06-19T00:00:00+07:00,LYRA,planning
token_telemetry:
  model_name: codex
  context_length: 16k
  predicted_token_usage: 2000
  actual_input_tokens: unavailable
  actual_output_tokens: unavailable
  tool_calling_tokens: unavailable
  total_token_usage: 2000
export:
  json: enabled
  yaml: enabled
  markdown: enabled
ui_state:
  dropdown_default: collapsed
  expanded: false
  disabled_reason: Planned slice — implementation not yet started.
```

### TC-TASK-TSCI-06

```yaml
task_container_id: TC-TASK-TSCI-06
task_id: TASK-TSCI-06
legacy_task_id: slice-6
legacy_code: TASK-TSCI-06
parent_phase_id: PHA-SYS05-TSCI-01
parent_sprint_id: SPR-SYS05-TSCI-01B
title: Audit and operational closure
requirement_type: NFR
complexity: high
status: stable
version: 1.0.0
pic: ATHER
executor: Codex or auditor support
approver: LYRA
auditor: ATHER
assignee: ather-support
completed_by: Unassigned
symbol_links:
  code: unavailable
  doc: docs/features/agent-team/FEAT-Task-Scoped-Context-Injection.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Packet lineage trace points are wired to existing runtime audit surfaces
      checked: false
    - criterion: Promotion decision trace points exist without schema expansion
      checked: false
  success_criteria:
    - criterion: Verification closure references unit, integration, and governance checks
      checked: false
    - criterion: Source-of-truth precedence remains unchanged
      checked: false
  exit_criteria:
    - criterion: No new tenant or vault schema is introduced
      checked: false
    - criterion: Traceability remains bounded to existing governed runtime surfaces
      checked: false
changelog: Planned audit closure and traceability slice from canonical IMP slice 6.
created_at: 2026-06-19T00:00:00+07:00,LYRA,planning
last_update: 2026-06-19T00:00:00+07:00,LYRA,planning
token_telemetry:
  model_name: codex
  context_length: 16k
  predicted_token_usage: 1400
  actual_input_tokens: unavailable
  actual_output_tokens: unavailable
  tool_calling_tokens: unavailable
  total_token_usage: 1400
export:
  json: enabled
  yaml: enabled
  markdown: enabled
ui_state:
  dropdown_default: collapsed
  expanded: false
  disabled_reason: Verification and audit evidence are not yet complete.
```

## Local LLM Packets

| ID | Target Context | Max Input | Target Path | Model Name | Predicted Token Usage | Instruction | Acceptance |
|---|---|---:|---|---|---:|---|---|
| M-TSCI-01.1 | 16k | 2k-6k | `implementation files chosen by the lead` | local-ollama/TBD | 1800 | Build packet shell and baseline policy block only | Required shell fields exist and missing owner state escalates |
| M-TSCI-02.1 | 16k | 2k-6k | `implementation files chosen by the lead` | local-ollama/TBD | 2200 | Implement approved source and file ref selection | Selector returns refs plus bounded escalation |
| M-TSCI-03.1 | 16k | 2k-6k | `implementation files chosen by the lead` | local-ollama/TBD | 2100 | Assemble one bounded packet in locked order | Packet preserves deterministic order and precedence |
| M-TSCI-04.1 | 16k | 2k-6k | `implementation files chosen by the lead` | local-ollama/TBD | 2200 | Normalize executor output into governed result buckets | Result buckets are explicit and no evidence is synthesized |
| M-TSCI-05.1 | 16k | 2k-6k | `implementation files chosen by the lead` | local-ollama/TBD | 2000 | Implement review-gated promotion flow | Approved, rejected, and private note sets are explicit |
| M-TSCI-06.1 | 12k | 2k-6k | `implementation files chosen by the lead` | local-ollama/TBD | 1500 | Add packet lineage and promotion trace points to existing audit surfaces | Traceability improves without schema expansion |
| A-TSCI-02.2 | 8k | 500-2k | `implementation files chosen by the lead` | local-ollama/TBD | 800 | Emit `verification_blocked` when required verification basis is unavailable | No fallback verification synthesis occurs |
| A-TSCI-03.2 | 8k | 500-2k | `implementation files chosen by the lead` | local-ollama/TBD | 850 | Keep optional learnings and debug refs non-primary | Packet works without optional inputs |
| A-TSCI-04.2 | 8k | 500-2k | `implementation files chosen by the lead` | local-ollama/TBD | 900 | Keep `nonPromotedNotes` out of any promotable bucket | Private notes remain separate |
| A-TSCI-05.2 | 8k | 500-2k | `implementation files chosen by the lead` | local-ollama/TBD | 750 | Reject promotion candidates that conflict with approved docs | Promoted learnings never override approved docs |
| A-TSCI-06.2 | 8k | 500-2k | `implementation files chosen by the lead` | local-ollama/TBD | 700 | Wire verification evidence references into closure surfaces | No new evidence schema is introduced |

## Assignments

| Task ID | Subject ID | Subject Type | Policy Model | Assigned At | Assigned By | Recorded At |
|---|---|---|---|---|---|---|
| TASK-TSCI-01 | system-05-parent | agent | ABAC | 2026-06-19T00:00:00+07:00 | LYRA | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-02 | system-05-parent | agent | ABAC | 2026-06-19T00:00:00+07:00 | LYRA | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-03 | system-05-parent | agent | ABAC | 2026-06-19T00:00:00+07:00 | LYRA | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-04 | system-05-parent | agent | ABAC | 2026-06-19T00:00:00+07:00 | LYRA | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-05 | system-05-parent | agent | ABAC | 2026-06-19T00:00:00+07:00 | LYRA | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-06 | ather-support | agent | ABAC | 2026-06-19T00:00:00+07:00 | LYRA | 2026-06-19T00:00:00+07:00 |

## Verification

| Task ID | QA Status | Audit Status | Deployment Status | Last Updated At | Recorded At |
|---|---|---|---|---|---|
| TASK-TSCI-01 | pending | pending | n/a | 2026-06-19T00:00:00+07:00 | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-02 | pending | pending | n/a | 2026-06-19T00:00:00+07:00 | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-03 | pending | pending | n/a | 2026-06-19T00:00:00+07:00 | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-04 | pending | pending | n/a | 2026-06-19T00:00:00+07:00 | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-05 | pending | pending | n/a | 2026-06-19T00:00:00+07:00 | 2026-06-19T00:00:00+07:00 |
| TASK-TSCI-06 | pending | pending | n/a | 2026-06-19T00:00:00+07:00 | 2026-06-19T00:00:00+07:00 |

## UI Traceability

| Task ID | Source Section | Agent Assignment | Artifact | Review | Verification |
|---|---|---|---|---|---|
| TASK-TSCI-01 | slice-1 | system-05-parent | TC-TASK-TSCI-01 | ATHER pending | GHOST pending |
| TASK-TSCI-02 | slice-2 | system-05-parent | IMP-SYSTEM05-TASK-SCOPED-CONTEXT-INJECTION | ATHER pending | GHOST pending |
| TASK-TSCI-03 | slice-3 | system-05-parent | IMP-SYSTEM05-TASK-SCOPED-CONTEXT-INJECTION | ATHER pending | GHOST pending |
| TASK-TSCI-04 | slice-4 | system-05-parent | IMP-SYSTEM05-TASK-SCOPED-CONTEXT-INJECTION | ATHER pending | GHOST pending |
| TASK-TSCI-05 | slice-5 | system-05-parent | IMP-SYSTEM05-TASK-SCOPED-CONTEXT-INJECTION | ATHER pending | GHOST pending |
| TASK-TSCI-06 | slice-6 | ather-support | TC-TASK-TSCI-06 | ATHER pending | GHOST pending |

## Acceptance Criteria

- [x] The backlog is tied to one canonical `ImpId`.
- [x] A2-readable backlog items exist for all six bounded slices.
- [x] Task breakdown preserves task -> sub-task -> micro-task -> atomic-task hierarchy.
- [x] Local packet references stay bounded and do not use `docs/ref/` as source of truth.
- [x] Verification and UI traceability sections exist for Mission Control consumption.

## Changelog

| Version | Date | Owner | Summary |
|---|---|---|---|
| 0.1.0 | 2026-06-19 | LYRA | Promoted the task-scoped context injection backlog source to approved status for active Mission Control roadmap consumption. |
| 0.1.0+draft | 2026-06-19 | LYRA | Added canonical backlog and task-container source for task-scoped context injection so Mission Control can consume the implementation slices as roadmap state. |
