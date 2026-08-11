# Model Lifecycle

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-12 |

- **Provider choice is a decision, not a default** — record it as an ADR when made,
  with the data-processing terms that apply (see `ethics-governance.md`).
- **Cost per message is a product constraint.** A shop owner sending 50 messages a
  day sets the ceiling; measure before scaling intents.
- **Fallback path is mandatory**: when the model is unavailable or the output fails
  validation twice, the user gets a link into the web console — never a silent drop.
- **Evaluation set from real traffic** (with consent): a fixed set of messages with
  expected envelopes, run on every prompt or model change. This is the only way to
  know an upgrade did not regress intent extraction.
- **No fine-tuning in V2's first phase** — prompt + schema validation first; revisit
  only with measured failure classes.
