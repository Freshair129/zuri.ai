---
id: "MODEL-CARD-LFM2-12B-RAG"
model: "LFM2-1.2B-RAG"
role: "rejected"
status: "rejected 2026-08-20"
last_measured: "2026-08-20"
---

# LFM2-1.2B-RAG

Rejected on output quality before performance was worth measuring.

| | |
| --- | --- |
| Tag | `LFM2-1.2B-RAG` |
| Installed here | **No.** Not present on this machine as of 2026-09-04 |

## Measured

| Date | Result |
| --- | --- |
| 2026-08-20 | Thai output unusable — garbled, with Devanagari characters mixed into it |

## Why it was rejected

A model that cannot write Thai cannot serve Thai customers, and no amount of speed compensates.
Devanagari appearing in Thai output points at a tokenizer or training-data problem rather than
anything a prompt or sampling setting would reach.

Recorded in `LOCAL-MODEL-SELECTION.md` alongside a related finding worth keeping: making the
acknowledgement conversational was tested with a small model as first contact, and **every** SLM
small enough to be fast either mangled Thai or leaked `<think>`. The ones that write Thai well are
slower than the answer itself. The acknowledgement stayed a fixed string for that reason, and a
template keyed on question type is the cheaper answer than a 1–2B model.

## Not measured

- Latency, tool calling, or anything else. Output quality failed first, so the rest was moot.
- Whether a RAG-specific fine-tune at this size is viable in English. Only Thai was tested,
  because only Thai matters here.
