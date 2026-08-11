# Prompt Engineering Guidelines

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-12 |

- **Prompts produce envelopes, not prose.** The output contract is the Zod schema in
  `zuri-v2-lab/src/modules/project-manager/import/plan-schema.js` (or the domain
  envelope for non-PM intents). Structured output is validated, never trusted.
- **Enums come from the schema**, injected into the prompt at build time from
  `src/lib/validation/enums.js` — the same source the Excel dropdowns and OpenAPI use.
  Never hand-copy a list into a prompt.
- **Thai first.** Users write Thai, mixed with English product names and numbers.
  Test prompts against real message shapes, not translated English.
- **Uncertainty is a first-class output**: the model may return "I need X" rather
  than guessing a required field. A guessed field that passes validation is worse
  than a rejected message.
- **Version prompts alongside the schema version** they target, so a schema change
  never silently invalidates a prompt.
