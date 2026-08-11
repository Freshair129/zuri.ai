# AI Intent Pipeline — LINE as the fifth intake surface

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
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

## Open questions (decide before building)

- Which intents ship first? (candidate: record a sale, add a task, ask a number)
- What happens when confidence is low — ask a clarifying question, or fall back to
  a form link into the web console?
- Multi-turn: does the envelope accumulate across messages, or is each message
  self-contained?

See also `prompt-engineering.md`, `ethics-governance.md`, `model-lifecycle.md`.
