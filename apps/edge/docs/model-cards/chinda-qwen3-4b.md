---
id: "MODEL-CARD-CHINDA-QWEN3-4B"
model: "chinda-qwen3-4b"
role: "rejected"
status: "rejected 2026-08-20"
last_measured: "2026-08-20"
---

# chinda-qwen3-4b

Rejected at the first gate: Ollama refuses to give it tools.

| | |
| --- | --- |
| Tag | `chinda-qwen3-4b` |
| Installed here | **No.** Not present on this machine as of 2026-09-04 |

## Measured

| Date | Result |
| --- | --- |
| 2026-08-20 | Ollama: **`does not support tools`** · also leaks `<think>` into `content` |

## Why it was rejected

The tool refusal is disqualifying on its own — every figure this agent may say has to come from a
tool result, so a model that cannot be given tools cannot answer a priced question at all.

The `<think>` leak is the more transferable finding, and it is finding 3 in
`LOCAL-MODEL-SELECTION.md`. Where Ollama recognises a model's thinking capability it separates the
reasoning out and the customer never sees it; where it does not, `<think>` is just text and goes
**straight through to the reply**. `think: false` does not prevent this — sent through
`/v1/chat/completions` it is accepted and ignored.

The adapter still has no `<think>` stripping. That is a live risk for any model in this class and
is recorded as a known gap.

## Not measured

- Anything through the native `/api/chat` endpoint, where the tool refusal might behave
  differently.
- Anything since 2026-08-20.
