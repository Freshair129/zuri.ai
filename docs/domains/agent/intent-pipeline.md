# AI Intent Pipeline — LINE as the fifth intake surface

| Field | Value |
|-------|-------|
| **Version** | 1.3.0 |
| **Status** | Draft — not implemented (`TASK-V2-LINE-INTENT`) |
| **Last Updated** | 2026-08-12 |

LINE is the primary surface, but it is **not a new write path**. It converges on the
pipeline that already exists and is tested (BR-009, SDD-009):

```text
LINE message / image
  → intent extraction (LLM)          ← the only new step
  → PlanEnvelope (or domain envelope)
  → Zod validation
  → semantic checks
  → read-only dry run
  → preview rendered back into LINE
  → user confirms in the chat
  → single transaction commit
  → audit event (actorType = AI_INTENT)
```

## Rules

1. **AI never writes directly.** The model produces an envelope; the envelope goes
   through the same validate → dry-run → confirm path as an Excel upload. A model
   that hallucinates a field produces a validation error, not a database row.
2. **Confirmation is in the chat, not in the web app.** The preview must be
   readable on a phone: what will be created, what will change, what conflicts.
3. **The envelope is the contract, not the prompt.** Prompts change weekly; the
   envelope schema is versioned (`schemaVersion`) and tested.
4. **Every AI-derived commit is attributable** — `actorType: AI_INTENT` plus the
   source message id in the audit payload, so any row can be traced to what was said.
5. **Built on V2-native intent APIs**, never on V1's CRUD routes (ADR-003 §D7).

## Stable identity references

An accepted Agent request may carry the following owner-resolved references into
the shared PlanEnvelope and execution trace:

| Storage ID | Meaning | Rule |
|---|---|---|
| `contract_id` | CRM Contact identity | Optional CRM context; it does not replace `execution_contract_id` or `workflow_contract_id` |
| `meeting_id` / `call_id` / `followup_id` | CRM interaction identities | Optional meeting, call and follow-up context; none replaces a Project Manager WorkItem or execution trace ID |
| `req_id` | declared requirement/feature reference | Resolves to an existing `FR-*`/`NFR-*`/`BR-*`/`SEC-*`/`SDD-*`/`FEAT-*` key; not a transport request ID |
| `integration_id` | Integration adapter/bridge identity | Canonical Integration reference; legacy `int_id` normalizes to this field and is not Intent |
| `workflow_contract_id` | multi-agent workflow contract identity | Governs roles, handoffs, inputs, outputs, tools, failure handling and approval |
| `workflow_id` | workflow definition identity | Selects an approved workflow governed by `workflow_contract_id`; its concrete procedure is `runbook_id`, and it does not replace `execution_contract_id` or `execution_run_id` |
| `runbook_id` | concrete workflow procedure identity | Selects the operational procedure invoked by `workflow_id`; it is distinct from the workflow contract and execution run |
| `promotion_id` | governed knowledge promotion occurrence | Tracks candidate-to-canonical promotion; it is distinct from `fact_id`, `knowledge_id` and execution trace IDs |
| `skill_id` | allow-listed Agent skill/capability | Consumption reference only; it grants no Project Manager authority |
| `tool_id` | allow-listed Agent tool | The tool name is a display/selector value, not the stable identity |
| `artifact_id` / `verify_id` | source/evidence and verification references | Must resolve before commit; unavailable owner data is explicit |
| `graph_id` / `node_id` / `edge_id` | Knowledge/GKS graph context | Read/reference context only; it is distinct from the generated document graph |
| `gate_id` | Project Manager Gate reference | Must resolve to an authorized existing `Gate.id` |

The Agent may propose these IDs only in data. The server resolves them, applies
scope and capability checks, and records the resolved references in the same
AuditEvent/replay lineage as Human intake. No prompt, tool name, graph label,
file path or hash can stand in for an ID.

## Open questions (decide before building)

- Which intents ship first? (candidate: record a sale, add a task, ask a number)
- What happens when confidence is low — ask a clarifying question, or fall back to
  a form link into the web console?
- Multi-turn: does the envelope accumulate across messages, or is each message
  self-contained?

See also `prompt-engineering.md`, `ethics-governance.md`, `model-lifecycle.md`.
