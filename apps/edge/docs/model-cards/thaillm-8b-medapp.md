---
id: "MODEL-CARD-THAILLM-8B-MEDAPP"
model: "hf.co/mradermacher/ThaiLLM-8B-MedApp-GGUF:Q4_K_M"
role: "rejected"
status: "rejected 2026-09-03"
last_measured: "2026-09-03"
---

# ThaiLLM-8B-MedApp

A **medical** task-specific model, tried because it is Thai-native and 8B. Wrong tool for the job,
and the measurement says so in one line.

| | |
| --- | --- |
| Tag | `hf.co/mradermacher/ThaiLLM-8B-MedApp-GGUF:Q4_K_M` |
| Architecture | `qwen3`, 8.19B, `Q4_K_M` |
| Declared context | 32,768 |
| Capabilities | `completion`, `tools`, `thinking` |
| Base | `ThaiLLM/ThaiLLM-8B-MedApp` — fine-tuned for medical applications |

## Measured

| Turns | answered | called tool | usable | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| 4 | **0/4** | **0/4** | 0/4 | 1.0s | 1.1s |

## Why it was rejected

It never called a tool at all, and returned no text, in about a second per turn.

The useful detail: **Ollama reports `tools` in its capabilities**. The declaration and the
behaviour disagree, and only one of them was measured. A capability list is a claim about the
chat template, not evidence that a model will use tools when given them — which is the reason this
directory exists rather than a table of vendor specs.

The "MedApp" in the name is not decoration. Nothing about a medical fine-tune suggests it should
quote gift-set prices, and it did not.

## Not measured

- Anything beyond four turns, or any prompt variation. It failed at the first step every time.
- Whether it performs its actual job. This says nothing about the model as a medical assistant;
  it was measured against a sales path it was never built for.
